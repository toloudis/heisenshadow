import type { Renderer } from "./renderer";
import { Canvas } from "./canvas";
import { createVoronoiFromRandomPoints, VoronoiDiagram } from "./voronoi";
import type { VNCell } from "./voronoi";
import { Cluster, Stroke } from "./strokes";
import { params } from "./params";
import { rand } from "./rand";

export class VoronoiRadialRendererRetained implements Renderer {
  private framet: number;
  private voronoi: VoronoiDiagram;
  private clusters: Cluster[];
  private inCell: number = -1;

  constructor(paper: Canvas) {
    this.clusters = [];
    this.framet = 0;
    this.inCell = -1;
    // trivial voronoi diagram for typescript
    this.voronoi = createVoronoiFromRandomPoints(1.0, 1.0, 1);
    this.resize(paper.width(), paper.height());
  }

  render(ctx: CanvasRenderingContext2D, dt: number) {
    const delta = 0.0001 * (params.speed + 1.0);
    this.framet = this.framet + delta * dt;
    this.draw(ctx, delta * dt, this.voronoi);
  }

  resize(_w: number, _h: number) {
    const nVoronoiCells = 1024; // TODO parameter!
    this.voronoi = createVoronoiFromRandomPoints(1.0, 1.0, nVoronoiCells);
    this.predraw(45.0); // TODO parameter!
  }

  predraw(spiralness: number) {
    this.clusters = [];
    for (const cell of this.voronoi.cells) {
      // look at centroid;
      // check radius from center of screen.
      const relativeCentroidX =
        cell.centroid.x - params.radialVoronoi.center.x * 0.5 - 0.5;
      const relativeCentroidY =
        cell.centroid.y - params.radialVoronoi.center.y * 0.5 - 0.5;
      const theta = Math.atan2(relativeCentroidY, relativeCentroidX);
      const r = Math.sqrt(
        relativeCentroidX * relativeCentroidX +
          relativeCentroidY * relativeCentroidY
      );
      //const spiralness = 1.0 / 0.2;
      const ang =
        ((theta + r * spiralness) / Math.PI) * 180.0 +
        rand(-params.angleVariation, params.angleVariation);

      const thickness =
        params.thickness +
        rand(
          -params.thicknessVariation * params.thickness,
          params.thicknessVariation * params.thickness
        );
      const linewidth = (r * thickness) / 10.0; //rand(0.01, 0.1);
      //(Math.cos(r * 4) * Math.cos(r * 4) * params.thickness) / 10.0; //rand(0.01, 0.1);

      const cluster = new Cluster();
      cluster.voronoiCell = cell;
      cluster.x = cell.centroid.x;
      cluster.y = cell.centroid.y;
      cluster.ang = ang;
      cluster.linewidth = linewidth;
      cluster.multiplicity = params.multiplicity;
      for (let i = 0; i < params.multiplicity; ++i) {
        cluster.strokes.push(new Stroke());
      }
      this.clusters.push(cluster);
    }
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

  private draw(
    ctx: CanvasRenderingContext2D,
    t: number,
    _voronoi: VoronoiDiagram
  ) {
    for (let i = 0; i < this.clusters.length; ++i) {
      const cluster = this.clusters[i];
      const cell = cluster.voronoiCell;
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
      const dilation = params.dilation * 0.01;
      const dilatedPoints = this.getDilatedCell(cell, dilation);
      ctx.beginPath();
      ctx.moveTo(dilatedPoints[0][0], dilatedPoints[0][1]);
      for (let i = 1; i < cell.points.length; i++) {
        ctx.lineTo(dilatedPoints[i][0], dilatedPoints[i][1]);
      }
      ctx.closePath();
      //ctx.stroke();
      ctx.clip();

      // look at centroid;
      // check radius from center of screen.
      const relativeCentroidX =
        cell.centroid.x - params.radialVoronoi.center.x * 0.5 - 0.5;
      const relativeCentroidY =
        cell.centroid.y - params.radialVoronoi.center.y * 0.5 - 0.5;
      //const theta = Math.atan2(relativeCentroidY, relativeCentroidX);
      const r = Math.sqrt(
        relativeCentroidX * relativeCentroidX +
          relativeCentroidY * relativeCentroidY
      );
      cluster.ang = cluster.ang + ((r * t) / Math.PI) * 180.0;
      cluster.draw(ctx);

      ctx.restore();
    }
  }

  pointerMove(_e: PointerEvent, relx: number, rely: number): boolean {
    const i = this.voronoi.delaunay.find(relx, rely);
    if (this.inCell === i) {
      return false;
    }
    this.inCell = i;
    const cell = this.voronoi.cells[i];
    const cluster = new Cluster();
    cluster.voronoiCell = cell;
    cluster.x = cell.centroid.x;
    cluster.y = cell.centroid.y;

    const ang =
      rand(-params.angleVariation, params.angleVariation) + params.verticality;

    const thickness =
      params.thickness +
      rand(
        -params.thicknessVariation * params.thickness,
        params.thicknessVariation * params.thickness
      );
    const linewidth = thickness / 10.0; //rand(0.01, 0.1);

    cluster.ang = ang;
    cluster.linewidth = linewidth;
    cluster.multiplicity = params.multiplicity;
    for (let i = 0; i < params.multiplicity; ++i) {
      cluster.strokes.push(new Stroke());
    }
    this.clusters.push(cluster);
    console.log("added cluster");
    return true;
  }

  clear(_ctx: CanvasRenderingContext2D) {
    this.clusters = [];
  }
}
