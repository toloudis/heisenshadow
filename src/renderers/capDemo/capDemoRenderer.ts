import type { Renderer } from "../../renderer";
import { Stroke } from "../../strokes";
import type { CAP_STYLES } from "../webgpu/recordingContext";

type CapStyle = keyof typeof CAP_STYLES;

// The stroke style fields RecordingContext records beyond canvas 2D's. On a
// canvas 2D context setting them does nothing, so there every stroke has a
// constant width and taper rows draw with round caps.
type StrokeStyleExtras = {
  capStyle: CapStyle;
  endCapStyle: CapStyle | undefined;
  taperFraction: number;
  width0: number;
  width1: number;
  width2: number;
  width3: number;
};

// One row per end style: round, taper over the whole stroke, taper over just
// the ends, then butt for reference. Pen strokes get a row of their own below.
const ROWS: { capStyle: CapStyle; taperFraction: number }[] = [
  { capStyle: "round", taperFraction: 0.5 },
  { capStyle: "taper", taperFraction: 0.5 },
  { capStyle: "taper", taperFraction: 0.2 },
  { capStyle: "butt", taperFraction: 0.5 },
];
const COLS = 6;
const HALF_COLS = COLS / 2;
const HALF_LEN = 0.06;
const ROW_SPACING = 0.19;

// Pen strokes are a hand pressing in, gliding and lifting off: a dot this
// wide (the full line width at p0) narrows to a hairline, then flares
// slightly into a butt end.
const PEN_DOT_WIDTH = 0.011;
// The width changes over parameter t, not distance, so p1 and p2 sit near
// their ends: the curve moves slowly there, the dot and flare each happen
// over a short distance, and the hairline stretches across the middle.
const PEN_END_FRACTION = 0.1;
// A slightly negative width1 sharpens the drop from the dot.
const PEN_WIDTH1 = -0.1;
// Width at p2 and the end, in hairlines
const PEN_WIDTH2_HAIRLINES = 1;
const PEN_FLARE_HAIRLINES = 3;

/**
 * A static test pattern of short, thick strokes for checking end caps and
 * width profiles (the WebGPU backend draws both; canvas 2D only round and butt
 * caps). Each row is a different end style. The left half of the columns has
 * constant width; the right half repeats the same strokes swelling toward p1
 * and thinning toward p2. Across each half the strokes turn and bend more.
 * The last row is pen strokes: a dot narrowing to a 1px line that curves
 * slightly, then flares a little into a butt end.
 */
export class CapDemoRenderer implements Renderer {
  // One stroke per column of a half, bending more from left to right. Every
  // row and both halves share them.
  private readonly strokes: Stroke[] = [];
  // One per column of a half, each curving gently to one side, more from
  // left to right.
  private readonly penStrokes: Stroke[] = [];
  // One pixel in paper units, along the canvas's shorter side
  private onePx = 1 / 800;

  constructor() {
    for (let k = 0; k < HALF_COLS; k++) {
      // Built straight, then bent into an S by moving the middle control
      // points to either side.
      const stroke = new Stroke({
        sizeX: 0,
        sizeY: HALF_LEN,
        lengthVariation: 0,
        variability: 0,
      });
      const bend = (k / (HALF_COLS - 1)) * HALF_LEN;
      stroke.x1 = bend;
      stroke.x2 = -bend;
      this.strokes.push(stroke);

      const pen = new Stroke({
        sizeX: 0,
        sizeY: HALF_LEN,
        lengthVariation: 0,
        variability: 0,
      });
      const penBend = ((k + 1) / HALF_COLS) * 0.2 * HALF_LEN;
      const endLen = PEN_END_FRACTION * 2 * HALF_LEN;
      pen.x1 = penBend;
      pen.y1 = pen.y0 + endLen;
      pen.x2 = penBend;
      pen.y2 = pen.y3 - endLen;
      this.penStrokes.push(pen);
    }
  }

  clear(_ctx: CanvasRenderingContext2D) {}
  pointerMove(_e: PointerEvent, _relx: number, _rely: number) {
    return false;
  }
  resize(w: number, h: number) {
    this.onePx = 1 / Math.min(w, h);
  }

  render(ctx: CanvasRenderingContext2D, _dt: number) {
    const extras = ctx as unknown as StrokeStyleExtras;
    ROWS.forEach((row, r) => {
      extras.capStyle = row.capStyle;
      extras.taperFraction = row.taperFraction;
      for (let c = 0; c < COLS; c++) {
        // position within the half, so each right stroke matches its left twin
        const k = c % HALF_COLS;
        const varied = c >= HALF_COLS;
        extras.width1 = varied ? 2.0 : 1.0;
        extras.width2 = varied ? 0.4 : 1.0;
        ctx.save();
        ctx.lineCap = row.capStyle === "butt" ? "butt" : "round";
        ctx.lineWidth = 0.025 + 0.01 * (k % 2);
        ctx.translate(0.1 + c * 0.16, 0.12 + r * ROW_SPACING);
        ctx.rotate(((k - (HALF_COLS - 1) / 2) * 30 * Math.PI) / 180);
        this.strokes[k].draw(ctx);
        ctx.restore();
      }
    });

    // Pen row: the hairline is 1px, as a fraction of the dot
    const hairline = this.onePx / PEN_DOT_WIDTH;
    extras.capStyle = "round";
    extras.endCapStyle = "butt";
    extras.width1 = PEN_WIDTH1;
    extras.width2 = PEN_WIDTH2_HAIRLINES * hairline;
    extras.width3 = PEN_FLARE_HAIRLINES * hairline;
    for (let c = 0; c < COLS; c++) {
      const k = c % HALF_COLS;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineWidth = PEN_DOT_WIDTH;
      ctx.translate(0.1 + c * 0.16, 0.12 + ROWS.length * ROW_SPACING);
      ctx.rotate(((k - (HALF_COLS - 1) / 2) * 30 * Math.PI) / 180);
      this.penStrokes[k].draw(ctx);
      ctx.restore();
    }

    extras.capStyle = "round";
    extras.endCapStyle = undefined;
    extras.taperFraction = 0.5;
    extras.width0 = 1;
    extras.width1 = 1;
    extras.width2 = 1;
    extras.width3 = 1;
  }
}
