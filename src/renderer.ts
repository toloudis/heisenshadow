export interface Renderer {
  render: (ctx: CanvasRenderingContext2D, dt: number) => void;
  resize: (w: number, h: number) => void;
}
