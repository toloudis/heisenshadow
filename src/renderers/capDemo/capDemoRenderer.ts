import type { Renderer } from "../../renderer";
import { Stroke } from "../../strokes";
import type { CAP_STYLES } from "../webgpu/recordingContext";

type CapStyle = keyof typeof CAP_STYLES;

// The stroke style fields RecordingContext records beyond canvas 2D's. On a
// canvas 2D context setting them does nothing, so there every stroke has a
// constant width and taper rows draw with round caps.
type StrokeStyleExtras = {
  capStyle: CapStyle;
  taperFraction: number;
  width1: number;
  width2: number;
};

// One row per end style: round, taper over the whole stroke, taper over just
// the ends, then butt for reference.
const ROWS: { capStyle: CapStyle; taperFraction: number }[] = [
  { capStyle: "round", taperFraction: 0.5 },
  { capStyle: "taper", taperFraction: 0.5 },
  { capStyle: "taper", taperFraction: 0.2 },
  { capStyle: "butt", taperFraction: 0.5 },
];
const COLS = 6;
const HALF_COLS = COLS / 2;
const HALF_LEN = 0.06;

/**
 * A static test pattern of short, thick strokes for checking end caps and
 * width profiles (the WebGPU backend draws both; canvas 2D only round and butt
 * caps). Each row is a different end style. The left half of the columns has
 * constant width; the right half repeats the same strokes swelling toward p1
 * and thinning toward p2. Across each half the strokes turn and bend more.
 */
export class CapDemoRenderer implements Renderer {
  // One stroke per column of a half, bending more from left to right. Every
  // row and both halves share them.
  private readonly strokes: Stroke[] = [];

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
    }
  }

  clear(_ctx: CanvasRenderingContext2D) {}
  pointerMove(_e: PointerEvent, _relx: number, _rely: number) {
    return false;
  }
  resize(_w: number, _h: number) {}

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
        ctx.translate(0.1 + c * 0.16, 0.14 + r * 0.24);
        ctx.rotate(((k - (HALF_COLS - 1) / 2) * 30 * Math.PI) / 180);
        this.strokes[k].draw(ctx);
        ctx.restore();
      }
    });
    extras.capStyle = "round";
    extras.taperFraction = 0.5;
    extras.width1 = 1;
    extras.width2 = 1;
  }
}
