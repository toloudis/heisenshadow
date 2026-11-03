import { Paper } from "./paper";

// Map the 0..1 drawing coordinates onto a w x h pixel context and set the
// stroke defaults the renderers rely on.
function setupContext(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.setTransform(w, 0, 0, h, 0, 0);
  ctx.lineWidth = 0.001;
  //ctx.filter = "blur(0.5px)";
  ctx.shadowBlur = 0; // 0.01;
  ctx.shadowColor = "rgb(0, 0, 0)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

/** Paper drawn with canvas 2D. The fallback when WebGPU isn't available. */
export class Canvas extends Paper {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement, paperAspect: number) {
    super(canvas, paperAspect);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context from canvas");
    }
    this.ctx = ctx;
    this.ctx.shadowBlur = 0; // 0.01;
    this.ctx.shadowColor = "rgb(0, 0, 0)";
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    //this.ctx.globalCompositeOperation = "destination-over";

    this.startSizing();
  }

  protected onResize(w: number, h: number) {
    // set coordinate system to 0,0-1,1
    setupContext(this.ctx, w, h);
  }

  protected drawFrame(
    render: (ctx: CanvasRenderingContext2D) => void,
    clear: boolean,
  ) {
    if (clear) {
      this.clear();
    }
    render(this.ctx);
  }

  protected async drawImage(
    w: number,
    h: number,
    render: (ctx: CanvasRenderingContext2D) => void,
  ): Promise<HTMLCanvasElement> {
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context for export");
    }
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.fillRect(0, 0, w, h);
    setupContext(ctx, w, h);
    render(ctx);
    return out;
  }

  public clear() {
    const oldFill = this.ctx.fillStyle;
    this.ctx.fillStyle = "rgba(255,255,255,1)";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = oldFill;
  }
}
