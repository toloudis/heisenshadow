import { rand } from "./rand";

import assetUrl0 from "./assets/strokes-0.png";
import assetUrl1 from "./assets/strokes-1.png";
import assetUrl2 from "./assets/strokes-2.png";
import assetUrl3 from "./assets/strokes-3.png";
import assetUrl4 from "./assets/strokes-4.png";
import assetUrl5 from "./assets/strokes-5.png";

let curveLengthVariation = 0.0;
let curveVariability = 0.25;
let curvesizex = 0.03;
let curvesizey = 0.03;
const strokeImages: HTMLImageElement[] = [];
const strokePatterns: CanvasPattern[] = [];

export function setCurveSize(
  sizex: number,
  sizey: number,
  _variationx: number,
  variationy: number
) {
  curvesizex = sizex;
  curvesizey = sizey;
  curveLengthVariation = variationy;
}
export function setCurveUniformity(uniformity: number) {
  curveVariability = 1.0 - uniformity;
}

export function curvy2(ctx: CanvasRenderingContext2D) {
  // adjust size based on curve length variation
  const sizey =
    curvesizey +
    curvesizey * rand(-curveLengthVariation * 0.5, curveLengthVariation * 0.5);
  // adjust control point angles based on variability
  ctx.moveTo(0.0 * curvesizex, -1.0 * sizey);
  ctx.bezierCurveTo(
    0.0 * curvesizex + curvesizex * rand(-curveVariability, curveVariability),
    -0.333 * sizey + sizey * rand(-curveVariability, curveVariability),
    0.0 * curvesizex + curvesizex * rand(-curveVariability, curveVariability),
    0.333 * sizey + sizey * rand(-curveVariability, curveVariability),
    0.0 * curvesizex,
    1.0 * sizey
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

export function drawClusterParams(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  linewidth: number,
  multiplicity: number
) {
  const oldlw = ctx.lineWidth;

  ctx.translate(x, y);

  ctx.rotate((ang * Math.PI) / 180);
  ctx.lineWidth = linewidth;

  const triadspacing = 0.01;
  triad(ctx, multiplicity, curvy2, triadspacing, 0);

  // } else {
  //   const oldAlpha = ctx.globalAlpha;
  //   ctx.globalAlpha = y + params.thickness;
  //   strokeImage(ctx, params.strokeType - 1);
  //   ctx.globalAlpha = oldAlpha;
  // }
  ctx.rotate((-ang * Math.PI) / 180);
  ctx.translate(-x, -y);
  ctx.setTransform(ctx.canvas.width, 0, 0, ctx.canvas.height, 0, 0);
  // ctx.stroke();
  ctx.lineWidth = oldlw;
}
