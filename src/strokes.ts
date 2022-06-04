import { rand } from "./rand";

let curvesize = 0.03;

export function setCurveSize(size: number) {
  curvesize = size;
}

export function straight(ctx: CanvasRenderingContext2D) {
  ctx.moveTo(0, -curvesize);
  ctx.lineTo(0, curvesize);
  ctx.stroke();
  ctx.moveTo(0, 0);
}

export function curvy1(ctx: CanvasRenderingContext2D) {
  ctx.moveTo(-0.25 * curvesize, -curvesize);
  ctx.bezierCurveTo(
    0.25 * curvesize * (1.0 + rand(-0.5, 0.5)),
    -0.333 * curvesize * (1.0 + rand(-0.5, 0.5)),
    0.25 * curvesize * (1.0 + rand(-0.5, 0.5)),
    0.333 * curvesize * (1.0 + rand(-0.5, 0.5)),
    -0.25 * curvesize,
    curvesize
  );
  ctx.stroke();
  ctx.moveTo(0, 0);
}

export function triad(
  ctx: CanvasRenderingContext2D,
  strokeFn: (ctx: CanvasRenderingContext2D) => void,
  dx: number,
  dy: number
) {
  ctx.beginPath();
  ctx.translate(-dx, -dy);
  strokeFn(ctx);
  ctx.stroke();
  ctx.beginPath();
  ctx.translate(dx, dy);
  strokeFn(ctx);
  ctx.stroke();
  ctx.beginPath();
  ctx.translate(dx, dy);
  strokeFn(ctx);
  ctx.stroke();
  ctx.moveTo(0, 0);
  //  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
