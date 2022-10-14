export interface Renderer {
  clear: (ctx: CanvasRenderingContext2D) => void;
  render: (ctx: CanvasRenderingContext2D, dt: number) => void;
  resize: (w: number, h: number) => void;
  pointerMove: (e: PointerEvent, relx: number, rely: number) => boolean;
}
