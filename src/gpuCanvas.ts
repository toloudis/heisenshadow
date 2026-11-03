import { Paper } from "./paper";
import { GpuBackend } from "./renderers/webgpu/gpuBackend";
import { RecordingContext } from "./renderers/webgpu/recordingContext";

/**
 * Paper drawn with WebGPU. Each frame the renderer draws into a
 * RecordingContext, which captures its strokes for GpuBackend to tessellate
 * and draw.
 */
export class GpuCanvas extends Paper {
  private readonly recorder = new RecordingContext();
  private readonly gpu: GpuBackend;

  private constructor(
    canvas: HTMLCanvasElement,
    paperAspect: number,
    gpu: GpuBackend,
  ) {
    super(canvas, paperAspect);
    this.gpu = gpu;
    this.startSizing();
  }

  /** Null when WebGPU isn't available, leaving the canvas free for 2D. */
  static async create(
    canvas: HTMLCanvasElement,
    paperAspect: number,
  ): Promise<GpuCanvas | null> {
    const gpu = await GpuBackend.create(canvas);
    return gpu ? new GpuCanvas(canvas, paperAspect, gpu) : null;
  }

  // The backend fits its own textures to the canvas when it next draws.
  protected onResize(_w: number, _h: number) {}

  protected drawFrame(
    render: (ctx: CanvasRenderingContext2D) => void,
    clear: boolean,
  ) {
    this.recorder.reset();
    render(this.recorder as unknown as CanvasRenderingContext2D);
    this.gpu.draw(this.recorder, clear);
  }

  // Records into its own context, as an animation frame may record into
  // this.recorder while the export is still drawing.
  protected drawImage(
    w: number,
    h: number,
    render: (ctx: CanvasRenderingContext2D) => void,
  ): Promise<HTMLCanvasElement> {
    const rec = new RecordingContext();
    render(rec as unknown as CanvasRenderingContext2D);
    return this.gpu.drawImage(rec, w, h);
  }

  public clear() {
    this.recorder.reset();
    this.gpu.draw(this.recorder, true);
  }
}
