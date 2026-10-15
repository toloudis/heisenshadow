import type { Canvas } from "./canvas";
import { getImageThicknessMultiplier } from "./imageThicknessMap";
import { params } from "./params";
import { rand } from "./rand";
import type { Renderer } from "./renderer";
import { Stroke, setCurveSize, setCurveUniformity } from "./strokes";

// Base pattern, read going up a column: "\", "|", "/", "-", repeating (i.e.
// the "/", "-", "\", "|" cycle). Each column starts COLUMN_PHASE_SHIFT steps
// further along the cycle than the one to its left, which lines the strokes
// up into diagonal bands across the grid.
const COLUMN_VERTICALITY_PATTERN = [-0.5, 1, 0.5, 0];
const COLUMN_PHASE_SHIFT = 1;

// Strokes are built at this reference half-length (sizex == sizey == 1) with
// no length variation baked in. At draw time we scale each stroke to fit the
// cell based on its position and angle, optionally with a per-stroke length
// jitter driven by params.linelengthVariation.
const REF_SIZE = 1.0;

// Approximate spacing, in cells, between pattern-variation patch seeds.
const PATCH_SPACING = 5;
// Fraction of patternVariation used as the chance an individual cell breaks.
const CELL_BREAK_SCALE = 0.1;

// A patch is a blob of cells (octagon-ish, from the distance metric used to
// assign cells to seeds) that can shift or mirror the column angle cycle.
// The randoms are cached so that params.grid.patternVariation is live.
type Patch = {
  x: number; // seed position, in cells
  y: number;
  r: number; // [0, 1): patch breaks the pattern when r < patternVariation
  phase: number; // 1..3: shift of the column cycle
  mirror: boolean; // reverse the per-column phase shift (bands run along the other diagonal)
};

type GridCell = {
  // Verticality is derived at draw time from the column cycle, the cell's
  // patch, and rare per-cell overrides.
  patch: Patch;
  deviationPick: number; // [0, 1) pick of an alternative angle, or -1 for none
  breakR: number; // [0, 1): cell breaks when breakR < patternVariation * CELL_BREAK_SCALE
  breakPick: number; // [0, 1) pick of an alternative angle for a per-cell break
  angleJitter01: number; // uniform in [-1, 1], scaled by params.angleVariation at draw time
  thicknessJitter01: number; // uniform in [-1, 1], scaled by params.thicknessVariation at draw time
  strokes: Stroke[]; // pre-built bezier curves at unit reference size
  strokeLenVar01: number[]; // per-stroke length jitter in [-1, 1]
};

/**
 * One axis of clipping a line to the cell rectangle. Along a single axis the
 * line is mid + s * dir, and the cell spans [-half, half]. Returns the range
 * of s for which the line is between those two cell edges, or null if it is
 * parallel to them and outside. Intersecting the ranges for the x and y axes
 * gives the part of the line inside the cell.
 */
function rangeBetweenCellEdges(
  mid: number,
  dir: number,
  half: number,
): [number, number] | null {
  if (Math.abs(dir) <= 1e-9) {
    return Math.abs(mid) > half ? null : [-Infinity, Infinity];
  }
  const a = (-half - mid) / dir;
  const b = (half - mid) / dir;
  return [Math.min(a, b), Math.max(a, b)];
}

export class GridRenderer implements Renderer {
  private canvasWidth: number;
  private canvasHeight: number;

  // Cached layout, in normalized (0..1) coords
  private layout = {
    cols: 0,
    rows: 0,
    stepX: 0,
    stepY: 0,
    originX: 0,
    originY: 0,
  };

  // Cache invalidation keys. Settings applied at draw time (thickness,
  // dilation, angle/length variation, pattern variation, ...) are left out.
  private randomKey = ""; // layout + per-cell randomness
  private strokeKey = ""; // stroke geometry

  private cells: GridCell[][] = [];
  private patches: Patch[] = [];
  private patchCols: number = 0;
  private patchRows: number = 0;

  constructor(paper: Canvas) {
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

  render(ctx: CanvasRenderingContext2D, _dt: number) {
    this.ensureCache();
    this.drawGrid(ctx);
  }

  /**
   * Rebuild the per-cell cache if anything that affects layout, per-cell
   * randomness, or stroke geometry has changed. Other slider changes reuse
   * the existing cache.
   */
  private ensureCache() {
    // grid cell size in normalized (0..1) coords, based on params.grid.cellPx
    const cellPx = Math.max(2, params.grid.cellPx);
    const drawSize = 1.0 - 2 * params.border;
    const cols = Math.max(
      1,
      Math.floor(drawSize / (cellPx / this.canvasWidth)),
    );
    const rows = Math.max(
      1,
      Math.floor(drawSize / (cellPx / this.canvasHeight)),
    );

    const stepX = drawSize / cols;
    const stepY = drawSize / rows;
    this.layout = {
      cols,
      rows,
      stepX,
      stepY,
      originX: params.border + stepX * 0.5,
      originY: params.border + stepY * 0.5,
    };

    const randomKey = [
      params.border,
      cellPx,
      this.canvasWidth,
      this.canvasHeight,
      params.grid.orientationVariationProbability,
    ].join();
    const strokeKey = [params.multiplicity, params.uniformity].join();
    if (randomKey === this.randomKey && strokeKey === this.strokeKey) {
      return;
    }
    // If only stroke geometry changed, keep each cell's randomness.
    const reuseRandomness = randomKey === this.randomKey;
    this.randomKey = randomKey;
    this.strokeKey = strokeKey;

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
    const minDeviationSpacing = Math.max(
      1,
      Math.floor(Math.sqrt(1 / orientationVariationProbability) * 0.5),
    );
    const deviationMask: boolean[][] = Array.from({ length: rows }, () =>
      Array(cols).fill(false),
    );
    const hasNearbyDeviation = (i: number, j: number) => {
      const j0 = Math.max(0, j - minDeviationSpacing);
      const j1 = Math.min(rows - 1, j + minDeviationSpacing);
      const i0 = Math.max(0, i - minDeviationSpacing);
      const i1 = Math.min(cols - 1, i + minDeviationSpacing);
      for (let y = j0; y <= j1; y++) {
        for (let x = i0; x <= i1; x++) {
          if (deviationMask[y][x]) return true;
        }
      }
      return false;
    };

    if (!reuseRandomness) {
      this.buildPatches(cols, rows);
    }

    const newCells: GridCell[][] = [];
    for (let j = 0; j < rows; j++) {
      const row: GridCell[] = [];
      for (let i = 0; i < cols; i++) {
        let randomness: Omit<GridCell, "strokes" | "strokeLenVar01">;
        if (reuseRandomness) {
          randomness = this.cells[j][i];
        } else {
          // Deviating cells are probability-driven, but kept spatially apart
          // so they don't cluster too tightly.
          let deviationPick = -1;
          if (
            Math.random() < orientationVariationProbability &&
            !hasNearbyDeviation(i, j)
          ) {
            deviationPick = Math.random();
            deviationMask[j][i] = true;
          }
          randomness = {
            patch: this.nearestPatch(i, j),
            deviationPick,
            breakR: Math.random(),
            breakPick: Math.random(),
            angleJitter01: rand(-1, 1),
            thicknessJitter01: rand(-1, 1),
          };
        }

        const strokes: Stroke[] = [];
        const strokeLenVar01: number[] = [];
        for (let s = 0; s < mult; s++) {
          strokes.push(new Stroke());
          strokeLenVar01.push(rand(-1, 1));
        }

        row.push({ ...randomness, strokes, strokeLenVar01 });
      }
      newCells.push(row);
    }
    this.cells = newCells;

    // Restore the shared curve size to whatever the params sliders dictate
    // for other renderers.
    setCurveSize(0.03, params.linelength, 0.0, params.linelengthVariation);
  }

  /**
   * Scatter patch seeds on a jittered grid (PATCH_SPACING cells apart), each
   * with its own cached randomness.
   */
  private buildPatches(cols: number, rows: number) {
    this.patchCols = Math.ceil(cols / PATCH_SPACING) + 1;
    this.patchRows = Math.ceil(rows / PATCH_SPACING) + 1;
    this.patches = [];
    for (let gj = 0; gj < this.patchRows; gj++) {
      for (let gi = 0; gi < this.patchCols; gi++) {
        this.patches.push({
          x: (gi + rand(0.1, 0.9)) * PATCH_SPACING,
          y: (gj + rand(0.1, 0.9)) * PATCH_SPACING,
          r: Math.random(),
          phase: 1 + Math.floor(Math.random() * 3),
          mirror: Math.random() < 0.5,
        });
      }
    }
  }

  /**
   * The patch whose seed is nearest to cell (i, j). Distance is an octagonal
   * metric (max + half of min), so patches come out octagon-ish, like the
   * stamped rings in the reference print.
   */
  private nearestPatch(i: number, j: number): Patch {
    const gi0 = Math.floor(i / PATCH_SPACING);
    const gj0 = Math.floor(j / PATCH_SPACING);
    let best = this.patches[0];
    let bestD = Infinity;
    for (let gj = Math.max(0, gj0 - 1); gj <= gj0 + 1; gj++) {
      for (let gi = Math.max(0, gi0 - 1); gi <= gi0 + 1; gi++) {
        if (gj >= this.patchRows || gi >= this.patchCols) continue;
        const patch = this.patches[gj * this.patchCols + gi];
        const dx = Math.abs(i + 0.5 - patch.x);
        const dy = Math.abs(j + 0.5 - patch.y);
        const d = Math.max(dx, dy) + 0.5 * Math.min(dx, dy);
        if (d < bestD) {
          bestD = d;
          best = patch;
        }
      }
    }
    return best;
  }

  /**
   * Verticality for cell (i, j). The base pattern cycles up each column
   * (COLUMN_VERTICALITY_PATTERN), with column i phase-shifted by
   * i * COLUMN_PHASE_SHIFT. With patternVariation > 0, some patches shift
   * that phase or reverse the per-column shift, and a few individual cells
   * pick a different angle.
   */
  private cellVerticality(i: number, j: number, cell: GridCell): number {
    const n = COLUMN_VERTICALITY_PATTERN.length;
    const variation = Math.max(0, Math.min(1, params.grid.patternVariation));
    const { patch } = cell;
    // steps up the column (j counts down from the top)
    const step = -j;
    let columnPhase = i * COLUMN_PHASE_SHIFT;
    if (patch.r < variation) {
      columnPhase = (patch.mirror ? -columnPhase : columnPhase) + patch.phase;
    }
    let idx = (((step + columnPhase) % n) + n) % n;
    let pick = cell.deviationPick;
    if (pick < 0 && cell.breakR < variation * CELL_BREAK_SCALE) {
      pick = cell.breakPick;
    }
    if (pick >= 0) {
      // choose one of the other n-1 angles
      idx = (idx + 1 + Math.floor(pick * (n - 1))) % n;
    }
    return COLUMN_VERTICALITY_PATTERN[idx];
  }

  private drawGrid(ctx: CanvasRenderingContext2D) {
    const { rows, cols, stepX, stepY, originX, originY } = this.layout;
    const mult = Math.max(1, params.multiplicity);
    const triadSpacing = stepX / mult;
    const halfStepX = stepX * 0.5;
    const halfStepY = stepY * 0.5;
    const lenVarAmt = params.linelengthVariation * 0.5;

    const dilation = params.dilation * 0.01;
    const halfW = halfStepX + dilation;
    const halfH = halfStepY + dilation;

    // Draw column by column, alternating down and up (boustrophedon).
    for (let i = 0; i < cols; i++) {
      const goingDown = i % 2 === 0;
      for (let k = 0; k < rows; k++) {
        const j = goingDown ? k : rows - 1 - k;
        const cell = this.cells[j][i];
        const cx = originX + i * stepX;
        const cy = originY + j * stepY;

        // save/restore also restores the transform and line width
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
        ctx.clip();

        const verticality = this.cellVerticality(i, j, cell);
        const angDeg =
          (1.0 - verticality) * 90.0 +
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

        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.lineWidth = (vGradient * thickness * imageThickness) / 10.0;

        for (let s = 0; s < mult; s++) {
          const xOffset = (s - (mult - 1) / 2) * triadSpacing;
          // Intersect the line through screen-coord midpoint
          // (xOffset*cAng, xOffset*sAng) with direction (-sAng, cAng)
          // against the cell rectangle. The result is an asymmetric range
          // [sMin, sMax] along the line so the stroke reaches both cell
          // edges it crosses (not just symmetric around the cell center).
          const rx = rangeBetweenCellEdges(xOffset * cAng, -sAng, halfStepX);
          const ry = rangeBetweenCellEdges(xOffset * sAng, cAng, halfStepY);
          if (!rx || !ry) continue;
          const sMin = Math.max(rx[0], ry[0]);
          const sMax = Math.min(rx[1], ry[1]);
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

        ctx.restore();
      }
    }
  }

  /**
   * Force a full rebuild of the cached per-cell randomness on the next render.
   */
  public reseed() {
    this.randomKey = "";
  }
}
