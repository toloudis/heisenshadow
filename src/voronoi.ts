import { Delaunay } from "d3-delaunay";
import { polygonCentroid } from "d3";

function sqr(x: number): number {
  return x * x;
}

function dist2(v: [number, number], w: [number, number]): number {
  return sqr(v[0] - w[0]) + sqr(v[1] - w[1]);
}

// p - point
// v - start point of segment
// w - end point of segment
function distToSegmentSquared(
  p: [number, number],
  v: [number, number],
  w: [number, number]
): number {
  var l2 = dist2(v, w);
  if (l2 === 0) return dist2(p, v);
  var t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, [v[0] + t * (w[0] - v[0]), v[1] + t * (w[1] - v[1])]);
}

// p - point
// v - start point of segment
// w - end point of segment
function distToSegment(
  p: [number, number],
  v: [number, number],
  w: [number, number]
): number {
  return Math.sqrt(distToSegmentSquared(p, v, w));
}

export interface VoronoiOptions {
  width: number;
  height: number;
  pointsxy: { x: number; y: number }[];
  points: [number, number][];
  relaxIterations: number;
}
const defaultOpts: VoronoiOptions = {
  width: 1024,
  height: 1024,
  pointsxy: [],
  points: [],
  relaxIterations: 8,
};

export interface VCell {
  points: [number, number][];
  innerCircleRadius: number;
  centroid: { x: number; y: number };
}

export interface VNCell {
  points: [number, number][];
  innerCircleRadius: number;
  centroid: { x: number; y: number };
  neighbors: VCell[];
}

export type VoronoiDiagram = {
  cells: VNCell[];
  points: { x: number; y: number }[];
};

export function createVoronoiDiagram(opts: VoronoiOptions): VoronoiDiagram {
  opts = Object.assign({}, defaultOpts, opts);

  opts.points = opts.pointsxy.map((point: { x: number; y: number }) => [
    point.x,
    point.y,
  ]);

  const delaunay: Delaunay<Delaunay.Point> = Delaunay.from(opts.points);
  const voronoi = delaunay.voronoi([0, 0, opts.width, opts.height]);

  const diagramPoints = [];

  for (let k = 0; k < opts.relaxIterations; k++) {
    for (let i = 0; i < delaunay.points.length; i += 2) {
      const cell = voronoi.cellPolygon(i >> 1);

      if (cell === null) continue;

      const x0 = delaunay.points[i];
      const y0 = delaunay.points[i + 1];

      const [x1, y1] = polygonCentroid(cell);

      delaunay.points[i] = x0 + (x1 - x0) * 1;
      delaunay.points[i + 1] = y0 + (y1 - y0) * 1;
    }

    voronoi.update();
  }

  for (let i = 0; i < delaunay.points.length; i += 2) {
    const x = delaunay.points[i];
    const y = delaunay.points[i + 1];

    diagramPoints.push({
      x,
      y,
    });
  }

  let cells: VNCell[] = [];

  for (let i = 0; i < delaunay.points.length; i += 2) {
    const cell = voronoi.cellPolygon(i >> 1);

    if (cell === null) continue;

    cells.push({
      ...formatCell(cell),
      neighbors: [...voronoi.neighbors(i)].map((index) => {
        return {
          ...formatCell(voronoi.cellPolygon(index)),
        };
      }),
    });
  }

  return {
    cells: cells.map((cell, index) => {
      const neighbors = [...voronoi.neighbors(index)];

      cell.neighbors = neighbors.map((index) => cells[index]);

      return cell;
    }),
    points: diagramPoints,
  };
}

function formatCell(points: [number, number][]) {
  return {
    points,
    innerCircleRadius: getClosestEdgeToCentroid(points),
    centroid: {
      x: polygonCentroid(points)[0],
      y: polygonCentroid(points)[1],
    },
  };
}

function getClosestEdgeToCentroid(points: [number, number][]) {
  const centroid = polygonCentroid(points);
  const pointsSorted = sortPointsByAngle(centroid, points);

  let closest = distToSegment(centroid, pointsSorted[0], pointsSorted[1]);

  for (let i = 1; i < points.length - 1; i++) {
    if (points[i + 1]) {
      const dist = distToSegment(
        centroid,
        pointsSorted[i],
        pointsSorted[i + 1]
      );

      if (dist < closest) {
        closest = dist;
      }
    }
  }

  return closest;
}

function sortPointsByAngle(
  centroid: [number, number],
  points: [number, number][]
) {
  const centerPoint = centroid;
  const sorted = points.slice(0);

  const sortByAngle = (p1: [number, number], p2: [number, number]) => {
    return (
      (Math.atan2(p1[1] - centerPoint[1], p1[0] - centerPoint[0]) * 180) /
        Math.PI -
      (Math.atan2(p2[1] - centerPoint[1], p2[0] - centerPoint[0]) * 180) /
        Math.PI
    );
  };

  sorted.sort(sortByAngle);

  return sorted;
}

function random(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

export function createVoronoiFromRandomPoints(
  width: number,
  height: number,
  npts: number
): VoronoiDiagram {
  const points: { x: number; y: number }[] = [...Array(npts)].map(() => {
    return {
      x: random(0, width),
      y: random(0, height),
    };
  });
  return createVoronoiDiagram({
    // The width of our canvas/drawing space
    width,
    // The height of our canvas/drawing space
    height,
    // The generating points we just created
    pointsxy: points,
    points: [],
    // How much we should "even out" our cell dimensions
    relaxIterations: 6,
  });
}

// const debug = true;

// const svg = SVG().viewbox(0, 0, width, height);
// tessellation.cells.forEach((cell) => {
//   if (debug) {
//     svg.polygon(cell.points).fill("none").stroke("#1D1934");
//   }
// });
