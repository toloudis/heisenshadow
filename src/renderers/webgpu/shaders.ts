// WGSL for the WebGPU backend: a compute pass tessellates each stroke into a
// triangle strip, and a render pass draws one instance per stroke, clipping
// per sample against the stroke's polygon.

const STROKE_STRUCT = `
struct Stroke {
    p01: vec4f, p23: vec4f,
    widths: vec4f, // line width at p0, p1, p2, p3
    style: vec4f, // caps (start + 4 * end; each 0 butt, 1 round, 2 taper), taper fraction, clip polygon start, clip polygon point count
}
// cap: x is -1 or 1 on the start or end cap extension and 0 along the body,
// y is 1 or -1 on the left or right edge. Inside a round cap, x^2 + y^2 <= 1.
// coverage: the opacity drawn with, below 1 where the stroke is too thin to
// draw at its true width.
struct StripVertex { pos: vec2f, cap: vec2f, coverage: f32 }
`;

export const COMPUTE_SHADER = `
${STROKE_STRUCT}
struct TessParams {
    pixels_per_unit: vec2f, // render target size in pixels: paper is 0..1 across it
    stroke_count: u32,
    unused: u32,
}
@group(0) @binding(0) var<storage, read> input_strokes: array<Stroke>;
@group(0) @binding(1) var<storage, read_write> output_vertices: array<StripVertex>;
@group(0) @binding(2) var<uniform> params: TessParams;

override SUBDIVISIONS: u32;

const PI = 3.14159265;
// The narrowest a stroke is drawn, in pixels. MSAA can't resolve anything
// much thinner (it breaks up into dashes), so thinner strokes are drawn this
// wide and faded to match.
const MIN_WIDTH_PX = 1.0;

struct Edge { offset: vec2f, coverage: f32 }
// Offset from the centerline to the left edge, for half width h_width along
// tangent tan, and the coverage it's drawn with.
fn edge(tan: vec2f, h_width: f32) -> Edge {
    let n = vec2f(-tan.y, tan.x);
    // Pixels per paper unit across the stroke; paper x and y scale differently.
    let px_per_unit = length(n * params.pixels_per_unit);
    let width_px = 2.0 * h_width * px_per_unit;
    let min_h_width = 0.5 * MIN_WIDTH_PX / px_per_unit;
    return Edge(n * max(h_width, min_h_width), min(width_px / MIN_WIDTH_PX, 1.0));
}

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
// Line width at t: a cubic bezier through the four control point widths
// (clamped at 0, as negative middle widths can dip below), narrowed toward
// the tapered ends.
fn line_width(t: f32, stroke: Stroke) -> f32 {
    let mt = 1.0 - t;
    let k = stroke.widths;
    let w = max(mt*mt*mt*k.x + 3.0*mt*mt*t*k.y + 3.0*mt*t*t*k.z + t*t*t*k.w, 0.0);
    let caps = u32(stroke.style.x);
    // distance in t to the nearest tapered end (or 1 if neither is)
    let d = min(select(1.0, t, caps % 4u == 2u), select(1.0, mt, caps / 4u == 2u));
    let e = min(d / stroke.style.y, 1.0);
    return w * sin(0.5 * PI * e);
}

// For butt and taper ends the cap extensions have no length.
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
    let stroke_idx = global_id.x;
    if (stroke_idx >= params.stroke_count) { return; }

    let stroke = input_strokes[stroke_idx];
    let p0 = stroke.p01.xy;
    let p1 = stroke.p01.zw;
    let p2 = stroke.p23.xy;
    let p3 = stroke.p23.zw;
    let verts = (SUBDIVISIONS + 2u) * 2u;
    let vtx_offset = stroke_idx * verts;
    let caps = u32(stroke.style.x);
    let round_start = caps % 4u == 1u;
    let round_end = caps / 4u == 1u;

    // Round caps extend by the (possibly widened) half width at each end.
    let tan0 = sample_tangent(p0, p1, p2, p3, 0.0);
    let e0 = edge(tan0, 0.5 * line_width(0.0, stroke));
    let start_pos = p0 - tan0 * select(0.0, length(e0.offset), round_start);
    output_vertices[vtx_offset] = StripVertex(start_pos + e0.offset, vec2f(-1.0, 1.0), e0.coverage);
    output_vertices[vtx_offset + 1u] = StripVertex(start_pos - e0.offset, vec2f(-1.0, -1.0), e0.coverage);

    for (var i = 0u; i < SUBDIVISIONS; i++) {
        let t = f32(i) / f32(SUBDIVISIONS - 1u);
        let pos = sample_bezier(p0, p1, p2, p3, t);
        let e = edge(sample_tangent(p0, p1, p2, p3, t), 0.5 * line_width(t, stroke));
        let idx = vtx_offset + 2u + i * 2u;
        output_vertices[idx] = StripVertex(pos + e.offset, vec2f(0.0, 1.0), e.coverage);
        output_vertices[idx + 1u] = StripVertex(pos - e.offset, vec2f(0.0, -1.0), e.coverage);
    }

    let tan1 = sample_tangent(p0, p1, p2, p3, 1.0);
    let e1 = edge(tan1, 0.5 * line_width(1.0, stroke));
    let end_pos = p3 + tan1 * select(0.0, length(e1.offset), round_end);
    let end_idx = vtx_offset + verts - 2u;
    output_vertices[end_idx] = StripVertex(end_pos + e1.offset, vec2f(1.0, 1.0), e1.coverage);
    output_vertices[end_idx + 1u] = StripVertex(end_pos - e1.offset, vec2f(1.0, -1.0), e1.coverage);
}
`;

export const RENDER_SHADER = `
${STROKE_STRUCT}
// Sample interpolation runs the fragment shader per MSAA sample, so the
// discards below (round caps, clip polygon) are antialiased too.
struct VertexOut {
    @builtin(position) clip_pos: vec4f,
    @location(0) @interpolate(perspective, sample) paper_pos: vec2f,
    @location(1) @interpolate(perspective, sample) cap: vec2f,
    @location(2) coverage: f32,
    @location(3) @interpolate(flat) clip_range: vec2u, // start, count
}

// Written by the compute pass: VERTS_PER_STROKE vertices per stroke, in order.
@group(0) @binding(0) var<storage, read> vertices: array<StripVertex>;
@group(0) @binding(1) var<storage, read> strokes: array<Stroke>;
@group(0) @binding(2) var<storage, read> clip_points: array<vec2f>;
// Maps paper coordinates to 0..1 across the render target: scale in xy, then
// offset in zw. Identity for the screen; export draws in tiles.
@group(0) @binding(3) var<uniform> view: vec4f;
override VERTS_PER_STROKE: u32;

@vertex
fn vs_main(
    @builtin(vertex_index) vertex_idx: u32,
    @builtin(instance_index) stroke_idx: u32,
) -> VertexOut {
    let v = vertices[stroke_idx * VERTS_PER_STROKE + vertex_idx];
    let style = strokes[stroke_idx].style;
    // target coordinates are 0..1 with y down
    let target_pos = v.pos * view.xy + view.zw;
    let ndc = vec2f(target_pos.x * 2.0 - 1.0, 1.0 - target_pos.y * 2.0);
    return VertexOut(vec4f(ndc, 0.0, 1.0), v.pos, v.cap, v.coverage, vec2u(u32(style.z), u32(style.w)));
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
    // Black, faded by coverage (blended over what's there).
    return vec4f(0.0, 0.0, 0.0, in.coverage);
}
`;
