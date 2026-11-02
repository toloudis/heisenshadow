import assetUrl0 from "./assets/strokes-0.png";
import assetUrl1 from "./assets/strokes-1.png";
import assetUrl2 from "./assets/strokes-2.png";
import assetUrl3 from "./assets/strokes-3.png";
import assetUrl4 from "./assets/strokes-4.png";
import assetUrl5 from "./assets/strokes-5.png";
import { rand } from "./rand";

const strokeImages: HTMLImageElement[] = [];
const strokePatterns: CanvasPattern[] = [];

/** Shape of the bezier curves a Stroke builds. */
export type StrokeOptions = {
  sizeX: number; // half-width scale of the control point jitter
  sizeY: number; // half-length of the stroke
  lengthVariation: number; // sizeY varies by up to +/- half of this fraction
  variability: number; // control point jitter, as a fraction of size (1 - uniformity)
};

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
    img.onload = () => {
      const pattern = ctx.createPattern(img, "no-repeat");
      if (pattern) {
        strokePatterns.push(pattern);
      }
    };
    img.src = urls[url];
    strokeImages.push(img);
  }
}

export function strokeImage(
  ctx: CanvasRenderingContext2D,
  index: number,
  sizeX: number,
  sizeY: number,
) {
  const aspect = strokeImages[index].width / strokeImages[index].height;
  ctx.drawImage(
    strokeImages[index],
    0.0,
    0.0,
    sizeX * 2.0 * aspect,
    sizeY * 2.0,
  );
}

/**
 * Draw a cluster of `multiplicity` freshly built strokes at (x, y), rotated
 * by ang degrees. The strokes are not kept, so each call re-rolls them.
 */
export function drawClusterParams(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  linewidth: number,
  multiplicity: number,
  options: StrokeOptions,
) {
  const cluster = new Cluster();
  cluster.x = x;
  cluster.y = y;
  cluster.ang = ang;
  cluster.linewidth = linewidth;
  for (let i = 0; i < multiplicity; ++i) {
    cluster.strokes.push(new Stroke(options));
  }
  cluster.draw(ctx);
}

/**
 * A single cubic bezier stroke, running vertically through the origin from
 * (0, -sizeY) to (0, sizeY), with its two middle control points jittered.
 */
export class Stroke {
  x0: number = 0;
  y0: number = 0;
  x1: number = 0;
  y1: number = 0;
  x2: number = 0;
  y2: number = 0;
  x3: number = 0;
  y3: number = 0;

  constructor(options: StrokeOptions) {
    const { sizeX, lengthVariation, variability } = options;
    // adjust size based on curve length variation
    const sizeY =
      options.sizeY +
      options.sizeY * rand(-lengthVariation * 0.5, lengthVariation * 0.5);
    // adjust control point angles based on variability

    this.x0 = 0.0 * sizeX;
    this.y0 = -1.0 * sizeY;

    this.x1 = 0.0 * sizeX + sizeX * rand(-variability, variability);
    this.y1 = -0.333 * sizeY + sizeY * rand(-variability, variability);
    this.x2 = 0.0 * sizeX + sizeX * rand(-variability, variability);
    this.y2 = 0.333 * sizeY + sizeY * rand(-variability, variability);
    this.x3 = 0.0 * sizeX;
    this.y3 = 1.0 * sizeY;
  }

  /** Stroke the curve as its own path, scaled uniformly by `scale`. */
  draw(ctx: CanvasRenderingContext2D, scale: number = 1) {
    ctx.beginPath();
    ctx.moveTo(this.x0 * scale, this.y0 * scale);
    ctx.bezierCurveTo(
      this.x1 * scale,
      this.y1 * scale,
      this.x2 * scale,
      this.y2 * scale,
      this.x3 * scale,
      this.y3 * scale,
    );
    ctx.stroke();
  }
}

/**
 * Strokes drawn side by side, spaced triadSpacing apart and centered on
 * (x, y), all rotated by ang degrees.
 */
export class Cluster {
  public x: number = 0;
  public y: number = 0;
  public ang: number = 0;
  public linewidth: number = 0.01;
  public triadSpacing: number = 0.01;
  public strokes: Stroke[] = [];

  draw(ctx: CanvasRenderingContext2D) {
    // save/restore also restores the transform and line width
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate((this.ang * Math.PI) / 180);
    ctx.lineWidth = this.linewidth;

    const n = this.strokes.length;
    const dx = this.triadSpacing;
    // first pos:
    ctx.translate(0.5 * (n - 1) * -dx, 0);
    for (let i = 0; i < n; ++i) {
      if (i > 0) ctx.translate(dx, 0);
      this.strokes[i].draw(ctx);
    }
    ctx.restore();
  }
}
