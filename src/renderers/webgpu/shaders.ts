// WGSL for the WebGPU backend: a compute pass tessellates each stroke into a
// triangle strip, and a render pass draws one instance per stroke, clipping
// per sample against the stroke's polygon.

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

export const COMPUTE_SHADER = `
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

export const RENDER_SHADER = `
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
