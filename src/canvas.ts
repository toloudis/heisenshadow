import type { Renderer } from "./renderer";

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
    this.ctx.setTransform(w, 0, 0, h, 0, 0);
    //context.scale(canvas.width, canvas.height);
    this.ctx.lineWidth = 0.001;
    //this.ctx.filter = "blur(0.5px)";
    this.ctx.shadowBlur = 0; // 0.01;
    this.ctx.shadowColor = "rgb(0, 0, 0)";
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    if (this.renderer) {
      this.renderer.resize(w, h);
    }
  }

  public draw(dt: number) {
    if (this.autoClear) {
      this.clear();
    }
    this.frameNum = this.frameNum + 1;
    if (this.renderer) {
      this.renderer.render(this.ctx, dt);
    }
  }

  private animate(t: DOMHighResTimeStamp) {
    if (this.autoClear) {
      this.clear();
    }
    this.frameNum = this.frameNum + 1;
    const dt = t - this.lastTime;
    this.lastTime = t;

    if (this.renderer) {
      this.renderer.render(this.ctx, dt);
    }

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
  }
}
