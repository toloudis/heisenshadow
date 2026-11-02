// Define configurations matching the GitHub implementation properties
interface StrokeOptions {
  sizeX: number;
  sizeY: number;
  lengthVariation: number;
  variability: number;
}

// Packed layout matching the explicit struct structure of the compute shader
const FLOATS_PER_STROKE = 12;

const COMPUTE_SHADER = `
struct StrokeConfig {
    size_x: f32, size_y: f32, length_variation: f32, variability: f32,
    cluster_x: f32, cluster_y: f32, cluster_ang: f32, line_width: f32,
    offset_x: f32, random_seed: f32, subdivisions: f32, pad: f32,
}
struct VertexOutput { @location(0) position: vec2f }

@group(0) @binding(0) var<storage, read> input_strokes: array<StrokeConfig>;
@group(0) @binding(1) var<storage, read_write> output_vertices: array<VertexOutput>;
@group(0) @binding(2) var<storage, read_write> draw_args: vec4u;

fn rand_hash(seed: u32) -> f32 {
    var x = seed;
    x ^= x >> 17u; x *= 0xed5ad4bbu; x ^= x >> 11u;
    x *= 0xac4c1b51u; x ^= x >> 15u; x *= 0x31848babu; x ^= x >> 14u;
    return f32(x) / 4294967295.0;
}
fn rand_range(seed: u32, min_v: f32, max_v: f32) -> f32 {
    return min_v + (max_v - min_v) * rand_hash(seed);
}
fn sample_bezier(p0: vec2f, p1: vec2f, p2: vec2f, p3: vec2f, t: f32) -> vec2f {
    let mt = 1.0 - t;
    return mt*mt*mt*p0 + 3.0*mt*mt*t*p1 + 3.0*mt*t*t*p2 + t*t*t*p3;
}
fn sample_tangent(p0: vec2f, p1: vec2f, p2: vec2f, p3: vec2f, t: f32) -> vec2f {
    let mt = 1.0 - t;
    return normalize(-3.0*mt*mt*p0 + 3.0*(mt*mt - 2.0*t*mt)*p1 + 3.0*(2.0*t*mt - t*t)*p2 + 3.0*t*t*p3);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
    let stroke_idx = global_id.x;
    if (stroke_idx >= arrayLength(&input_strokes)) { return; }

    let stroke = input_strokes[stroke_idx];
    let steps = u32(stroke.subdivisions);
    let h_width = stroke.line_width * 0.5;

    let base_seed = bitcast<u32>(stroke.random_seed);
    let size_y_adj = stroke.size_y + stroke.size_y * rand_range(base_seed, -stroke.length_variation * 0.5, stroke.length_variation * 0.5);

    let p0 = vec2f(0.0, -1.0 * size_y_adj);
    let p1 = vec2f(stroke.size_x * rand_range(base_seed + 1u, -stroke.variability, stroke.variability), -0.333 * size_y_adj + size_y_adj * rand_range(base_seed + 2u, -stroke.variability, stroke.variability));
    let p2 = vec2f(stroke.size_x * rand_range(base_seed + 3u, -stroke.variability, stroke.variability),  0.333 * size_y_adj + size_y_adj * rand_range(base_seed + 4u, -stroke.variability, stroke.variability));
    let p3 = vec2f(0.0, 1.0 * size_y_adj);

    let r_mat = mat2x2f(cos(stroke.cluster_ang), sin(stroke.cluster_ang), -sin(stroke.cluster_ang), cos(stroke.cluster_ang));
    let vtx_offset = stroke_idx * (steps * 2u);

    for (var i = 0u; i < steps; i++) {
        let t = f32(i) / f32(steps - 1u);
        let pos = sample_bezier(p0, p1, p2, p3, t);
        let tan = sample_tangent(p0, p1, p2, p3, t);
        let norm = vec2f(-tan.y, tan.x);

        let l_w = (r_mat * (pos + norm * h_width + vec2f(stroke.offset_x, 0.0))) + vec2f(stroke.cluster_x, stroke.cluster_y);
        let r_w = (r_mat * (pos - norm * h_width + vec2f(stroke.offset_x, 0.0))) + vec2f(stroke.cluster_x, stroke.cluster_y);

        output_vertices[vtx_offset + (i * 2u)] = VertexOutput(l_w);
        output_vertices[vtx_offset + (i * 2u) + 1u] = VertexOutput(r_w);
    }
    // One instance per stroke, each a separate strip of steps * 2 vertices.
    if (stroke_idx == 0u) {
        draw_args[0] = steps * 2u;
        draw_args[1] = arrayLength(&input_strokes); draw_args[2] = 0u; draw_args[3] = 0u;
    }
}
`;

const RENDER_SHADER = `
struct VertexOut { @builtin(position) clip_pos: vec4f }

// Written by the compute pass: VERTS_PER_STROKE vertices per stroke, in order.
@group(0) @binding(0) var<storage, read> vertices: array<vec2f>;
override VERTS_PER_STROKE: u32;

@vertex
fn vs_main(
    @builtin(vertex_index) vertex_idx: u32,
    @builtin(instance_index) stroke_idx: u32,
) -> VertexOut {
    let pos = vertices[stroke_idx * VERTS_PER_STROKE + vertex_idx];
    return VertexOut(vec4f(pos, 0.0, 1.0));
}

@fragment
fn fs_main() -> @location(0) vec4f {
    return vec4f(0.1, 0.55, 0.95, 0.35); // Semi-transparent blue for clean overlap viewing
}
`;

export async function runTestApp() {
  // 1. Initialize Canvas and WebGPU context
  const canvas = document.createElement("canvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);

  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    alert("WebGPU is not supported on this browser.");
    return;
  }

  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  const totalStrokes = 10000;
  const subdivisions = 24;

  // 2. Setup Compute Pipeline
  const cPipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: device.createShaderModule({ code: COMPUTE_SHADER }),
      entryPoint: "main",
    },
  });

  // 3. Setup Render Pipeline. The vertex shader pulls positions from the
  // compute output by instance (stroke) and vertex index, so there are no
  // vertex buffers.
  const rPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: device.createShaderModule({ code: RENDER_SHADER }),
      entryPoint: "vs_main",
      constants: { VERTS_PER_STROKE: subdivisions * 2 },
    },
    fragment: {
      module: device.createShaderModule({ code: RENDER_SHADER }),
      entryPoint: "fs_main",
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
            alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });

  // 4. Generate properties for 10,000 distinct strokes distributed in clusters
  const rawData = new Float32Array(totalStrokes * FLOATS_PER_STROKE);

  const options: StrokeOptions = {
    sizeX: 0.03,
    sizeY: 0.12,
    lengthVariation: 0.4,
    variability: 0.6,
  };

  for (let i = 0; i < totalStrokes; i++) {
    const idx = i * FLOATS_PER_STROKE;
    const clusterX = Math.random() * 1.8 - 0.9;
    const clusterY = Math.random() * 1.8 - 0.9;
    const clusterAng = Math.random() * Math.PI * 2;

    rawData.set(
      [
        options.sizeX,
        options.sizeY,
        options.lengthVariation,
        options.variability,
        clusterX,
        clusterY,
        clusterAng,
        0.015,
        0.0,
        Math.random() * 500000,
        subdivisions,
        0,
      ],
      idx,
    );
  }

  // 5. Create and pack target GPU storage buffers
  const strokeBuffer = device.createBuffer({
    size: rawData.byteLength,
    usage: GPUBufferUsage.STORAGE,
    mappedAtCreation: true,
  });
  new Float32Array(strokeBuffer.getMappedRange()).set(rawData);
  strokeBuffer.unmap();

  const vertexOutBuffer = device.createBuffer({
    size: totalStrokes * (subdivisions * 2) * 8,
    usage: GPUBufferUsage.STORAGE,
  });
  const indirectBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
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
    entries: [{ binding: 0, resource: { buffer: vertexOutBuffer } }],
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
        view: context.getCurrentTexture().createView(),
        clearValue: [0.05, 0.05, 0.07, 1.0],
        loadOp: "clear",
        storeOp: "store",
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
