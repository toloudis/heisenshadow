import type { Renderer } from "./renderer";
import { Canvas } from "./canvas";
import { Stroke, setCurveSize } from "./strokes";
import { params } from "./params";
import { rand } from "./rand";

const VERTICALITY_LEVELS = [-0.5, 0, 0.5, 1];
// Probability that a cell repeats the verticality of its left neighbor.
const REPEAT_CHANCE = 0.15;

// Strokes are built at this reference half-length (sizex == sizey == 1) with
// no length variation baked in. At draw time we scale each stroke to fit the
// cell based on its position and angle, optionally with a per-stroke length
// jitter driven by params.linelengthVariation.
const REF_SIZE = 1.0;

type GridCell = {
  // randomly chosen per cell, stable across slider changes
  verticality: number; // one of VERTICALITY_LEVELS
  angleJitter01: number; // uniform in [-1, 1], scaled by params.angleVariation at draw time
  thicknessJitter01: number; // uniform in [-1, 1], scaled by params.thicknessVariation at draw time
  strokes: Stroke[]; // pre-built bezier curves at unit reference size
  strokeLenVar01: number[]; // per-stroke length jitter in [-1, 1]
};

export class GridRenderer implements Renderer {
  private framet: number;
  private canvasWidth: number;
  private canvasHeight: number;

  // Cached layout
  private cols: number = 0;
  private rows: number = 0;
  private stepX: number = 0;
  private stepY: number = 0;
  private originX: number = 0;
  private originY: number = 0;

  // Cache invalidation fingerprints. linelengthVariation is intentionally
  // omitted: variation is applied at draw time as a scale factor, so changing
  // it does not require rebuilding strokes.
  private cachedBorder: number = NaN;
  private cachedMultiplicity: number = NaN;
  private cachedCellPx: number = NaN;
  private cachedCanvasW: number = 0;
  private cachedCanvasH: number = 0;

  private cells: GridCell[][] = [];

  constructor(paper: Canvas) {
    this.framet = 0;
    this.canvasWidth = paper.width();
    this.canvasHeight = paper.height();
  }

  clear(_ctx: CanvasRenderingContext2D) {}
  pointerMove(_e: PointerEvent, _relx: number, _rely: number) {
    return false;
  }

  resize(w: number, h: number) {
    this.canvasWidth = w;
    this.canvasHeight = h;
  }

  render(ctx: CanvasRenderingContext2D, dt: number) {
    const delta = 0.0001 * (params.speed + 1.0);
    this.framet = this.framet + delta * dt;
    this.ensureCache();
    this.drawGrid(ctx);
  }

  /**
   * Rebuild the per-cell cache if anything that affects layout or stroke
   * geometry has changed. Other slider changes (thickness, dilation, angle
   * variation, line length variation, etc.) reuse the existing cache.
   */
  private ensureCache() {
    // grid cell size in normalized (0..1) coords, based on params.grid.cellPx
    const cellPx = Math.max(2, params.grid.cellPx);
    const cellW = cellPx / this.canvasWidth;
    const cellH = cellPx / this.canvasHeight;
    const cols = Math.max(1, Math.floor((1.0 - 2 * params.border) / cellW));
    const rows = Math.max(1, Math.floor((1.0 - 2 * params.border) / cellH));

    const drawW = 1.0 - 2 * params.border;
    const drawH = 1.0 - 2 * params.border;
    const stepX = drawW / cols;
    const stepY = drawH / rows;

    this.cols = cols;
    this.rows = rows;
    this.stepX = stepX;
    this.stepY = stepY;
    this.originX = params.border + stepX * 0.5;
    this.originY = params.border + stepY * 0.5;

    const layoutChanged =
      this.cachedBorder !== params.border ||
      this.cachedCellPx !== cellPx ||
      this.cachedCanvasW !== this.canvasWidth ||
      this.cachedCanvasH !== this.canvasHeight;
    const strokesChanged = this.cachedMultiplicity !== params.multiplicity;

    if (
      !layoutChanged &&
      !strokesChanged &&
      this.cells.length === rows &&
      (rows === 0 || this.cells[0].length === cols)
    ) {
      return;
    }

    // Build strokes at unit reference size with no length variation. We scale
    // them at draw time to fit each cell.
    setCurveSize(REF_SIZE, REF_SIZE, 0.0, 0.0);

    const mult = Math.max(1, params.multiplicity);

    // If only stroke shape / multiplicity changed (not layout), we can
    // reuse verticality and jitter values. Otherwise rebuild from scratch.
    const reuseRandomness =
      !layoutChanged &&
      this.cells.length === rows &&
      (rows === 0 || this.cells[0].length === cols);

    const newCells: GridCell[][] = [];
    for (let j = 0; j < rows; j++) {
      const row: GridCell[] = [];
      for (let i = 0; i < cols; i++) {
        let verticality: number;
        let angleJitter01: number;
        let thicknessJitter01: number;
        if (reuseRandomness) {
          const prev = this.cells[j][i];
          verticality = prev.verticality;
          angleJitter01 = prev.angleJitter01;
          thicknessJitter01 = prev.thicknessJitter01;
        } else {
          // Pick verticality with a high chance of changing across a row.
          if (i === 0) {
            verticality =
              VERTICALITY_LEVELS[
                Math.floor(Math.random() * VERTICALITY_LEVELS.length)
              ];
          } else {
            const left = row[i - 1].verticality;
            if (Math.random() < REPEAT_CHANCE) {
              verticality = left;
            } else {
              const others = VERTICALITY_LEVELS.filter((l) => l !== left);
              verticality = others[Math.floor(Math.random() * others.length)];
            }
          }
          angleJitter01 = rand(-1, 1);
          thicknessJitter01 = rand(-1, 1);
        }

        const strokes: Stroke[] = [];
        const strokeLenVar01: number[] = [];
        for (let s = 0; s < mult; s++) {
          strokes.push(new Stroke());
          strokeLenVar01.push(rand(-1, 1));
        }

        row.push({
          verticality,
          angleJitter01,
          thicknessJitter01,
          strokes,
          strokeLenVar01,
        });
      }
      newCells.push(row);
    }
    this.cells = newCells;

    this.cachedBorder = params.border;
    this.cachedCellPx = cellPx;
    this.cachedCanvasW = this.canvasWidth;
    this.cachedCanvasH = this.canvasHeight;
    this.cachedMultiplicity = params.multiplicity;
  }

  private drawGrid(ctx: CanvasRenderingContext2D) {
    const { rows, cols, stepX, stepY, originX, originY } = this;
    const mult = Math.max(1, params.multiplicity);
    const triadSpacing = stepX / mult;
    const halfStrokeW = stepX * 0.5;
    const halfStrokeH = stepY * 0.5;
    const lenVarAmt = params.linelengthVariation * 0.5;

    const oldLineWidth = ctx.lineWidth;
    const dilation = params.dilation * 0.01;
    const halfW = stepX * 0.5 + dilation;
    const halfH = stepY * 0.5 + dilation;

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const cell = this.cells[j][i];
        const cx = originX + i * stepX;
        const cy = originY + j * stepY;

        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
        ctx.clip();

        const angDeg =
          (1.0 - cell.verticality) * 90.0 +
          cell.angleJitter01 * params.angleVariation;
        const ang = (angDeg * Math.PI) / 180.0;
        const cAng = Math.cos(ang);
        const sAng = Math.sin(ang);
        const absC = Math.abs(cAng);
        const absS = Math.abs(sAng);

        const thickness =
          params.thickness +
          cell.thicknessJitter01 * params.thicknessVariation * params.thickness;
        const linewidth = (cy * cy * thickness) / 10.0;

        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.lineWidth = linewidth;

        for (let s = 0; s < mult; s++) {
          const xOffset = (s - (mult - 1) / 2) * triadSpacing;
          // Compute the max half-length such that a stroke at local
          // position (xOffset, 0) along local Y fits in the axis-aligned
          // cell rectangle when rotated by `ang` in screen coords.
          const A = xOffset * cAng; // contribution of xOffset to screen X
          const B = xOffset * sAng; // contribution of xOffset to screen Y
          const tx =
            absS > 1e-9 ? (halfStrokeW - Math.abs(A)) / absS : Infinity;
          const ty =
            absC > 1e-9 ? (halfStrokeH - Math.abs(B)) / absC : Infinity;
          let maxT = Math.min(tx, ty);
          if (!isFinite(maxT)) maxT = halfStrokeH;
          if (maxT <= 0) continue;

          const sc = maxT * (1 + cell.strokeLenVar01[s] * lenVarAmt);
          const sk = cell.strokes[s];

          ctx.save();
          ctx.translate(xOffset, 0);
          ctx.beginPath();
          ctx.moveTo(sk.x0 * sc, sk.y0 * sc);
          ctx.bezierCurveTo(
            sk.x1 * sc,
            sk.y1 * sc,
            sk.x2 * sc,
            sk.y2 * sc,
            sk.x3 * sc,
            sk.y3 * sc,
          );
          ctx.stroke();
          ctx.restore();
        }

        // restore the normalized 0..1 transform
        ctx.setTransform(ctx.canvas.width, 0, 0, ctx.canvas.height, 0, 0);
        ctx.restore();
      }
    }

    ctx.lineWidth = oldLineWidth;
    // restore curve size to whatever the params slider dictates for other
    // renderers that share the module-level state.
    setCurveSize(0.03, params.linelength, 0.0, params.linelengthVariation);
  }

  /**
   * Force a full rebuild of the cached per-cell randomness on the next render.
   */
  public reseed() {
    this.cachedBorder = NaN;
    this.cachedCellPx = NaN;
    this.cachedCanvasW = 0;
    this.cachedCanvasH = 0;
  }
}
