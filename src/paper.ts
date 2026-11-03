import { newRandomSeed, setRandomSeed } from "./rand";
import type { Renderer } from "./renderer";

/**
 * The drawing surface: a canvas element fitted to its container at the
 * paper's aspect ratio, running the animation loop and pointer painting for
 * the current renderer. Subclasses supply the drawing backend (canvas 2D in
 * Canvas, WebGPU in GpuCanvas). Renderers always draw into a
 * CanvasRenderingContext2D (or something that acts like one) in 0..1 paper
 * coordinates.
 */
export abstract class Paper {
  protected readonly canvas: HTMLCanvasElement;
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
    this.paperAspect = paperAspect;
    this.isDrawing = false;
    this.frameNum = 0;
    this.autoClear = true;
    this.animationId = 0;
    this.lastTime = 0;

    this.isPainting = false;
    this.frameSeed = newRandomSeed();

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

  /** Fill the canvas with white. */
  public abstract clear(): void;

  /** Called when the canvas has been resized to w x h, before the renderer is. */
  protected abstract onResize(w: number, h: number): void;

  /**
   * Draw one frame: clear first if `clear`, then call `render` with a context
   * in 0..1 paper coordinates for the renderer to draw into.
   */
  protected abstract drawFrame(
    render: (ctx: CanvasRenderingContext2D) => void,
    clear: boolean,
  ): void;

  /**
   * As drawFrame, but into a new w x h canvas on white, for export. `render`
   * must be called before the returned promise first waits on anything.
   */
  protected abstract drawImage(
    w: number,
    h: number,
    render: (ctx: CanvasRenderingContext2D) => void,
  ): Promise<HTMLCanvasElement>;

  /**
   * Fit the canvas to its container (the space between the pane columns) and
   * keep it fitted. Subclasses call this at the end of their constructor,
   * once onResize can run.
   */
  protected startSizing() {
    this.setCanvasSize();
    const container = this.canvas.parentElement;
    if (container) {
      new ResizeObserver(() => this.setCanvasSize()).observe(container);
    }
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
    this.onResize(w, h);

    if (this.renderer) {
      this.renderer.resize(w, h);
    }
  }

  public draw(dt: number) {
    this.frameNum = this.frameNum + 1;
    this.renderFrame(dt);
  }

  /**
   * Called just before and just after every frame is rendered, including
   * exports, e.g. to swap animated parameter values in and back out.
   */
  public frameHooks: { before?: () => void; after?: () => void } = {};

  private renderFrame(dt: number) {
    const renderer = this.renderer;
    if (!renderer) {
      if (this.autoClear) this.clear();
      return;
    }
    this.frameSeed = newRandomSeed();
    setRandomSeed(this.frameSeed);
    this.frameHooks.before?.();
    try {
      this.drawFrame((ctx) => renderer.render(ctx, dt), this.autoClear);
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
  public async exportImage(
    w: number,
    h: number,
    type: string,
    quality?: number,
  ): Promise<Blob> {
    const renderer = this.renderer;
    const out = await this.drawImage(w, h, (ctx) => {
      if (!renderer) return;
      setRandomSeed(this.frameSeed);
      this.frameHooks.before?.();
      try {
        renderer.render(ctx, 0);
      } finally {
        this.frameHooks.after?.();
      }
    });
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
