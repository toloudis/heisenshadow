import type { Renderer } from "./renderer";
import { Canvas } from "./canvas";
import { curvy2, setCurveSize, triad } from "./strokes";
import { params } from "./params";
import { rand } from "./rand";

const GRID_CELL_PX = 50;

export class GridRenderer implements Renderer {
  private framet: number;
  private canvasWidth: number;
  private canvasHeight: number;

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
    this.drawGrid(ctx);
  }

  private drawGrid(ctx: CanvasRenderingContext2D) {
    // grid cell size in normalized (0..1) coords, based on ~50px cells
    const cellW = GRID_CELL_PX / this.canvasWidth;
    const cellH = GRID_CELL_PX / this.canvasHeight;

    // number of full cells that fit, centered with margin
    const cols = Math.max(1, Math.floor((1.0 - 2 * params.border) / cellW));
    const rows = Math.max(1, Math.floor((1.0 - 2 * params.border) / cellH));

    // recompute cell size to evenly fill the drawable area
    const drawW = 1.0 - 2 * params.border;
    const drawH = 1.0 - 2 * params.border;
    const stepX = drawW / cols;
    const stepY = drawH / rows;

    const originX = params.border + stepX * 0.5;
    const originY = params.border + stepY * 0.5;

    // Size the curve so a single stroke fills the cell height,
    // and space the multiplicity strokes evenly across the cell width.
    const mult = Math.max(1, params.multiplicity);
    const triadSpacing = stepX / mult;
    setCurveSize(stepX * 0.5, stepY * 0.5, 0.0, params.linelengthVariation);

    const oldLineWidth = ctx.lineWidth;

    // Per-cell verticality: pick from {-0.5, 0, 0.5, 1} (horizontal, both
    // diagonals, and vertical), with a high chance that the value changes
    // from one cell to the next along a row.
    const verticalityLevels = [-0.5, 0, 0.5, 1];
    // probability of repeating the left neighbor (low => high change rate)
    const repeatChance = 0.15;
    const verticalityGrid: number[][] = [];
    for (let j = 0; j < rows; j++) {
      verticalityGrid.push([]);
      for (let i = 0; i < cols; i++) {
        let v: number;
        if (i === 0) {
          v =
            verticalityLevels[
              Math.floor(Math.random() * verticalityLevels.length)
            ];
        } else {
          const left = verticalityGrid[j][i - 1];
          if (Math.random() < repeatChance) {
            v = left;
          } else {
            // pick uniformly among the levels different from the left neighbor
            const others = verticalityLevels.filter((l) => l !== left);
            v = others[Math.floor(Math.random() * others.length)];
          }
        }
        verticalityGrid[j].push(v);
      }
    }

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const cx = originX + i * stepX;
        const cy = originY + j * stepY;

        ctx.save();
        // clip to the grid cell so dilation/multiplicity stays within it
        const dilation = params.dilation * 0.01;
        const halfW = stepX * 0.5 + dilation;
        const halfH = stepY * 0.5 + dilation;
        ctx.beginPath();
        ctx.rect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
        ctx.clip();

        const verticality = verticalityGrid[j][i];
        const ang =
          (1.0 - verticality) * 90.0 +
          rand(-params.angleVariation, params.angleVariation);

        const thickness =
          params.thickness +
          rand(
            -params.thicknessVariation * params.thickness,
            params.thicknessVariation * params.thickness,
          );
        const linewidth = (cy * cy * thickness) / 10.0;

        ctx.translate(cx, cy);
        ctx.rotate((ang * Math.PI) / 180);
        ctx.lineWidth = linewidth;
        triad(ctx, mult, curvy2, triadSpacing, 0);
        // restore the normalized 0..1 transform
        ctx.setTransform(ctx.canvas.width, 0, 0, ctx.canvas.height, 0, 0);
        ctx.restore();
      }
    }

    ctx.lineWidth = oldLineWidth;
    // restore curve size to whatever the params slider dictates
    setCurveSize(0.03, params.linelength, 0.0, params.linelengthVariation);
  }
}
