import { rand } from "./rand";

import assetUrl0 from "./assets/strokes-0.png";
import assetUrl1 from "./assets/strokes-1.png";
import assetUrl2 from "./assets/strokes-2.png";
import assetUrl3 from "./assets/strokes-3.png";
import assetUrl4 from "./assets/strokes-4.png";
import assetUrl5 from "./assets/strokes-5.png";

let curveVariability = 0.25;
let curvesize = 0.03;
const strokeImages: HTMLImageElement[] = [];
const strokePatterns: CanvasPattern[] = [];

export function setCurveSize(size: number) {
  curvesize = size;
}
export function setCurveUniformity(uniformity: number) {
  curveVariability = 1.0 - uniformity;
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

export function curvy2(ctx: CanvasRenderingContext2D) {
  ctx.moveTo(0.0 * curvesize, -1.0 * curvesize);
  ctx.bezierCurveTo(
    0.0 * curvesize + curvesize * rand(-curveVariability, curveVariability),
    -0.333 * curvesize + curvesize * rand(-curveVariability, curveVariability),
    0.0 * curvesize + curvesize * rand(-curveVariability, curveVariability),
    0.333 * curvesize + curvesize * rand(-curveVariability, curveVariability),
    0.0 * curvesize,
    1.0 * curvesize
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
    curvesize * 2.0 * aspect,
    curvesize * 2.0
  );
}
