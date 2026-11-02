// Temporary benchmark: run the app's renderers on either canvas 2D (as in
// main.ts) or WebGPU, animating continuously, and report frame timings.
//
// The page layout matches main.ts (pane columns and console panel around the
// canvas), so the canvas comes out the same size. Both backends draw at that
// size, in CSS pixels.
//
// For WebGPU, each frame the renderer draws into a RecordingContext, which
// captures every stroke as a cubic bezier in 0..1 paper coordinates along with
// its line width and clip polygon. The strokes are uploaded, a compute pass
// tessellates them into triangle strips, and a render pass draws one instance
// per stroke, clipping per sample against the stroke's polygon.
//
// The standalone end cap demo that used to live here is in capDemo.ts.

import type { FolderApi } from "tweakpane";
import { Pane } from "tweakpane";

import "./style.css";
import { Animator } from "./animation";
import type { Canvas } from "./canvas";
import { loadParamsFromSearchParams, params } from "./params";
import { newRandomSeed, setRandomSeed } from "./rand";
import type { Renderer, RendererSetting } from "./renderer";
import { GridRenderer } from "./renderers/grid/gridRenderer";
import { gridParams } from "./renderers/grid/settings";
import { voronoiParams } from "./renderers/voronoi/settings";
import { VoronoiRadialRenderer } from "./renderers/voronoi/voronoiRadialRenderer";
import { VoronoiRadialRendererRetained } from "./renderers/voronoi/voronoiRadialRendererRetained";

// ---- Recording context ------------------------------------------------------

// How stroke ends are drawn. "round" matches the canvas renderers'
// lineCap = "round"; "taper" narrows the width to a point over the first and
// last taperFraction of each stroke.
const CAP_STYLES = { butt: 0, round: 1, taper: 2 };

// Packed layout matching the Stroke struct in both shaders:
// p0, p1, p2, p3 (8 floats);
// line width, cap style, taper fraction, width scale at p1;
// width scale at p2, clip polygon start, clip polygon point count, padding.
const FLOATS_PER_STROKE = 16;
// Saved state per save(): transform (6), clip start, clip count, line width.
const FLOATS_PER_SAVE = 9;

/**
 * Just enough of CanvasRenderingContext2D for the renderers and Cluster /
 * Stroke drawing. Tracks the transform, line width and clip, and records each
 * stroked bezier with its control points already transformed. Assumes the
 * transform only translates and rotates, so the line width needs no scaling.
 *
 * Clips are convex polygons (cell rects, voronoi cells). A clip replaces the
 * current one instead of intersecting with it; no renderer nests clips.
 *
 * It's reused every frame, writing into growable typed arrays, so recording
 * allocates nothing once the arrays are big enough.
 */
class RecordingContext {
  lineWidth = 1;
  // Not part of CanvasRenderingContext2D: the end style and width profile
  // recorded with each stroke. The renderers leave these at their defaults.
  capStyle: keyof typeof CAP_STYLES = "round";
  taperFraction = 0.5;
  // Line width scales at the two middle control points. The width along the
  // stroke is a cubic bezier through 1, width1, width2, 1.
  width1 = 1;
  width2 = 1;

  strokeData = new Float32Array(FLOATS_PER_STROKE * 1024);
  strokeCount = 0;
  clipPoints = new Float32Array(2 * 1024);
  clipPointCount = 0;

  // Affine transform as in canvas setTransform(a, b, c, d, e, f)
  private a = 1;
  private b = 0;
  private c = 0;
  private d = 1;
  private e = 0;
  private f = 0;
  private clipStart = 0;
  private clipCount = 0;
  private stack: number[] = [];
  private path = new Float32Array(2 * 64);
  private pathCount = 0;
  private pathHasCurve = false;

  /** Forget everything recorded, ready for a new frame. */
  reset() {
    this.strokeCount = 0;
    this.clipPointCount = 0;
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;
    this.clipStart = 0;
    this.clipCount = 0;
    this.stack.length = 0;
    this.lineWidth = 1;
    this.beginPath();
  }

  save() {
    this.stack.push(
      this.a,
      this.b,
      this.c,
      this.d,
      this.e,
      this.f,
      this.clipStart,
      this.clipCount,
      this.lineWidth,
    );
  }

  restore() {
    const s = this.stack;
    if (s.length < FLOATS_PER_SAVE) return;
    const i = s.length - FLOATS_PER_SAVE;
    this.a = s[i];
    this.b = s[i + 1];
    this.c = s[i + 2];
    this.d = s[i + 3];
    this.e = s[i + 4];
    this.f = s[i + 5];
    this.clipStart = s[i + 6];
    this.clipCount = s[i + 7];
    this.lineWidth = s[i + 8];
    s.length = i;
  }

  translate(x: number, y: number) {
    this.e += this.a * x + this.c * y;
    this.f += this.b * x + this.d * y;
  }

  rotate(r: number) {
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    const { a, b, c, d } = this;
    this.a = a * cr + c * sr;
    this.b = b * cr + d * sr;
    this.c = c * cr - a * sr;
    this.d = d * cr - b * sr;
  }

  beginPath() {
    this.pathCount = 0;
    this.pathHasCurve = false;
  }

  // As in canvas 2D, path calls with a non-finite coordinate are ignored.
  // (The voronoi cells' dilated outlines end in a NaN point.)
  moveTo(x: number, y: number) {
    if (!Number.isFinite(x + y)) return;
    this.pathCount = 0;
    this.addPoint(x, y);
  }

  lineTo(x: number, y: number) {
    if (!Number.isFinite(x + y)) return;
    this.addPoint(x, y);
  }

  closePath() {}

  rect(x: number, y: number, w: number, h: number) {
    this.addPoint(x, y);
    this.addPoint(x + w, y);
    this.addPoint(x + w, y + h);
    this.addPoint(x, y + h);
  }

  bezierCurveTo(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ) {
    if (!Number.isFinite(x1 + y1 + x2 + y2 + x3 + y3)) return;
    this.addPoint(x1, y1);
    this.addPoint(x2, y2);
    this.addPoint(x3, y3);
    this.pathHasCurve = true;
  }

  stroke() {
    if (!this.pathHasCurve || this.pathCount !== 4) return;
    const base = this.strokeCount * FLOATS_PER_STROKE;
    if (base + FLOATS_PER_STROKE > this.strokeData.length) {
      this.strokeData = grow(this.strokeData);
    }
    const out = this.strokeData;
    out.set(this.path.subarray(0, 8), base);
    out[base + 8] = this.lineWidth;
    out[base + 9] = CAP_STYLES[this.capStyle];
    out[base + 10] = this.taperFraction;
    out[base + 11] = this.width1;
    out[base + 12] = this.width2;
    out[base + 13] = this.clipStart;
    out[base + 14] = this.clipCount;
    out[base + 15] = 0;
    this.strokeCount++;
  }

  /** Make the current path the clip polygon, stored counter-clockwise. */
  clip() {
    const n = this.pathCount;
    if (n < 3) return;
    while ((this.clipPointCount + n) * 2 > this.clipPoints.length) {
      this.clipPoints = grow(this.clipPoints);
    }
    const p = this.path;
    let area2 = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area2 += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
    }
    const start = this.clipPointCount;
    const out = this.clipPoints;
    for (let i = 0; i < n; i++) {
      const src = area2 >= 0 ? i : n - 1 - i;
      out[(start + i) * 2] = p[src * 2];
      out[(start + i) * 2 + 1] = p[src * 2 + 1];
    }
    this.clipPointCount += n;
    this.clipStart = start;
    this.clipCount = n;
  }

  private addPoint(x: number, y: number) {
    if ((this.pathCount + 1) * 2 > this.path.length) {
      this.path = grow(this.path);
    }
    const i = this.pathCount * 2;
    this.path[i] = this.a * x + this.c * y + this.e;
    this.path[i + 1] = this.b * x + this.d * y + this.f;
    this.pathCount++;
  }
}

function grow(arr: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  const bigger = new Float32Array(arr.length * 2);
  bigger.set(arr);
  return bigger;
}

// ---- WebGPU backend ---------------------------------------------------------

const SUBDIVISIONS = 24;
// A cap extension pair, SUBDIVISIONS body pairs, and another cap extension pair.
const VERTS_PER_STROKE = (SUBDIVISIONS + 2) * 2;
const BYTES_PER_VERTEX = 16; // StripVertex is 4 floats
const SAMPLE_COUNT = 4;

const STROKE_STRUCT = `
struct Stroke {
    p01: vec4f, p23: vec4f,
    style: vec4f, // line width, cap style (0 butt, 1 round, 2 taper), taper fraction, width scale at p1
    extra: vec4f, // width scale at p2, clip polygon start, clip polygon point count, unused
}
// cap: x is -1 or 1 on the start or end cap extension and 0 along the body,
// y is 1 or -1 on the left or right edge. Inside a round cap, x^2 + y^2 <= 1.
struct StripVertex { pos: vec2f, cap: vec2f }
`;

const COMPUTE_SHADER = `
${STROKE_STRUCT}
@group(0) @binding(0) var<storage, read> input_strokes: array<Stroke>;
@group(0) @binding(1) var<storage, read_write> output_vertices: array<StripVertex>;
@group(0) @binding(2) var<uniform> stroke_count: vec4u; // count in x

override SUBDIVISIONS: u32;

const PI = 3.14159265;

fn sample_bezier(p0: vec2f, p1: vec2f, p2: vec2f, p3: vec2f, t: f32) -> vec2f {
    let mt = 1.0 - t;
    return mt*mt*mt*p0 + 3.0*mt*mt*t*p1 + 3.0*mt*t*t*p2 + t*t*t*p3;
}
fn sample_tangent(p0: vec2f, p1: vec2f, p2: vec2f, p3: vec2f, t: f32) -> vec2f {
    let mt = 1.0 - t;
    let d = -3.0*mt*mt*p0 + 3.0*(mt*mt - 2.0*t*mt)*p1 + 3.0*(2.0*t*mt - t*t)*p2 + 3.0*t*t*p3;
    // The derivative vanishes where a control point sits on its endpoint.
    if (dot(d, d) < 1e-20) { return normalize(p3 - p0); }
    return normalize(d);
}
// Fraction of the full line width at t: a cubic bezier through 1, width1,
// width2, 1, narrowed toward the ends for tapered strokes.
fn width_envelope(t: f32, stroke: Stroke) -> f32 {
    let mt = 1.0 - t;
    let w = mt*mt*mt + 3.0*mt*mt*t*stroke.style.w + 3.0*mt*t*t*stroke.extra.x + t*t*t;
    if (u32(stroke.style.y) == 2u) {
        let e = min(min(t, 1.0 - t) / stroke.style.z, 1.0);
        return w * sin(0.5 * PI * e);
    }
    return w;
}

// For butt and taper ends the cap extensions have no length.
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
    let stroke_idx = global_id.x;
    if (stroke_idx >= stroke_count.x) { return; }

    let stroke = input_strokes[stroke_idx];
    let p0 = stroke.p01.xy;
    let p1 = stroke.p01.zw;
    let p2 = stroke.p23.xy;
    let p3 = stroke.p23.zw;
    let h_width = stroke.style.x * 0.5;
    let verts = (SUBDIVISIONS + 2u) * 2u;
    let vtx_offset = stroke_idx * verts;
    let cap_len = select(0.0, h_width, u32(stroke.style.y) == 1u);

    let tan0 = sample_tangent(p0, p1, p2, p3, 0.0);
    let norm0 = vec2f(-tan0.y, tan0.x) * h_width * width_envelope(0.0, stroke);
    let start_pos = p0 - tan0 * cap_len;
    output_vertices[vtx_offset] = StripVertex(start_pos + norm0, vec2f(-1.0, 1.0));
    output_vertices[vtx_offset + 1u] = StripVertex(start_pos - norm0, vec2f(-1.0, -1.0));

    for (var i = 0u; i < SUBDIVISIONS; i++) {
        let t = f32(i) / f32(SUBDIVISIONS - 1u);
        let pos = sample_bezier(p0, p1, p2, p3, t);
        let tan = sample_tangent(p0, p1, p2, p3, t);
        let norm = vec2f(-tan.y, tan.x) * h_width * width_envelope(t, stroke);
        let idx = vtx_offset + 2u + i * 2u;
        output_vertices[idx] = StripVertex(pos + norm, vec2f(0.0, 1.0));
        output_vertices[idx + 1u] = StripVertex(pos - norm, vec2f(0.0, -1.0));
    }

    let tan1 = sample_tangent(p0, p1, p2, p3, 1.0);
    let norm1 = vec2f(-tan1.y, tan1.x) * h_width * width_envelope(1.0, stroke);
    let end_pos = p3 + tan1 * cap_len;
    let end_idx = vtx_offset + verts - 2u;
    output_vertices[end_idx] = StripVertex(end_pos + norm1, vec2f(1.0, 1.0));
    output_vertices[end_idx + 1u] = StripVertex(end_pos - norm1, vec2f(1.0, -1.0));
}
`;

const RENDER_SHADER = `
${STROKE_STRUCT}
// Sample interpolation runs the fragment shader per MSAA sample, so the
// discards below (round caps, clip polygon) are antialiased too.
struct VertexOut {
    @builtin(position) clip_pos: vec4f,
    @location(0) @interpolate(perspective, sample) paper_pos: vec2f,
    @location(1) @interpolate(perspective, sample) cap: vec2f,
    @location(2) @interpolate(flat) clip_range: vec2u, // start, count
}

// Written by the compute pass: VERTS_PER_STROKE vertices per stroke, in order.
@group(0) @binding(0) var<storage, read> vertices: array<StripVertex>;
@group(0) @binding(1) var<storage, read> strokes: array<Stroke>;
@group(0) @binding(2) var<storage, read> clip_points: array<vec2f>;
override VERTS_PER_STROKE: u32;

@vertex
fn vs_main(
    @builtin(vertex_index) vertex_idx: u32,
    @builtin(instance_index) stroke_idx: u32,
) -> VertexOut {
    let v = vertices[stroke_idx * VERTS_PER_STROKE + vertex_idx];
    let extra = strokes[stroke_idx].extra;
    // paper coordinates are 0..1 with y down
    let ndc = vec2f(v.pos.x * 2.0 - 1.0, 1.0 - v.pos.y * 2.0);
    return VertexOut(vec4f(ndc, 0.0, 1.0), v.pos, v.cap, vec2u(u32(extra.y), u32(extra.z)));
}

// Clip polygons are convex and counter-clockwise, so a point is inside when
// it is to the left of every edge. A count of 0 means no clip.
fn inside_clip(p: vec2f, range: vec2u) -> bool {
    for (var i = 0u; i < range.y; i++) {
        let a = clip_points[range.x + i];
        let b = clip_points[range.x + (i + 1u) % range.y];
        let e = b - a;
        let q = p - a;
        if (e.x * q.y - e.y * q.x < 0.0) { return false; }
    }
    return true;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
    // Round off the cap extensions. Along the body cap.x is 0 and |cap.y| <= 1,
    // so this only cuts the corners of the caps (allowing for rounding error).
    if (dot(in.cap, in.cap) > 1.0001 || !inside_clip(in.paper_pos, in.clip_range)) {
        discard;
    }
    return vec4f(0.0, 0.0, 0.0, 1.0);
}
`;

class GpuBackend {
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

// ---- Page setup -------------------------------------------------------------

loadParamsFromSearchParams(new URLSearchParams(window.location.search));

function element<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`${selector} not found`);
  return el;
}

// The 2D canvas is the page's own #canvas. A canvas can only ever have one
// kind of context, so WebGPU gets a second one beside it, and only the
// active backend's canvas is shown.
const canvas2d = element<HTMLCanvasElement>("#canvas");
const canvasGpu = document.createElement("canvas");
canvasGpu.style.backgroundColor = "white";
canvas2d.after(canvasGpu);
const ctx2dOrNull = canvas2d.getContext("2d");
if (!ctx2dOrNull) throw new Error("Failed to get 2D context from canvas");
const ctx2d = ctx2dOrNull;

// Set in start(); null when WebGPU isn't available.
let gpu: GpuBackend | null = null;
const recorder = new RecordingContext();

// Same as setupContext in canvas.ts: 0..1 drawing coordinates and the stroke
// defaults the renderers rely on.
function setup2dContext(w: number, h: number) {
  ctx2d.setTransform(w, 0, 0, h, 0, 0);
  ctx2d.lineWidth = 0.001;
  ctx2d.shadowBlur = 0;
  ctx2d.shadowColor = "rgb(0, 0, 0)";
  ctx2d.lineCap = "round";
  ctx2d.lineJoin = "round";
}

// The voronoi renderers only ask their Canvas for its size.
const paperSize = {
  width: () => canvas2d.width,
  height: () => canvas2d.height,
} as unknown as Canvas;

const MODES: Record<string, { title: string; create: () => Renderer }> = {
  voronoi: {
    title: "Voronoi",
    create: () => new VoronoiRadialRenderer(paperSize, "plain"),
  },
  "voronoi-radial": {
    title: "Voronoi Radial",
    create: () => new VoronoiRadialRenderer(paperSize, "radial"),
  },
  retained: {
    title: "Retained",
    create: () => new VoronoiRadialRendererRetained(paperSize),
  },
  grid: { title: "Grid", create: () => new GridRenderer() },
};

// Benchmark settings can also come from the URL (mode, backend, draws, wait),
// e.g. ?mode=voronoi&backend=canvas2d&draws=5&wait=1, for scripted runs.
const search = new URLSearchParams(window.location.search);
const urlMode = search.get("mode") ?? "";
const state = {
  mode: urlMode in MODES ? urlMode : "grid",
  backend: "canvas2d", // switched to "webgpu" in start() when available
  playing: true,
  // Draws per animation frame. Only the last is shown; raise it to measure
  // past the display's refresh rate.
  drawsPerFrame: Number(search.get("draws") ?? 1) || 1,
  // Wait for the GPU to finish each frame before timing it (canvas 2D: read
  // back a pixel), so frame time includes GPU work.
  waitForGpu: search.get("wait") === "1",
};
let renderer = MODES[state.mode].create();

/** The WebGPU backend when it's the active one. */
function activeGpu(): GpuBackend | null {
  return state.backend === "webgpu" ? gpu : null;
}

function showActiveCanvas() {
  const webgpu = activeGpu() !== null;
  canvas2d.style.display = webgpu ? "none" : "block";
  canvasGpu.style.display = webgpu ? "block" : "none";
}

// Fit both canvases to the container at the paper's aspect ratio, as
// Canvas.setCanvasSize does in main.ts.
function setCanvasSize() {
  const container = canvas2d.parentElement;
  const availW = container?.clientWidth ?? window.innerWidth;
  const availH = container?.clientHeight ?? window.innerHeight;
  let w = availW;
  let h = availH;
  if (params.canvasAspect > availW / availH) {
    h = w / params.canvasAspect;
  } else {
    w = h * params.canvasAspect;
  }
  w = Math.floor(w);
  h = Math.floor(h);
  if (w === canvas2d.width && h === canvas2d.height) return;
  for (const c of [canvas2d, canvasGpu]) {
    c.width = w;
    c.height = h;
  }
  setup2dContext(w, h);
  renderer.resize(w, h);
  if (!state.playing) drawFrame(0);
}

// ---- Animation --------------------------------------------------------------

// As in main.ts: line length can follow a sine wave. Its amplitude is
// exposed below so the grid, which is otherwise static, animates too.
const animator = new Animator();
const lineLengthWave = animator
  .channel({ waveform: "sine", frequency: 0.5, amplitude: 1 })
  .drive(voronoiParams, "linelength", { depth: 0.03, min: 0 })
  .drive(gridParams, "lineLength", { depth: 0.5, min: 0 });
// Thickness variation defaults to 0 and can't go below it, so this wave only
// rises: from the base value up by depth and back, (1 - cos) / 2 going 0..1.
// A different frequency from the length wave keeps the two out of step.
// (Voronoi's plain mode doesn't use thickness variation.)
const thicknessVariationWave = animator
  .channel({
    waveform: (p) => (1 - Math.cos(2 * Math.PI * p)) / 2,
    frequency: 0.3,
    amplitude: 1,
  })
  .drive(voronoiParams, "thicknessVariation", { depth: 1, min: 0, max: 1 })
  .drive(gridParams, "thicknessVariation", { depth: 1, min: 0, max: 1 });

// Draw one frame with the active backend, as Canvas.renderFrame does.
function drawOnce(dt: number) {
  setRandomSeed(newRandomSeed());
  animator.tick(state.playing, params.speed / 5);
  animator.apply();
  try {
    const g = activeGpu();
    if (g) {
      recorder.reset();
      renderer.render(recorder as unknown as CanvasRenderingContext2D, dt);
      g.draw(recorder);
    } else {
      const oldFill = ctx2d.fillStyle;
      ctx2d.fillStyle = "rgba(255,255,255,1)";
      ctx2d.fillRect(0, 0, canvas2d.width, canvas2d.height);
      ctx2d.fillStyle = oldFill;
      renderer.render(ctx2d, dt);
    }
  } finally {
    animator.restore();
  }
}

// Timing window, reported about once a second.
const stats = {
  windowStart: performance.now(),
  frames: 0,
  cpuSum: 0,
  cpuMax: 0,
  gpuSum: 0,
  gpuCount: 0,
};

async function drawFrame(dt: number) {
  const start = performance.now();
  const draws = Math.max(1, Math.round(state.drawsPerFrame));
  for (let i = 0; i < draws; i++) {
    drawOnce(dt / draws);
  }
  const g = activeGpu();
  if (g) {
    // How long after submitting the GPU finishes, measured without blocking.
    const submitted = performance.now();
    const done = g.whenIdle();
    done.then(() => {
      stats.gpuSum += performance.now() - submitted;
      stats.gpuCount++;
    });
    if (state.waitForGpu) await done;
  } else if (state.waitForGpu) {
    ctx2d.getImageData(0, 0, 1, 1);
  }
  const cpu = performance.now() - start;
  stats.frames++;
  stats.cpuSum += cpu;
  stats.cpuMax = Math.max(stats.cpuMax, cpu);
}

let lastT: number | undefined;
let rafId = 0;
async function animate(t: DOMHighResTimeStamp) {
  const dt = lastT === undefined ? 0 : t - lastT;
  lastT = t;
  await drawFrame(dt);
  reportStats();
  if (state.playing) rafId = requestAnimationFrame(animate);
}

function setPlaying(playing: boolean) {
  state.playing = playing;
  cancelAnimationFrame(rafId);
  lastT = undefined;
  if (playing) rafId = requestAnimationFrame(animate);
}

// ---- Panes ------------------------------------------------------------------

const leftPane = new Pane({ container: element("#left-panes") });
const rightPane = new Pane({ container: element("#right-panes") });

const statsEl = document.createElement("pre");
statsEl.style.cssText =
  "color: #ddd; font: 12px/1.5 monospace; margin: 8px 4px; white-space: pre-wrap;";
element("#left-panes").append(statsEl);

function reportStats() {
  const now = performance.now();
  const elapsed = now - stats.windowStart;
  if (elapsed < 1000 || stats.frames === 0) return;
  const g = activeGpu();
  const fps = (stats.frames * 1000) / elapsed;
  const lines = [
    `backend   ${g ? "WebGPU" : "canvas 2D"}`,
    `canvas    ${canvas2d.width} x ${canvas2d.height}`,
    `fps       ${fps.toFixed(1)}`,
    `frame     ${(elapsed / stats.frames).toFixed(2)} ms`,
    `cpu       ${(stats.cpuSum / stats.frames).toFixed(2)} ms avg, ${stats.cpuMax.toFixed(2)} max`,
  ];
  if (g) {
    const gpuMs = stats.gpuCount ? stats.gpuSum / stats.gpuCount : 0;
    lines.push(
      `gpu done  ${gpuMs.toFixed(2)} ms after submit`,
      `strokes   ${recorder.strokeCount} per draw`,
    );
  }
  if (!gpu) lines.push("", "WebGPU is not available in this browser.");
  statsEl.textContent = lines.join("\n");
  Object.assign(stats, {
    windowStart: now,
    frames: 0,
    cpuSum: 0,
    cpuMax: 0,
    gpuSum: 0,
    gpuCount: 0,
  });
}

function buildBenchmarkPane() {
  const fBench = leftPane.addFolder({ title: "Benchmark" });
  fBench
    .addBinding(state, "mode", {
      label: "renderer",
      options: Object.fromEntries(
        Object.entries(MODES).map(([id, m]) => [m.title, id]),
      ),
    })
    .on("change", () => {
      renderer = MODES[state.mode].create();
      renderer.resize(canvas2d.width, canvas2d.height);
      showRendererSettings();
    });
  fBench
    .addBinding(state, "backend", {
      options: gpu
        ? { "canvas 2D": "canvas2d", WebGPU: "webgpu" }
        : { "canvas 2D": "canvas2d" },
    })
    .on("change", showActiveCanvas);
  fBench
    .addBinding(state, "playing")
    .on("change", () => setPlaying(state.playing));
  fBench.addBinding(state, "drawsPerFrame", {
    label: "draws / frame",
    min: 1,
    max: 20,
    step: 1,
  });
  fBench.addBinding(state, "waitForGpu", { label: "wait for GPU" });
  fBench.addBinding(params, "speed", { min: 0, max: 10 });
  fBench.addBinding(lineLengthWave, "amplitude", {
    label: "length wave",
    min: 0,
    max: 1,
  });
  fBench.addBinding(thicknessVariationWave, "amplitude", {
    label: "thickness wave",
    min: 0,
    max: 1,
  });
}

// The active renderer's settings, as in main.ts.
let rendererSettingsFolder: FolderApi | undefined;
function showRendererSettings() {
  rendererSettingsFolder?.dispose();
  rendererSettingsFolder = undefined;
  const settings = renderer.settings?.() ?? [];
  if (settings.length === 0) return;
  rendererSettingsFolder = rightPane.addFolder({
    title: `${MODES[state.mode].title} Settings`,
  });
  for (const s of settings) {
    addSettingBinding(rendererSettingsFolder, s);
  }
}

// Turn a renderer's setting description into a Tweakpane binding. Number
// ranges apply to plain numbers, or to both axes of an {x, y} point.
function addSettingBinding(folder: FolderApi, s: RendererSetting) {
  const value = (s.target as Record<string, unknown>)[s.key];
  const isPoint =
    typeof value === "object" && value !== null && "x" in value && "y" in value;
  const range = definedOnly({ min: s.min, max: s.max });
  const options = isPoint
    ? { label: s.label, x: range, y: range }
    : s.options
      ? { label: s.label, options: s.options }
      : { label: s.label, ...range, ...definedOnly({ step: s.step }) };
  const binding = folder.addBinding(
    s.target as Record<string, unknown>,
    s.key,
    definedOnly(options),
  );
  if (s.tooltip) binding.element.title = s.tooltip;
}

// Drop undefined entries, so Tweakpane only sees options that were given.
function definedOnly<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

// ---- Start ------------------------------------------------------------------

async function start() {
  gpu = await GpuBackend.create(canvasGpu);
  if (gpu && search.get("backend") !== "canvas2d") state.backend = "webgpu";
  showActiveCanvas();
  buildBenchmarkPane();
  showRendererSettings();
  // Redraw on any change while paused, so it shows.
  for (const p of [leftPane, rightPane]) {
    p.on("change", () => {
      if (!state.playing) drawFrame(0);
    });
  }
  setCanvasSize();
  const container = canvas2d.parentElement;
  if (container) new ResizeObserver(setCanvasSize).observe(container);
  setPlaying(true);
}

start();
