import type { Accessor } from "./binding";
import { Emitter } from "./emitter";
import { createLabel } from "./label";

/** A 2D point, the value of a trackpad. */
export type Point = { x: number; y: number };

/** The range of one trackpad axis. */
export type AxisRange = {
  /** Lowest value. Default -1. */
  min?: number;
  /** Highest value. Default 1. */
  max?: number;
};

export type TrackpadOptions = {
  /** Short text shown in the pad's top-left corner. */
  label?: string;
  /** Range of the horizontal axis, increasing to the right. Default -1 to 1. */
  x?: AxisRange;
  /** Range of the vertical axis. Default -1 to 1. */
  y?: AxisRange;
  /**
   * By default y increases downward, like canvas coordinates (and Tweakpane's
   * point control). `true` makes it increase upward instead.
   */
  invertY?: boolean;
  /** Formats each axis in the readout. Default: 2 decimals. */
  format?: (value: number) => string;
  /** Starting point when the trackpad isn't bound to a target. Default the center of both ranges. */
  value?: Point;
};

/** Events of {@link TrackpadApi}. Handlers run synchronously. */
export type TrackpadEvents = {
  /**
   * The point changed; carries a copy of the new point, already clamped and
   * written to the target. Fires on every change while dragging and when
   * `value` is set. Never fires from `refresh()` or when the point is
   * unchanged.
   */
  change: Point;
};

/**
 * A square pad (two buttons wide and tall by default) that sets a 2D point:
 * press anywhere to jump there, then drag. Crosshairs and a dot mark the
 * point. Created with `container.addTrackpad(...)`.
 */
export class TrackpadApi {
  readonly element: HTMLElement;

  private readonly xMin: number;
  private readonly xMax: number;
  private readonly yMin: number;
  private readonly yMax: number;
  private readonly invertY: boolean;
  private readonly format: (value: number) => string;
  private readonly emitter = new Emitter<TrackpadEvents>();
  private readonly valueEl: HTMLElement;

  constructor(
    private readonly accessor: Accessor<Point>,
    options: TrackpadOptions = {},
  ) {
    this.xMin = options.x?.min ?? -1;
    this.xMax = options.x?.max ?? 1;
    this.yMin = options.y?.min ?? -1;
    this.yMax = options.y?.max ?? 1;
    this.invertY = options.invertY ?? false;
    this.format = options.format ?? ((v) => v.toFixed(2));

    this.element = document.createElement("div");
    this.element.className = "cc-trackpad";
    for (const name of [
      "cc-trackpad-hline",
      "cc-trackpad-vline",
      "cc-trackpad-dot",
    ]) {
      const e = document.createElement("div");
      e.className = name;
      this.element.append(e);
    }
    this.element.append(createLabel(options.label ?? "", "span"));
    this.valueEl = document.createElement("span");
    this.valueEl.className = "cc-trackpad-value";
    this.element.append(this.valueEl);

    this.element.addEventListener("pointerdown", this.onPointerDown);

    this.render();
  }

  /** The current point (a copy). Setting it clamps it, writes the target, and fires `change`. */
  get value(): Point {
    const p = this.accessor.get();
    return { x: p.x, y: p.y };
  }

  set value(p: Point) {
    this.setPoint(p.x, p.y);
  }

  /** Listen for `"change"` (the new point). Returns an unsubscribe function. */
  on<K extends keyof TrackpadEvents>(
    name: K,
    handler: (value: TrackpadEvents[K]) => void,
  ): () => void {
    return this.emitter.on(name, handler);
  }

  refresh() {
    this.render();
  }

  dispose() {
    this.endDrag();
    this.element.remove();
  }

  private setPoint(x: number, y: number) {
    const p = {
      x: clamp(x, this.xMin, this.xMax),
      y: clamp(y, this.yMin, this.yMax),
    };
    const old = this.accessor.get();
    if (p.x !== old.x || p.y !== old.y) {
      this.accessor.set(p);
      this.emitter.emit("change", { ...p });
    }
    this.render();
  }

  private render() {
    const p = this.accessor.get();
    const tx = fraction(p.x, this.xMin, this.xMax);
    let ty = fraction(p.y, this.yMin, this.yMax);
    if (this.invertY) ty = 1 - ty;
    this.element.style.setProperty("--cc-tx", String(tx));
    this.element.style.setProperty("--cc-ty", String(ty));
    this.valueEl.textContent = `${this.format(p.x)}, ${this.format(p.y)}`;
  }

  // ---- pointer: press to jump, drag to move -----------------------------------
  // The drag is tracked with window listeners rather than pointer capture: in
  // Chrome on Windows, the pad's crosshair cursor stayed stuck to the pointer
  // after a captured drag ended.

  private setFromPointer(e: PointerEvent) {
    const rect = this.element.getBoundingClientRect();
    const tx = (e.clientX - rect.left) / rect.width;
    let ty = (e.clientY - rect.top) / rect.height;
    if (this.invertY) ty = 1 - ty;
    this.setPoint(
      this.xMin + tx * (this.xMax - this.xMin),
      this.yMin + ty * (this.yMax - this.yMin),
    );
  }

  private dragPointer: number | undefined;

  private onPointerDown = (e: PointerEvent) => {
    if (this.dragPointer !== undefined) return;
    // No text selection or native drag starting from the pad.
    e.preventDefault();
    this.dragPointer = e.pointerId;
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerEnd);
    window.addEventListener("pointercancel", this.onPointerEnd);
    window.addEventListener("blur", this.endDrag);
    this.element.classList.add("cc-active");
    this.setFromPointer(e);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerId === this.dragPointer) this.setFromPointer(e);
  };

  private onPointerEnd = (e: PointerEvent) => {
    if (e.pointerId === this.dragPointer) this.endDrag();
  };

  private endDrag = () => {
    this.dragPointer = undefined;
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerEnd);
    window.removeEventListener("pointercancel", this.onPointerEnd);
    window.removeEventListener("blur", this.endDrag);
    this.element.classList.remove("cc-active");
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function fraction(v: number, lo: number, hi: number) {
  return hi === lo ? 0 : (v - lo) / (hi - lo);
}
