import { FLOATS_PER_STROKE, type RecordingContext } from "./recordingContext";
import { COMPUTE_SHADER, RENDER_SHADER } from "./shaders";

const SUBDIVISIONS = 24;
// A cap extension pair, SUBDIVISIONS body pairs, and another cap extension pair.
const VERTS_PER_STROKE = (SUBDIVISIONS + 2) * 2;
const BYTES_PER_VERTEX = 16; // StripVertex is 4 floats
const SAMPLE_COUNT = 4;

export class GpuBackend {
  private strokeCapacity = 0;
  private clipCapacity = 0;
  private strokeBuffer?: GPUBuffer;
  private vertexBuffer?: GPUBuffer;
  private clipBuffer?: GPUBuffer;
  private computeBindGroup?: GPUBindGroup;
  private renderBindGroup?: GPUBindGroup;
  private msaaTexture?: GPUTexture;
  private readonly countBuffer: GPUBuffer;
  private readonly countData = new Uint32Array(4);

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    private readonly cPipeline: GPUComputePipeline,
    private readonly rPipeline: GPURenderPipeline,
  ) {
    this.countBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.ensureCapacity(1024, 1024);
  }

  static async create(canvas: HTMLCanvasElement): Promise<GpuBackend | null> {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    const context = canvas.getContext("webgpu");
    if (!device || !context) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    const cPipeline = device.createComputePipeline({
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
    const rPipeline = device.createRenderPipeline({
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
    return new GpuBackend(
      canvas,
      device,
      context,
      format,
      cPipeline,
      rPipeline,
    );
  }

  /** Tessellate and draw the recorded strokes, on a white background. */
  draw(rec: RecordingContext) {
    const { device } = this;
    const n = rec.strokeCount;
    this.ensureCapacity(n, rec.clipPointCount);
    this.ensureMsaaTexture();
    if (
      !this.strokeBuffer ||
      !this.clipBuffer ||
      !this.computeBindGroup ||
      !this.renderBindGroup ||
      !this.msaaTexture
    ) {
      return;
    }
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

    const encoder = device.createCommandEncoder();
    if (n > 0) {
      const cPass = encoder.beginComputePass();
      cPass.setPipeline(this.cPipeline);
      cPass.setBindGroup(0, this.computeBindGroup);
      cPass.dispatchWorkgroups(Math.ceil(n / 64));
      cPass.end();
    }
    const rPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.msaaTexture.createView(),
          resolveTarget: this.context.getCurrentTexture().createView(),
          clearValue: [1.0, 1.0, 1.0, 1.0],
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
    });
    if (n > 0) {
      rPass.setPipeline(this.rPipeline);
      rPass.setBindGroup(0, this.renderBindGroup);
      rPass.draw(VERTS_PER_STROKE, n);
    }
    rPass.end();
    device.queue.submit([encoder.finish()]);
  }

  /** Resolves once the GPU has finished all work submitted so far. */
  whenIdle(): Promise<undefined> {
    return this.device.queue.onSubmittedWorkDone();
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
      layout: this.cPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.strokeBuffer } },
        { binding: 1, resource: { buffer: this.vertexBuffer } },
        { binding: 2, resource: { buffer: this.countBuffer } },
      ],
    });
    this.renderBindGroup = this.device.createBindGroup({
      layout: this.rPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.vertexBuffer } },
        { binding: 1, resource: { buffer: this.strokeBuffer } },
        { binding: 2, resource: { buffer: this.clipBuffer } },
      ],
    });
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
  }
}
