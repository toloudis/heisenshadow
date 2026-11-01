import { newRandomSeed, setRandomSeed } from "./rand";
import type { Renderer } from "./renderer";

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

export class Canvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private paperAspect: number;
  private isDrawing: boolean;
  private autoClear: boolean;
  private frameNum: number;
  private animationId: number;
  private renderer?: Renderer;
  private lastTime: DOMHighResTimeStamp;
  private isPainting: boolean;
  // Random seed of the most recent frame, so export can redraw it exactly.
  private frameSeed: number;

  constructor(canvas: HTMLCanvasElement, paperAspect: number) {
    this.canvas = canvas;
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

    this.paperAspect = paperAspect;
    this.isDrawing = false;
    this.frameNum = 0;
    this.autoClear = true;
    this.animationId = 0;
    this.lastTime = 0;

    this.isPainting = false;
    this.frameSeed = newRandomSeed();

    // Fit the canvas to its container (the space between the pane columns).
    this.setCanvasSize();
    const container = canvas.parentElement;
    if (container) {
      new ResizeObserver(() => this.setCanvasSize()).observe(container);
    }

    this.getCanvas().addEventListener(
      "pointerdown",
      this.pointerDown.bind(this),
    );

    this.getCanvas().addEventListener(
      "pointermove",
      this.pointerMove.bind(this),
    );

    this.getCanvas().addEventListener("pointerup", this.pointerUp.bind(this));
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
  private setCanvasSize() {
    const container = this.canvas.parentElement;
    const availW = container?.clientWidth ?? window.innerWidth;
    const availH = container?.clientHeight ?? window.innerHeight;
    let w = availW;
    let h = availH;
    if (this.paperAspect > availW / availH) {
      h = w / this.paperAspect;
    } else {
      w = h * this.paperAspect;
    }
    w = Math.floor(w);
    h = Math.floor(h);
    // Assigning canvas width/height wipes the drawing, so skip no-op resizes
    // (e.g. the ResizeObserver's initial callback).
    if (w === this.canvas.width && h === this.canvas.height) {
      return;
    }
    this.canvas.width = w;
    this.canvas.height = h;
    // set coordinate system to 0,0-1,1
    setupContext(this.ctx, w, h);

    if (this.renderer) {
      this.renderer.resize(w, h);
    }
  }

  public draw(dt: number) {
    if (this.autoClear) {
      this.clear();
    }
    this.frameNum = this.frameNum + 1;
    this.renderFrame(dt);
  }

  /**
   * Called just before and just after every frame is rendered, including
   * exports, e.g. to swap animated parameter values in and back out.
   */
  public frameHooks: { before?: () => void; after?: () => void } = {};

  private renderFrame(dt: number) {
    if (!this.renderer) return;
    this.frameSeed = newRandomSeed();
    setRandomSeed(this.frameSeed);
    this.frameHooks.before?.();
    try {
      this.renderer.render(this.ctx, dt);
    } finally {
      this.frameHooks.after?.();
    }
  }

  /**
   * Redraw the most recent frame into a new w x h canvas and encode it. The
   * renderer isn't resized, so layout stays as on screen (e.g. the grid's cell
   * count) and the same seed reproduces the same curves at higher resolution.
   * Only the latest frame is redrawn, so with auto-clear off, the strokes
   * accumulated from earlier frames are not included.
   */
  public exportImage(
    w: number,
    h: number,
    type: string,
    quality?: number,
  ): Promise<Blob> {
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) {
      return Promise.reject(new Error("Failed to get 2D context for export"));
    }
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.fillRect(0, 0, w, h);
    setupContext(ctx, w, h);
    if (this.renderer) {
      setRandomSeed(this.frameSeed);
      this.frameHooks.before?.();
      try {
        this.renderer.render(ctx, 0);
      } finally {
        this.frameHooks.after?.();
      }
    }
    return new Promise((resolve, reject) => {
      out.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error(`Failed to encode ${w}x${h} image`)),
        type,
        quality,
      );
    });
  }

  private animate(t: DOMHighResTimeStamp) {
    if (this.autoClear) {
      this.clear();
    }
    this.frameNum = this.frameNum + 1;
    const dt = t - this.lastTime;
    this.lastTime = t;

    this.renderFrame(dt);

    if (this.isDrawing) {
      this.animationId = window.requestAnimationFrame((t0) => this.animate(t0));
    }
  }

  public start() {
    this.lastTime = performance.now();
    this.isDrawing = true;
    this.animationId = window.requestAnimationFrame((t0) => this.animate(t0));
  }

  public stop() {
    this.isDrawing = false;
    window.cancelAnimationFrame(this.animationId);
  }

  public clear() {
    const oldFill = this.ctx.fillStyle;
    this.ctx.fillStyle = "rgba(255,255,255,1)";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = oldFill;
  }

  public setPaperAspect(paperAspect: number) {
    this.paperAspect = paperAspect;
    this.setCanvasSize();
  }

  public getRenderer(): Renderer | undefined {
    return this.renderer;
  }
  public setRenderer(renderer: Renderer) {
    this.renderer = renderer;
  }
  public setAutoClear(autoClear: boolean) {
    this.autoClear = autoClear;
  }
  public width() {
    return this.canvas.width;
  }
  public height() {
    return this.canvas.height;
  }

  pointerDown(_e: PointerEvent) {
    this.isPainting = true;
  }
  pointerMove(_e: PointerEvent) {
    if (!this.isPainting) {
      return;
    }
    const addedStroke = this.renderer?.pointerMove(
      _e,
      _e.offsetX / this.canvas.width,
      _e.offsetY / this.canvas.height,
    );
    // todo work out how many times to redraw
    if (addedStroke) window.requestAnimationFrame((t0) => this.animate(t0));
  }
  pointerUp(_e: PointerEvent) {
    this.isPainting = false;
    this.frameSeed = newRandomSeed();
  }
}
