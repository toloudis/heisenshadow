import { FLOATS_PER_STROKE, type RecordingContext } from "./recordingContext";
import { COMPUTE_SHADER, RENDER_SHADER } from "./shaders";

const SUBDIVISIONS = 24;
// A cap extension pair, SUBDIVISIONS body pairs, and another cap extension pair.
const VERTS_PER_STROKE = (SUBDIVISIONS + 2) * 2;
const BYTES_PER_VERTEX = 16; // StripVertex is 4 floats
const SAMPLE_COUNT = 4;
// Largest piece of an exported image drawn at once.
const EXPORT_TILE_SIZE = 4096;
const WHITE = [1.0, 1.0, 1.0, 1.0];

type Pipelines = { compute: GPUComputePipeline; render: GPURenderPipeline };

/**
 * The GPU buffers for one set of recorded strokes: the strokes and clip
 * polygons as uploaded, their tessellated vertices, and the uniforms. The
 * screen and each export have their own, so animation frames don't overwrite
 * an export that's still drawing.
 */
class StrokeBatch {
  private count = 0;
  private strokeCapacity = 0;
  private clipCapacity = 0;
  private strokeBuffer?: GPUBuffer;
  private vertexBuffer?: GPUBuffer;
  private clipBuffer?: GPUBuffer;
  private computeBindGroup?: GPUBindGroup;
  private renderBindGroup?: GPUBindGroup;
  private readonly countBuffer: GPUBuffer;
  private readonly countData = new Uint32Array(4);
  private readonly viewBuffer: GPUBuffer;
  private readonly viewData = new Float32Array(4);

  constructor(
    private readonly device: GPUDevice,
    private readonly pipelines: Pipelines,
  ) {
    this.countBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.viewBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.setView(1, 1, 0, 0);
    this.ensureCapacity(1024, 1024);
  }

  /** Upload the recorded strokes, replacing any uploaded before. */
  upload(rec: RecordingContext) {
    const { device } = this;
    const n = rec.strokeCount;
    this.ensureCapacity(n, rec.clipPointCount);
    if (!this.strokeBuffer || !this.clipBuffer) return;
    if (n > 0) {
      device.queue.writeBuffer(
        this.strokeBuffer,
        0,
        rec.strokeData,
        0,
        n * FLOATS_PER_STROKE,
      );
    }
    if (rec.clipPointCount > 0) {
      device.queue.writeBuffer(
        this.clipBuffer,
        0,
        rec.clipPoints,
        0,
        rec.clipPointCount * 2,
      );
    }
    this.countData[0] = n;
    device.queue.writeBuffer(this.countBuffer, 0, this.countData);
    this.count = n;
  }

  /**
   * Where paper coordinates land on the render target, whose 0..1 range is
   * paper * scale + offset.
   */
  setView(scaleX: number, scaleY: number, offsetX: number, offsetY: number) {
    this.viewData.set([scaleX, scaleY, offsetX, offsetY]);
    this.device.queue.writeBuffer(this.viewBuffer, 0, this.viewData);
  }

  /** Add the compute pass tessellating the uploaded strokes. */
  encodeTessellate(encoder: GPUCommandEncoder) {
    if (this.count === 0 || !this.computeBindGroup) return;
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.compute);
    pass.setBindGroup(0, this.computeBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.count / 64));
    pass.end();
  }

  /** Draw the tessellated strokes, one instance per stroke. */
  encodeDraw(pass: GPURenderPassEncoder) {
    if (this.count === 0 || !this.renderBindGroup) return;
    pass.setPipeline(this.pipelines.render);
    pass.setBindGroup(0, this.renderBindGroup);
    pass.draw(VERTS_PER_STROKE, this.count);
  }

  destroy() {
    this.strokeBuffer?.destroy();
    this.vertexBuffer?.destroy();
    this.clipBuffer?.destroy();
    this.countBuffer.destroy();
    this.viewBuffer.destroy();
  }

  // Grow the buffers (doubling) to hold `strokes` strokes and `clipPoints`
  // clip points, rebuilding the bind groups when they change.
  private ensureCapacity(strokes: number, clipPoints: number) {
    let changed = false;
    if (strokes > this.strokeCapacity) {
      let cap = Math.max(this.strokeCapacity, 1024);
      while (cap < strokes) cap *= 2;
      this.strokeCapacity = cap;
      this.strokeBuffer?.destroy();
      this.vertexBuffer?.destroy();
      this.strokeBuffer = this.device.createBuffer({
        size: cap * FLOATS_PER_STROKE * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.vertexBuffer = this.device.createBuffer({
        size: cap * VERTS_PER_STROKE * BYTES_PER_VERTEX,
        usage: GPUBufferUsage.STORAGE,
      });
      changed = true;
    }
    if (clipPoints > this.clipCapacity) {
      let cap = Math.max(this.clipCapacity, 1024);
      while (cap < clipPoints) cap *= 2;
      this.clipCapacity = cap;
      this.clipBuffer?.destroy();
      this.clipBuffer = this.device.createBuffer({
        size: cap * 2 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      changed = true;
    }
    if (!changed || !this.strokeBuffer || !this.vertexBuffer) return;
    if (!this.clipBuffer) return;
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.pipelines.compute.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.strokeBuffer } },
        { binding: 1, resource: { buffer: this.vertexBuffer } },
        { binding: 2, resource: { buffer: this.countBuffer } },
      ],
    });
    this.renderBindGroup = this.device.createBindGroup({
      layout: this.pipelines.render.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.vertexBuffer } },
        { binding: 1, resource: { buffer: this.strokeBuffer } },
        { binding: 2, resource: { buffer: this.clipBuffer } },
        { binding: 3, resource: { buffer: this.viewBuffer } },
      ],
    });
  }
}

export class GpuBackend {
  private readonly screen: StrokeBatch;
  private msaaTexture?: GPUTexture;
  // Whether msaaTexture holds the last frame drawn, so a frame can draw over
  // it instead of clearing. Not after it's (re)created.
  private msaaHasFrame = false;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    private readonly pipelines: Pipelines,
  ) {
    this.screen = new StrokeBatch(device, pipelines);
  }

  /**
   * Null when WebGPU isn't available. The canvas only gets a WebGPU context
   * once a device is, so otherwise it can still be used for 2D.
   */
  static async create(canvas: HTMLCanvasElement): Promise<GpuBackend | null> {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) return null;
    const context = canvas.getContext("webgpu");
    if (!context) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    const compute = device.createComputePipeline({
      layout: "auto",
      compute: {
        module: device.createShaderModule({ code: COMPUTE_SHADER }),
        entryPoint: "main",
        constants: { SUBDIVISIONS },
      },
    });
    // The vertex shader pulls positions from the compute output by instance
    // (stroke) and vertex index, so there are no vertex buffers.
    const renderModule = device.createShaderModule({ code: RENDER_SHADER });
    const render = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: renderModule,
        entryPoint: "vs_main",
        constants: { VERTS_PER_STROKE },
      },
      fragment: {
        module: renderModule,
        entryPoint: "fs_main",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-strip" },
      multisample: { count: SAMPLE_COUNT },
    });
    return new GpuBackend(canvas, device, context, format, {
      compute,
      render,
    });
  }

  /**
   * Tessellate and draw the recorded strokes, on a white background if
   * `clear`, otherwise over the last frame drawn.
   */
  draw(rec: RecordingContext, clear = true) {
    const { device } = this;
    this.screen.upload(rec);
    this.ensureMsaaTexture();
    if (!this.msaaTexture) return;

    const encoder = device.createCommandEncoder();
    this.screen.encodeTessellate(encoder);
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.msaaTexture.createView(),
          resolveTarget: this.context.getCurrentTexture().createView(),
          clearValue: WHITE,
          loadOp: clear || !this.msaaHasFrame ? "clear" : "load",
          // Kept for the next frame to draw over when not clearing.
          storeOp: "store",
        },
      ],
    });
    this.screen.encodeDraw(pass);
    pass.end();
    device.queue.submit([encoder.finish()]);
    this.msaaHasFrame = true;
  }

  /**
   * Draw the recorded strokes into a new w x h 2D canvas, on white. It's drawn
   * a tile at a time and read back, so the size is limited by what a 2D canvas
   * can hold rather than by GPU texture limits.
   */
  async drawImage(
    rec: RecordingContext,
    w: number,
    h: number,
  ): Promise<HTMLCanvasElement> {
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D context for export");

    const { device, format } = this;
    const maxTile = Math.min(
      EXPORT_TILE_SIZE,
      device.limits.maxTextureDimension2D,
    );
    const tileW = Math.min(w, maxTile);
    const tileH = Math.min(h, maxTile);
    // Texture to buffer copies need rows padded to a multiple of 256 bytes.
    const bytesPerRow = Math.ceil((tileW * 4) / 256) * 256;
    const batch = new StrokeBatch(device, this.pipelines);
    const msaa = device.createTexture({
      size: [tileW, tileH],
      format,
      sampleCount: SAMPLE_COUNT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const resolved = device.createTexture({
      size: [tileW, tileH],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
      size: bytesPerRow * tileH,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const pixels = new ImageData(tileW, tileH);
    const bgra = format === "bgra8unorm";

    try {
      batch.upload(rec);
      let tessellated = false;
      for (let ty = 0; ty < h; ty += tileH) {
        for (let tx = 0; tx < w; tx += tileW) {
          batch.setView(w / tileW, h / tileH, -tx / tileW, -ty / tileH);
          const encoder = device.createCommandEncoder();
          if (!tessellated) {
            batch.encodeTessellate(encoder);
            tessellated = true;
          }
          const pass = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: msaa.createView(),
                resolveTarget: resolved.createView(),
                clearValue: WHITE,
                loadOp: "clear",
                storeOp: "discard",
              },
            ],
          });
          batch.encodeDraw(pass);
          pass.end();
          encoder.copyTextureToBuffer(
            { texture: resolved },
            { buffer: readback, bytesPerRow },
            [tileW, tileH],
          );
          device.queue.submit([encoder.finish()]);

          await readback.mapAsync(GPUMapMode.READ);
          const src = new Uint8Array(readback.getMappedRange());
          const dst = pixels.data;
          const rowBytes = tileW * 4;
          for (let y = 0; y < tileH; y++) {
            const s = y * bytesPerRow;
            const d = y * rowBytes;
            if (bgra) {
              for (let i = 0; i < rowBytes; i += 4) {
                dst[d + i] = src[s + i + 2];
                dst[d + i + 1] = src[s + i + 1];
                dst[d + i + 2] = src[s + i];
                dst[d + i + 3] = src[s + i + 3];
              }
            } else {
              dst.set(src.subarray(s, s + rowBytes), d);
            }
          }
          readback.unmap();
          // Tiles on the right and bottom edges can hang off the image;
          // putImageData drops what's outside.
          ctx.putImageData(pixels, tx, ty);
        }
      }
    } finally {
      batch.destroy();
      msaa.destroy();
      resolved.destroy();
      readback.destroy();
    }
    return out;
  }

  /** Resolves once the GPU has finished all work submitted so far. */
  whenIdle(): Promise<undefined> {
    return this.device.queue.onSubmittedWorkDone();
  }

  private ensureMsaaTexture() {
    const { width, height } = this.canvas;
    const t = this.msaaTexture;
    if (t && t.width === width && t.height === height) return;
    t?.destroy();
    this.msaaTexture = this.device.createTexture({
      size: [width, height],
      format: this.format,
      sampleCount: SAMPLE_COUNT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.msaaHasFrame = false;
  }
}
