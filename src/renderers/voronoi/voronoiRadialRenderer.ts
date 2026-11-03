import { getImageThicknessMultiplier } from "../../imageThicknessMap";
import type { Paper } from "../../paper";
import { params } from "../../params";
import { rand } from "../../rand";
import type { Renderer, RendererSetting } from "../../renderer";
import { drawClusterParams } from "../../strokes";
import {
  voronoiParams,
  voronoiSettings,
  voronoiStrokeOptions,
} from "./settings";
import type { VNCell } from "./voronoi";
import { createVoronoiFromRandomPoints, type VoronoiDiagram } from "./voronoi";

/**
 * How strokes in each voronoi cell are angled. "radial": along a spiral around
 * voronoiParams.center, turning further as frames pass. "plain": all at
 * the angle set by voronoiParams.verticality.
 */
export type VoronoiMode = "radial" | "plain";

export class VoronoiRadialRenderer implements Renderer {
  private framet: number;
  private voronoi: VoronoiDiagram;

  constructor(
    paper: Paper,
    private readonly mode: VoronoiMode,
  ) {
    this.framet = 0;
    // trivial voronoi diagram for typescript
    this.voronoi = createVoronoiFromRandomPoints(1.0, 1.0, 1);
    this.resize(paper.width(), paper.height());
  }

  settings(): RendererSetting[] {
    return voronoiSettings(this.mode);
  }

  clear(_ctx: CanvasRenderingContext2D) {}
  pointerMove(_e: PointerEvent, _relx: number, _rely: number) {
    return false;
  }

  render(ctx: CanvasRenderingContext2D, dt: number) {
    const delta = 0.0001 * (params.speed + 1.0);
    this.framet = this.framet + delta * dt;
    this.drawAllVoronoiCells_Radial(ctx, this.framet, this.voronoi);
  }

  resize(_w: number, _h: number) {
    const nVoronoiCells = 1024;
    this.voronoi = createVoronoiFromRandomPoints(1.0, 1.0, nVoronoiCells);
  }

  private getDilatedCell(cell: VNCell, dilation: number): [number, number][] {
    const dilatedPoints: [number, number][] = [];
    for (let i = 0; i < cell.points.length; i++) {
      const p0 = cell.points[i];
      const p1 = cell.points[(i + 1) % cell.points.length];
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      const nx = dy / len;
      const ny = -dx / len;
      const px = p0[0] + nx * dilation;
      const py = p0[1] + ny * dilation;
      dilatedPoints.push([px, py]);
    }
    return dilatedPoints;
  }

  private drawAllVoronoiCells_Radial(
    ctx: CanvasRenderingContext2D,
    spiralness: number,
    voronoi: VoronoiDiagram,
  ) {
    const strokeOptions = voronoiStrokeOptions();
    for (const cell of voronoi.cells) {
      // if cell is close to edge, then skip it
      if (
        cell.centroid.x < params.border ||
        cell.centroid.x > 1.0 - params.border ||
        cell.centroid.y < params.border ||
        cell.centroid.y > 1.0 - params.border
      ) {
        continue;
      }
      ctx.save();
      // dilate away from centroid to expand the cell
      const dilation = voronoiParams.dilation * 0.01;
      const dilatedPoints = this.getDilatedCell(cell, dilation);
      ctx.beginPath();
      ctx.moveTo(dilatedPoints[0][0], dilatedPoints[0][1]);
      for (let i = 1; i < cell.points.length; i++) {
        ctx.lineTo(dilatedPoints[i][0], dilatedPoints[i][1]);
      }
      ctx.closePath();
      //ctx.stroke();
      ctx.clip();

      if (this.mode === "radial") {
        // look at centroid;
        // check radius from center of screen.
        const relativeCentroidX =
          cell.centroid.x - voronoiParams.center.x * 0.5 - 0.5;
        const relativeCentroidY =
          cell.centroid.y - voronoiParams.center.y * 0.5 - 0.5;
        const theta = Math.atan2(relativeCentroidY, relativeCentroidX);
        const r = Math.sqrt(
          relativeCentroidX * relativeCentroidX +
            relativeCentroidY * relativeCentroidY,
        );
        //const spiralness = 1.0 / 0.2;
        const ang =
          ((theta + r * spiralness) / Math.PI) * 180.0 +
          rand(-voronoiParams.angleVariation, voronoiParams.angleVariation);

        const thickness =
          voronoiParams.thickness +
          rand(
            -voronoiParams.thicknessVariation * voronoiParams.thickness,
            voronoiParams.thicknessVariation * voronoiParams.thickness,
          );
        const imageThickness = getImageThicknessMultiplier(
          cell.centroid.x,
          cell.centroid.y,
        );
        const linewidth = (r * thickness * imageThickness) / 10.0; //rand(0.01, 0.1);
        //(Math.cos(r * 4) * Math.cos(r * 4) * voronoiParams.thickness) / 10.0; //rand(0.01, 0.1);

        drawClusterParams(
          ctx,
          cell.centroid.x,
          cell.centroid.y,
          ang,
          linewidth,
          voronoiParams.multiplicity,
          strokeOptions,
        );
      } else {
        const ang =
          (1.0 - voronoiParams.verticality) * 90.0 +
          rand(-voronoiParams.angleVariation, voronoiParams.angleVariation);

        const imageThickness = getImageThicknessMultiplier(
          cell.centroid.x,
          cell.centroid.y,
        );
        const linewidth =
          (cell.centroid.y *
            cell.centroid.y *
            voronoiParams.thickness *
            imageThickness) /
          10.0; //rand(0.01, 0.1);
        drawClusterParams(
          ctx,
          cell.centroid.x,
          cell.centroid.y,
          ang,
          linewidth,
          voronoiParams.multiplicity,
          strokeOptions,
        );
      }
      ctx.restore();
    }
  }
}
