import { rand } from "./rand";

import assetUrl0 from "./assets/strokes-0.png";
import assetUrl1 from "./assets/strokes-1.png";
import assetUrl2 from "./assets/strokes-2.png";
import assetUrl3 from "./assets/strokes-3.png";
import assetUrl4 from "./assets/strokes-4.png";
import assetUrl5 from "./assets/strokes-5.png";

let curveVariability = 0.25;
let curvesizex = 0.03;
let curvesizey = 0.03;
const strokeImages: HTMLImageElement[] = [];
const strokePatterns: CanvasPattern[] = [];

export function setCurveSize(sizex: number, sizey: number) {
  curvesizex = sizex;
  curvesizey = sizey;
}
export function setCurveUniformity(uniformity: number) {
  curveVariability = 1.0 - uniformity;
}

export function curvy2(ctx: CanvasRenderingContext2D) {
  ctx.moveTo(0.0 * curvesizex, -1.0 * curvesizey);
  ctx.bezierCurveTo(
    0.0 * curvesizex + curvesizex * rand(-curveVariability, curveVariability),
    -0.333 * curvesizey +
      curvesizey * rand(-curveVariability, curveVariability),
    0.0 * curvesizex + curvesizex * rand(-curveVariability, curveVariability),
    0.333 * curvesizey + curvesizey * rand(-curveVariability, curveVariability),
    0.0 * curvesizex,
    1.0 * curvesizey
  );
  ctx.stroke();
  ctx.moveTo(0, 0);
}

export function triad(
  ctx: CanvasRenderingContext2D,
  n: number,
  strokeFn: (ctx: CanvasRenderingContext2D) => void,
  dx: number,
  dy: number
) {
  if (n < 1) {
    return;
  }
  // first pos:
  const dx0 = 0.5 * (n - 1) * -dx;
  const dy0 = 0.5 * (n - 1) * -dx;
  ctx.beginPath();
  ctx.translate(dx0, dy0);
  strokeFn(ctx);
  ctx.stroke();
  for (let i = 1; i < n; ++i) {
    ctx.beginPath();
    ctx.translate(dx, dy);
    strokeFn(ctx);
    ctx.stroke();
  }
  ctx.moveTo(0, 0);
}

export function loadStrokeAssets(ctx: CanvasRenderingContext2D) {
  const urls = [
    assetUrl0,
    assetUrl1,
    assetUrl2,
    assetUrl3,
    assetUrl4,
    assetUrl5,
  ];
  for (const url in urls) {
    const img = new Image();
    img.onload = function () {
      const pattern = ctx.createPattern(img, "no-repeat");
      if (pattern) {
        strokePatterns.push(pattern);
      }
    };
    img.src = urls[url];
    strokeImages.push(img);
  }
}

export function strokeImage(ctx: CanvasRenderingContext2D, index: number) {
  const aspect = strokeImages[index].width / strokeImages[index].height;
  ctx.drawImage(
    strokeImages[index],
    0.0,
    0.0,
    curvesizex * 2.0 * aspect,
    curvesizey * 2.0
  );
}
