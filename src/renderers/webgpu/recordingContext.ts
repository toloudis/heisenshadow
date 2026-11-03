// Records a renderer's canvas 2D drawing as strokes for the WebGPU backend.
// Each stroke is a cubic bezier in 0..1 paper coordinates along with its line
// width and clip polygon.

// How stroke ends are drawn. "round" matches the canvas renderers'
// lineCap = "round"; "taper" narrows the width to a point over the first or
// last taperFraction of the stroke.
export const CAP_STYLES = { butt: 0, round: 1, taper: 2 };

// Packed layout matching the Stroke struct in both shaders:
// p0, p1, p2, p3 (8 floats);
// line width at p0, p1, p2, p3;
// caps (start + 4 * end), taper fraction, clip polygon start, clip polygon
// point count.
export const FLOATS_PER_STROKE = 16;
// Saved state per save(): transform (6), clip start, clip count, line width.
const FLOATS_PER_SAVE = 9;

/**
 * Just enough of CanvasRenderingContext2D for the renderers and Cluster /
 * Stroke drawing. Tracks the transform, line width and clip, and records each
 * stroked bezier with its control points already transformed. Assumes the
 * transform only translates and rotates, so the line width needs no scaling.
 *
 * Clips are convex polygons (cell rects, voronoi cells). A clip replaces the
 * current one instead of intersecting with it; no renderer nests clips.
 *
 * It's reused every frame, writing into growable typed arrays, so recording
 * allocates nothing once the arrays are big enough.
 */
export class RecordingContext {
  lineWidth = 1;
  // Not part of CanvasRenderingContext2D: the end style and width profile
  // recorded with each stroke. The renderers leave these at their defaults.
  capStyle: keyof typeof CAP_STYLES = "round";
  // The style at p3, when it differs from capStyle (which then is just p0's)
  endCapStyle: keyof typeof CAP_STYLES | undefined = undefined;
  taperFraction = 0.5;
  // Line width scales at the four control points: each stroke is recorded
  // with widths lineWidth * widthN, and the width along it is a cubic bezier
  // through those, clamped at 0.
  width0 = 1;
  width1 = 1;
  width2 = 1;
  width3 = 1;

  strokeData = new Float32Array(FLOATS_PER_STROKE * 1024);
  strokeCount = 0;
  clipPoints = new Float32Array(2 * 1024);
  clipPointCount = 0;

  // Affine transform as in canvas setTransform(a, b, c, d, e, f)
  private a = 1;
  private b = 0;
  private c = 0;
  private d = 1;
  private e = 0;
  private f = 0;
  private clipStart = 0;
  private clipCount = 0;
  private stack: number[] = [];
  private path = new Float32Array(2 * 64);
  private pathCount = 0;
  private pathHasCurve = false;

  /** Forget everything recorded, ready for a new frame. */
  reset() {
    this.strokeCount = 0;
    this.clipPointCount = 0;
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;
    this.clipStart = 0;
    this.clipCount = 0;
    this.stack.length = 0;
    this.lineWidth = 1;
    this.capStyle = "round";
    this.endCapStyle = undefined;
    this.taperFraction = 0.5;
    this.width0 = 1;
    this.width1 = 1;
    this.width2 = 1;
    this.width3 = 1;
    this.beginPath();
  }

  save() {
    this.stack.push(
      this.a,
      this.b,
      this.c,
      this.d,
      this.e,
      this.f,
      this.clipStart,
      this.clipCount,
      this.lineWidth,
    );
  }

  restore() {
    const s = this.stack;
    if (s.length < FLOATS_PER_SAVE) return;
    const i = s.length - FLOATS_PER_SAVE;
    this.a = s[i];
    this.b = s[i + 1];
    this.c = s[i + 2];
    this.d = s[i + 3];
    this.e = s[i + 4];
    this.f = s[i + 5];
    this.clipStart = s[i + 6];
    this.clipCount = s[i + 7];
    this.lineWidth = s[i + 8];
    s.length = i;
  }

  translate(x: number, y: number) {
    this.e += this.a * x + this.c * y;
    this.f += this.b * x + this.d * y;
  }

  rotate(r: number) {
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    const { a, b, c, d } = this;
    this.a = a * cr + c * sr;
    this.b = b * cr + d * sr;
    this.c = c * cr - a * sr;
    this.d = d * cr - b * sr;
  }

  beginPath() {
    this.pathCount = 0;
    this.pathHasCurve = false;
  }

  // As in canvas 2D, path calls with a non-finite coordinate are ignored.
  // (The voronoi cells' dilated outlines end in a NaN point.)
  moveTo(x: number, y: number) {
    if (!Number.isFinite(x + y)) return;
    this.pathCount = 0;
    this.addPoint(x, y);
  }

  lineTo(x: number, y: number) {
    if (!Number.isFinite(x + y)) return;
    this.addPoint(x, y);
  }

  closePath() {}

  rect(x: number, y: number, w: number, h: number) {
    this.addPoint(x, y);
    this.addPoint(x + w, y);
    this.addPoint(x + w, y + h);
    this.addPoint(x, y + h);
  }

  bezierCurveTo(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ) {
    if (!Number.isFinite(x1 + y1 + x2 + y2 + x3 + y3)) return;
    this.addPoint(x1, y1);
    this.addPoint(x2, y2);
    this.addPoint(x3, y3);
    this.pathHasCurve = true;
  }

  stroke() {
    if (!this.pathHasCurve || this.pathCount !== 4) return;
    const base = this.strokeCount * FLOATS_PER_STROKE;
    if (base + FLOATS_PER_STROKE > this.strokeData.length) {
      this.strokeData = grow(this.strokeData);
    }
    const out = this.strokeData;
    out.set(this.path.subarray(0, 8), base);
    out[base + 8] = this.lineWidth * this.width0;
    out[base + 9] = this.lineWidth * this.width1;
    out[base + 10] = this.lineWidth * this.width2;
    out[base + 11] = this.lineWidth * this.width3;
    out[base + 12] =
      CAP_STYLES[this.capStyle] +
      4 * CAP_STYLES[this.endCapStyle ?? this.capStyle];
    out[base + 13] = this.taperFraction;
    out[base + 14] = this.clipStart;
    out[base + 15] = this.clipCount;
    this.strokeCount++;
  }

  /** Make the current path the clip polygon, stored counter-clockwise. */
  clip() {
    const n = this.pathCount;
    if (n < 3) return;
    while ((this.clipPointCount + n) * 2 > this.clipPoints.length) {
      this.clipPoints = grow(this.clipPoints);
    }
    const p = this.path;
    let area2 = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area2 += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
    }
    const start = this.clipPointCount;
    const out = this.clipPoints;
    for (let i = 0; i < n; i++) {
      const src = area2 >= 0 ? i : n - 1 - i;
      out[(start + i) * 2] = p[src * 2];
      out[(start + i) * 2 + 1] = p[src * 2 + 1];
    }
    this.clipPointCount += n;
    this.clipStart = start;
    this.clipCount = n;
  }

  private addPoint(x: number, y: number) {
    if ((this.pathCount + 1) * 2 > this.path.length) {
      this.path = grow(this.path);
    }
    const i = this.pathCount * 2;
    this.path[i] = this.a * x + this.c * y + this.e;
    this.path[i + 1] = this.b * x + this.d * y + this.f;
    this.pathCount++;
  }
}

function grow(arr: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  const bigger = new Float32Array(arr.length * 2);
  bigger.set(arr);
  return bigger;
}
