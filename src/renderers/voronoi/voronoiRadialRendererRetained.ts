import type { Canvas } from "../../canvas";
import { getImageThicknessMultiplier } from "../../imageThicknessMap";
import { params } from "../../params";
import { getRandomSeed, newRandomSeed, rand, setRandomSeed } from "../../rand";
import type { Renderer, RendererSetting } from "../../renderer";
import { Cluster, Stroke } from "../../strokes";
import {
  voronoiParams,
  voronoiSettings,
  voronoiStrokeOptions,
} from "./settings";
import type { VNCell } from "./voronoi";
import { createVoronoiFromRandomPoints, type VoronoiDiagram } from "./voronoi";

// A cluster of strokes and the voronoi cell it's drawn (and clipped) in.
type CellCluster = { cell: VNCell; cluster: Cluster };

export class VoronoiRadialRendererRetained implements Renderer {
  private framet: number;
  private voronoi: VoronoiDiagram;
  private clusters: CellCluster[];
  private inCell: number = -1;
  // Clusters are rebuilt from this seed every time, so a rebuild after a
  // settings change (or an animated one, every frame) keeps the same random
  // choices instead of re-rolling the picture.
  private readonly buildSeed = newRandomSeed();
  private builtKey = "";

  constructor(paper: Canvas) {
    this.clusters = [];
    this.framet = 0;
    this.inCell = -1;
    // trivial voronoi diagram for typescript
    this.voronoi = createVoronoiFromRandomPoints(1.0, 1.0, 1);
    this.resize(paper.width(), paper.height());
  }

  settings(): RendererSetting[] {
    return voronoiSettings("retained");
  }

  render(ctx: CanvasRenderingContext2D, dt: number) {
    // Rebuild before advancing the clock, so rebuilt clusters start at the
    // spin accumulated so far and this frame's spin is added once, in draw.
    if (this.bakedKey() !== this.builtKey) this.build();
    const delta = 0.0001 * (params.speed + 1.0);
    this.framet = this.framet + delta * dt;
    this.draw(ctx, delta * dt, this.voronoi);
  }

  resize(_w: number, _h: number) {
    const nVoronoiCells = 1024; // TODO parameter!
    this.voronoi = createVoronoiFromRandomPoints(1.0, 1.0, nVoronoiCells);
    this.build();
  }

  // The settings built into each cluster when it's created. Dilation and
  // border are applied while drawing, so they aren't included.
  private bakedKey(): string {
    const v = voronoiParams;
    return [
      v.multiplicity,
      v.thickness,
      v.thicknessVariation,
      v.angleVariation,
      v.linelength,
      v.linelengthVariation,
      v.uniformity,
      v.center.x,
      v.center.y,
    ].join();
  }

  // (Re)build every cell's cluster from the current settings and buildSeed,
  // leaving the frame's random sequence where it was.
  private build() {
    this.builtKey = this.bakedKey();
    const frameSeed = getRandomSeed();
    setRandomSeed(this.buildSeed);
    this.predraw(45.0); // TODO parameter!
    setRandomSeed(frameSeed);
  }

  predraw(spiralness: number) {
    const strokeOptions = voronoiStrokeOptions();
    this.clusters = [];
    for (const cell of this.voronoi.cells) {
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
      // framet adds the spin accumulated so far (draw turns each cluster by
      // r * t per frame), so a rebuild doesn't snap clusters back.
      const ang =
        ((theta + r * spiralness + r * this.framet) / Math.PI) * 180.0 +
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

      const cluster = new Cluster();
      cluster.x = cell.centroid.x;
      cluster.y = cell.centroid.y;
      cluster.ang = ang;
      cluster.linewidth = linewidth;
      for (let i = 0; i < voronoiParams.multiplicity; ++i) {
        cluster.strokes.push(new Stroke(strokeOptions));
      }
      this.clusters.push({ cell, cluster });
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
    _voronoi: VoronoiDiagram,
  ) {
    for (const { cell, cluster } of this.clusters) {
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

      // look at centroid;
      // check radius from center of screen.
      const relativeCentroidX =
        cell.centroid.x - voronoiParams.center.x * 0.5 - 0.5;
      const relativeCentroidY =
        cell.centroid.y - voronoiParams.center.y * 0.5 - 0.5;
      //const theta = Math.atan2(relativeCentroidY, relativeCentroidX);
      const r = Math.sqrt(
        relativeCentroidX * relativeCentroidX +
          relativeCentroidY * relativeCentroidY,
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
    cluster.x = cell.centroid.x;
    cluster.y = cell.centroid.y;

    const ang =
      rand(-voronoiParams.angleVariation, voronoiParams.angleVariation) +
      voronoiParams.verticality;

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
    const linewidth = (thickness * imageThickness) / 10.0; //rand(0.01, 0.1);

    cluster.ang = ang;
    cluster.linewidth = linewidth;
    const strokeOptions = voronoiStrokeOptions();
    for (let i = 0; i < voronoiParams.multiplicity; ++i) {
      cluster.strokes.push(new Stroke(strokeOptions));
    }
    this.clusters.push({ cell, cluster });
    console.log("added cluster");
    return true;
  }

  clear(_ctx: CanvasRenderingContext2D) {
    this.clusters = [];
  }
}
