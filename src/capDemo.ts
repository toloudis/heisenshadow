// Standalone WebGPU end cap demo (the earlier main2.ts). To run it, point
// the script tag in index.html at /src/capDemo.ts.
import { params } from "./params";
import { GridRenderer } from "./renderers/grid/gridRenderer";

// Temporary test: draw strokes with WebGPU instead of canvas 2D. Strokes are
// drawn into a recording context, which captures every stroke as a cubic
// bezier (see RecordingContext for the coordinate space). A compute pass
// tessellates the curves into triangle strips and a render pass draws one
// instance per stroke.
//
// SCENE picks what is recorded: "grid" runs the grid renderer unchanged with
// its default params; "capDemo" draws a few short, thick strokes to show the
// end caps.
const SCENE: "grid" | "capDemo" = "capDemo";

// How stroke ends are drawn. "round" matches the canvas renderer's
// lineCap = "round"; "taper" narrows the width to a point over the first and
// last taperFraction of each stroke (0.5 tapers the whole stroke, sin(pi*t)).
const CAP_STYLES = { butt: 0, round: 1, taper: 2 };

// Packed layout matching the Stroke struct in both shaders:
// p0, p1, p2, p3 (8 floats), clip rect minx, miny, maxx, maxy (4 floats),
// line width, cap style, taper fraction, width scales at p1 and p2, then
// padding to a 16-byte multiple.
const FLOATS_PER_STROKE = 20;

/** Scale from paper coordinates to units of the shorter paper side. */
function uniformPaperScale(aspect: number): [number, number] {
  return aspect <= 1 ? [1, 1 / aspect] : [aspect, 1];
}

/**
 * Just enough of CanvasRenderingContext2D for GridRenderer.drawGrid and
 * Stroke.draw. Tracks the transform, line width and an axis-aligned clip
 * rect, and records each stroked bezier with its control points already
 * transformed. Assumes the transform only translates and rotates on top of
 * the base scale, so the line width needs no scaling.
 *
 * Callers always position things in 0..1 paper coordinates. The base scale
 * (scaleX, scaleY) maps those into the recorded space, which is where
 * rotations, line widths and caps are laid out:
 * - (1, 1) records in paper space, matching canvas 2D. On non-square paper
 *   the marks are stretched along the long side.
 * - uniformPaperScale() records in a space where 1 unit is the shorter paper
 *   side along both axes, so the marks look the same at any aspect ratio.
 */
class RecordingContext {
  lineWidth = 1;
  // Not part of CanvasRenderingContext2D: the end style recorded with each
  // stroke. The grid renderer leaves these at their defaults.
  capStyle: keyof typeof CAP_STYLES = "round";
  taperFraction = 0.5;
  // Line width scales at the two middle control points. The width along the
  // stroke is a cubic bezier through 1, width1, width2, 1, so the ends keep
  // the full lineWidth.
  width1 = 1;
  width2 = 1;
  readonly strokes: number[] = [];

  // Affine transform as in canvas setTransform(a, b, c, d, e, f)
  private m: number[];
  private clipRect = [-Infinity, -Infinity, Infinity, Infinity];
  private pathRect: number[] | null = null;
  private path: number[] = [];
  private stack: { m: number[]; clipRect: number[]; lineWidth: number }[] = [];

  constructor(
    readonly scaleX = 1,
    readonly scaleY = 1,
  ) {
    this.m = [scaleX, 0, 0, scaleY, 0, 0];
  }

  save() {
    this.stack.push({
      m: [...this.m],
      clipRect: [...this.clipRect],
      lineWidth: this.lineWidth,
    });
  }

  restore() {
    const s = this.stack.pop();
    if (!s) return;
    this.m = s.m;
    this.clipRect = s.clipRect;
    this.lineWidth = s.lineWidth;
  }

  translate(x: number, y: number) {
    const [a, b, c, d, e, f] = this.m;
    this.m = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
  }

  rotate(r: number) {
    const [a, b, c, d, e, f] = this.m;
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    this.m = [
      a * cr + c * sr,
      b * cr + d * sr,
      c * cr - a * sr,
      d * cr - b * sr,
      e,
      f,
    ];
  }

  beginPath() {
    this.path = [];
    this.pathRect = null;
  }

  rect(x: number, y: number, w: number, h: number) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [px, py] of [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ]) {
      const [tx, ty] = this.apply(px, py);
      xs.push(tx);
      ys.push(ty);
    }
    this.pathRect = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ];
  }

  clip() {
    if (!this.pathRect) return;
    const c = this.clipRect;
    const r = this.pathRect;
    this.clipRect = [
      Math.max(c[0], r[0]),
      Math.max(c[1], r[1]),
      Math.min(c[2], r[2]),
      Math.min(c[3], r[3]),
    ];
  }

  moveTo(x: number, y: number) {
    this.path = [...this.apply(x, y)];
  }

  bezierCurveTo(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ) {
    this.path.push(
      ...this.apply(x1, y1),
      ...this.apply(x2, y2),
      ...this.apply(x3, y3),
    );
  }

  stroke() {
    if (this.path.length !== 8) return;
    this.strokes.push(
      ...this.path,
      ...this.clipRect,
      this.lineWidth,
      CAP_STYLES[this.capStyle],
      this.taperFraction,
      this.width1,
      this.width2,
      0,
      0,
      0,
    );
  }

  private apply(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.m;
    return [a * x + c * y + e, b * x + d * y + f];
  }
}

const STROKE_STRUCT = `
struct Stroke {
    p01: vec4f, p23: vec4f,
    clip: vec4f, // minx, miny, maxx, maxy in recorded space
    line_width: f32,
    cap_style: f32, // 0 butt, 1 round, 2 taper
    taper_fraction: f32,
    width1: f32, // line width scales at p1 and p2
    width2: f32,
    pad0: f32, pad1: f32, pad2: f32,
}
`;

const COMPUTE_SHADER = `
${STROKE_STRUCT}
// cap: x is -1 or 1 on the start or end cap extension and 0 along the body,
// y is 1 or -1 on the left or right edge. Inside a round cap, x^2 + y^2 <= 1.
struct StripVertex { pos: vec2f, cap: vec2f }

@group(0) @binding(0) var<storage, read> input_strokes: array<Stroke>;
@group(0) @binding(1) var<storage, read_write> output_vertices: array<StripVertex>;
@group(0) @binding(2) var<storage, read_write> draw_args: vec4u;

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
    let w = mt*mt*mt + 3.0*mt*mt*t*stroke.width1 + 3.0*mt*t*t*stroke.width2 + t*t*t;
    if (u32(stroke.cap_style) == 2u) {
        let e = min(min(t, 1.0 - t) / stroke.taper_fraction, 1.0);
        return w * sin(0.5 * PI * e);
    }
    return w;
}

// Each strip is a cap extension pair, SUBDIVISIONS body pairs, and another
// cap extension pair. For butt and taper ends the extensions have no length.
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
    let stroke_idx = global_id.x;
    if (stroke_idx >= arrayLength(&input_strokes)) { return; }

    let stroke = input_strokes[stroke_idx];
    let p0 = stroke.p01.xy;
    let p1 = stroke.p01.zw;
    let p2 = stroke.p23.xy;
    let p3 = stroke.p23.zw;
    let h_width = stroke.line_width * 0.5;
    let verts = (SUBDIVISIONS + 2u) * 2u;
    let vtx_offset = stroke_idx * verts;
    let cap_len = select(0.0, h_width, u32(stroke.cap_style) == 1u);

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

    // One instance per stroke, each a separate strip.
    if (stroke_idx == 0u) {
        draw_args[0] = verts;
        draw_args[1] = arrayLength(&input_strokes); draw_args[2] = 0u; draw_args[3] = 0u;
    }
}
`;

const RENDER_SHADER = `
${STROKE_STRUCT}
struct StripVertex { pos: vec2f, cap: vec2f }

// Sample interpolation runs the fragment shader per MSAA sample, so the
// discards below (round caps, cell clip) are antialiased too.
struct VertexOut {
    @builtin(position) clip_pos: vec4f,
    @location(0) @interpolate(perspective, sample) rec_pos: vec2f, // recorded space
    @location(1) @interpolate(perspective, sample) cap: vec2f,
    @location(2) @interpolate(flat) clip: vec4f,
}

// Written by the compute pass: VERTS_PER_STROKE vertices per stroke, in order.
@group(0) @binding(0) var<storage, read> vertices: array<StripVertex>;
@group(0) @binding(1) var<storage, read> strokes: array<Stroke>;
override VERTS_PER_STROKE: u32;
// The recorder's base scale, from paper coordinates to recorded space.
override SCALE_X: f32;
override SCALE_Y: f32;

@vertex
fn vs_main(
    @builtin(vertex_index) vertex_idx: u32,
    @builtin(instance_index) stroke_idx: u32,
) -> VertexOut {
    let v = vertices[stroke_idx * VERTS_PER_STROKE + vertex_idx];
    // paper coordinates are 0..1 with y down
    let paper = v.pos / vec2f(SCALE_X, SCALE_Y);
    let ndc = vec2f(paper.x * 2.0 - 1.0, 1.0 - paper.y * 2.0);
    return VertexOut(vec4f(ndc, 0.0, 1.0), v.pos, v.cap, strokes[stroke_idx].clip);
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
    if (any(in.rec_pos < in.clip.xy) || any(in.rec_pos > in.clip.zw)) {
        discard;
    }
    // Round off the cap extensions. Along the body cap.x is 0 and |cap.y| <= 1,
    // so this only cuts the corners of the caps (allowing for rounding error).
    if (dot(in.cap, in.cap) > 1.0001) {
        discard;
    }
    return vec4f(0.0, 0.0, 0.0, 1.0);
}
`;

/**
 * Rows of short, thick strokes, each row a different end style:
 * round, then taper over the whole stroke, then taper over just the ends,
 * then butt for reference. The left half of the columns has uniform
 * thickness; the right half repeats the same strokes, but swelling toward p1
 * and thinning toward p2. Across each half the strokes turn and bend more.
 * Positions are in paper coordinates; lengths and widths are in units of the
 * shorter paper side (recorded with uniformPaperScale).
 */
function recordCapDemo(ctx: RecordingContext) {
  const rows: { capStyle: keyof typeof CAP_STYLES; taperFraction: number }[] = [
    { capStyle: "round", taperFraction: 0.5 },
    { capStyle: "taper", taperFraction: 0.5 },
    { capStyle: "taper", taperFraction: 0.2 },
    { capStyle: "butt", taperFraction: 0.5 },
  ];
  const cols = 6;
  const halfCols = cols / 2;
  const halfLen = 0.06;
  rows.forEach((row, r) => {
    ctx.capStyle = row.capStyle;
    ctx.taperFraction = row.taperFraction;
    for (let c = 0; c < cols; c++) {
      // position within the half, so each right stroke matches its left twin
      const k = c % halfCols;
      const bend = (k / (halfCols - 1)) * halfLen;
      ctx.save();
      ctx.translate(0.1 + c * 0.16, 0.14 + r * 0.24);
      ctx.rotate(((k - (halfCols - 1) / 2) * 30 * Math.PI) / 180);
      ctx.lineWidth = 0.025 + 0.01 * (k % 2);
      const varied = c >= halfCols;
      ctx.width1 = varied ? 2.0 : 1.0;
      ctx.width2 = varied ? 0.4 : 1.0;
      ctx.beginPath();
      ctx.moveTo(0, -halfLen);
      ctx.bezierCurveTo(bend, -halfLen / 3, -bend, halfLen / 3, 0, halfLen);
      ctx.stroke();
      ctx.restore();
    }
  });
}

export async function runTestApp() {
  // 1. Initialize Canvas and WebGPU context. The canvas fills the window at
  // the paper's aspect ratio.
  document.getElementById("app")?.style.setProperty("display", "none");
  document.body.style.margin = "0";
  const aspect = params.canvasAspect;
  const cssH = Math.min(window.innerHeight, window.innerWidth / aspect);
  const cssW = cssH * aspect;
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  document.body.appendChild(canvas);

  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    alert("WebGPU is not supported on this browser.");
    return;
  }

  const context = canvas.getContext("webgpu");
  if (!context) {
    alert("Could not get a WebGPU canvas context.");
    return;
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  // 2. Record the strokes
  // The grid renderer lays out its strokes in paper space, like canvas 2D.
  const recorder =
    SCENE === "grid"
      ? new RecordingContext()
      : new RecordingContext(...uniformPaperScale(aspect));
  if (SCENE === "grid") {
    new GridRenderer().render(
      recorder as unknown as CanvasRenderingContext2D,
      0,
    );
  } else {
    recordCapDemo(recorder);
  }
  const rawData = new Float32Array(recorder.strokes);
  const totalStrokes = rawData.length / FLOATS_PER_STROKE;
  const subdivisions = 24;
  const vertsPerStroke = (subdivisions + 2) * 2;
  const sampleCount = 4;

  // 3. Setup Compute Pipeline
  const cPipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: device.createShaderModule({ code: COMPUTE_SHADER }),
      entryPoint: "main",
      constants: { SUBDIVISIONS: subdivisions },
    },
  });

  // 4. Setup Render Pipeline. The vertex shader pulls positions from the
  // compute output by instance (stroke) and vertex index, so there are no
  // vertex buffers.
  const renderModule = device.createShaderModule({ code: RENDER_SHADER });
  const rPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: renderModule,
      entryPoint: "vs_main",
      constants: {
        VERTS_PER_STROKE: vertsPerStroke,
        SCALE_X: recorder.scaleX,
        SCALE_Y: recorder.scaleY,
      },
    },
    fragment: {
      module: renderModule,
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-strip" },
    multisample: { count: sampleCount },
  });

  // 5. Create and pack target GPU storage buffers
  const strokeBuffer = device.createBuffer({
    size: rawData.byteLength,
    usage: GPUBufferUsage.STORAGE,
    mappedAtCreation: true,
  });
  new Float32Array(strokeBuffer.getMappedRange()).set(rawData);
  strokeBuffer.unmap();

  const vertexOutBuffer = device.createBuffer({
    size: totalStrokes * vertsPerStroke * 16, // StripVertex is 4 floats
    usage: GPUBufferUsage.STORAGE,
  });
  const indirectBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
  });
  const msaaTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format,
    sampleCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const computeBindGroup = device.createBindGroup({
    layout: cPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: strokeBuffer } },
      { binding: 1, resource: { buffer: vertexOutBuffer } },
      { binding: 2, resource: { buffer: indirectBuffer } },
    ],
  });
  const renderBindGroup = device.createBindGroup({
    layout: rPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: vertexOutBuffer } },
      { binding: 1, resource: { buffer: strokeBuffer } },
    ],
  });

  // 6. Submit Execution Directives
  const encoder = device.createCommandEncoder();

  const cPass = encoder.beginComputePass();
  cPass.setPipeline(cPipeline);
  cPass.setBindGroup(0, computeBindGroup);
  cPass.dispatchWorkgroups(Math.ceil(totalStrokes / 64));
  cPass.end();

  const rPass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: msaaTexture.createView(),
        resolveTarget: context.getCurrentTexture().createView(),
        clearValue: [1.0, 1.0, 1.0, 1.0],
        loadOp: "clear",
        storeOp: "discard",
      },
    ],
  });
  rPass.setPipeline(rPipeline);
  rPass.setBindGroup(0, renderBindGroup);
  rPass.drawIndirect(indirectBuffer, 0);
  rPass.end();

  device.queue.submit([encoder.finish()]);
}

// Auto-run when module is loaded
runTestApp();
