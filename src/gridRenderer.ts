import type { Renderer } from "./renderer";
import { Canvas } from "./canvas";
import { Stroke, setCurveSize, setCurveUniformity } from "./strokes";
import { params } from "./params";
import { rand } from "./rand";
import { getImageThicknessMultiplier } from "./imageThicknessMap";

const DIAGONAL_VERTICALITY_PATTERN = [-0.5, 1, 0.5, 0];

// Strokes are built at this reference half-length (sizex == sizey == 1) with
// no length variation baked in. At draw time we scale each stroke to fit the
// cell based on its position and angle, optionally with a per-stroke length
// jitter driven by params.linelengthVariation.
const REF_SIZE = 1.0;

type GridCell = {
  // mostly deterministic from the diagonal cycle, with rare per-cell overrides
  verticality: number; // one of DIAGONAL_VERTICALITY_PATTERN
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
  private cachedUniformity: number = NaN;
  private cachedOrientationVariationProbability: number = NaN;
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
    const strokesChanged =
      this.cachedMultiplicity !== params.multiplicity ||
      this.cachedUniformity !== params.uniformity ||
      this.cachedOrientationVariationProbability !==
        params.grid.orientationVariationProbability;

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
    setCurveUniformity(params.uniformity);
    setCurveSize(REF_SIZE, REF_SIZE, 0.0, 0.0);

    const mult = Math.max(1, params.multiplicity);
    const orientationVariationProbability = Math.max(
      0,
      Math.min(1, params.grid.orientationVariationProbability),
    );

    // Keep deviating cells from clustering. As probability decreases, expected
    // spacing increases, so we raise the minimum allowed cell distance.
    const minDeviationSpacing =
      orientationVariationProbability > 0
        ? Math.max(1, Math.floor(Math.sqrt(1 / orientationVariationProbability) * 0.5))
        : 0;
    const hasNearbyDeviation = (
      i: number,
      j: number,
      deviates: boolean[][],
    ) => {
      if (minDeviationSpacing <= 0) return false;
      const j0 = Math.max(0, j - minDeviationSpacing);
      const j1 = Math.min(rows - 1, j + minDeviationSpacing);
      const i0 = Math.max(0, i - minDeviationSpacing);
      const i1 = Math.min(cols - 1, i + minDeviationSpacing);
      for (let y = j0; y <= j1; y++) {
        for (let x = i0; x <= i1; x++) {
          if (!deviates[y][x]) continue;
          if (Math.max(Math.abs(x - i), Math.abs(y - j)) <= minDeviationSpacing) {
            return true;
          }
        }
      }
      return false;
    };

    // If only stroke shape / multiplicity changed (not layout), we can
    // reuse verticality and jitter values. Otherwise rebuild from scratch.
    const reuseRandomness =
      !layoutChanged &&
      this.cells.length === rows &&
      (rows === 0 || this.cells[0].length === cols);

    const newCells: GridCell[][] = [];
    const deviationMask: boolean[][] = Array.from({ length: rows }, () =>
      Array(cols).fill(false),
    );
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
          // Diagonals cycle as they move up/right:
          // -0.5 -> 1 -> 0.5 -> 0 -> repeat.
          const diagonal = i - j;
          const idx =
            ((diagonal % DIAGONAL_VERTICALITY_PATTERN.length) +
              DIAGONAL_VERTICALITY_PATTERN.length) %
            DIAGONAL_VERTICALITY_PATTERN.length;
          verticality = DIAGONAL_VERTICALITY_PATTERN[idx];

          // Deviating cells are probability-driven, but kept spatially apart
          // so they don't cluster too tightly.
          if (
            Math.random() < orientationVariationProbability &&
            !hasNearbyDeviation(i, j, deviationMask)
          ) {
            const alternatives = DIAGONAL_VERTICALITY_PATTERN.filter(
              (v) => v !== verticality,
            );
            verticality =
              alternatives[Math.floor(Math.random() * alternatives.length)];
            deviationMask[j][i] = true;
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
    this.cachedUniformity = params.uniformity;
    this.cachedOrientationVariationProbability =
      params.grid.orientationVariationProbability;
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

        const thickness =
          params.thickness +
          cell.thicknessJitter01 * params.thicknessVariation * params.thickness;
        // Top-to-bottom thickness gradient. v=0 -> uniform, v=1 -> cy^2 ramp.
        const v = params.grid.verticalThickness;
        const vGradient = 1 + v * (cy * cy - 1);
        const imageThickness = getImageThicknessMultiplier(cx, cy);
        const linewidth = (vGradient * thickness * imageThickness) / 10.0;

        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.lineWidth = linewidth;

        // Stroke direction in screen coords (perpendicular to xOffset axis).
        const dirX = -sAng;
        const dirY = cAng;

        for (let s = 0; s < mult; s++) {
          const xOffset = (s - (mult - 1) / 2) * triadSpacing;
          // Intersect the line through screen-coord midpoint
          // (xOffset*cAng, xOffset*sAng) with direction (dirX, dirY)
          // against the cell rectangle [-halfStrokeW, halfStrokeW] x
          // [-halfStrokeH, halfStrokeH]. The result is an asymmetric range
          // [sMin, sMax] along the line so the stroke reaches both cell
          // edges it crosses (not just symmetric around the cell center).
          const midX = xOffset * cAng;
          const midY = xOffset * sAng;

          let sMin = -Infinity;
          let sMax = Infinity;
          if (Math.abs(dirX) > 1e-9) {
            const sa = (-halfStrokeW - midX) / dirX;
            const sb = (halfStrokeW - midX) / dirX;
            sMin = Math.max(sMin, Math.min(sa, sb));
            sMax = Math.min(sMax, Math.max(sa, sb));
          } else if (Math.abs(midX) > halfStrokeW) {
            continue;
          }
          if (Math.abs(dirY) > 1e-9) {
            const sa = (-halfStrokeH - midY) / dirY;
            const sb = (halfStrokeH - midY) / dirY;
            sMin = Math.max(sMin, Math.min(sa, sb));
            sMax = Math.min(sMax, Math.max(sa, sb));
          } else if (Math.abs(midY) > halfStrokeH) {
            continue;
          }
          if (!(sMax > sMin)) continue;

          const halfLen = (sMax - sMin) * 0.5;
          const centerS = (sMax + sMin) * 0.5;
          const sc = halfLen * (1 + cell.strokeLenVar01[s] * lenVarAmt);
          const sk = cell.strokes[s];

          ctx.save();
          // Shift along the local stroke axis to the midpoint of the
          // in-cell segment, so endpoints land on the cell edges.
          ctx.translate(xOffset, centerS);
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
