import type { Accessor } from "./binding";
import { type Keyboard, keyLabel } from "./keyboard";
import {
  RangeControl,
  type RangeEvents,
  type RangeOptions,
} from "./rangeControl";

export type DialOptions = RangeOptions & {
  /** Short text shown in the middle of the knob, above the value. */
  label?: string;
};

/** Events of {@link DialApi}. Handlers run synchronously. */
export type DialEvents = RangeEvents;

// Knob geometry in a 48×48 viewBox. Angles are degrees clockwise from 12
// o'clock: min sits at 7 o'clock (-150°) and max at 5 o'clock (+150°), leaving
// a gap at the bottom for the light.
const C = 24;
const ARC_R = 21;
const MIN_ANGLE = -150;
const SWEEP = 300;
// Vertical drag distance, in pixels, that turns the dial through its range.
const DRAG_PIXELS = 150;

function polar(r: number, deg: number): string {
  const a = (deg * Math.PI) / 180;
  return `${(C + r * Math.sin(a)).toFixed(2)} ${(C - r * Math.cos(a)).toFixed(2)}`;
}

const ARC_PATH = `M ${polar(ARC_R, MIN_ANGLE)} A ${ARC_R} ${ARC_R} 0 1 1 ${polar(ARC_R, MIN_ANGLE + SWEEP)}`;

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.append(e);
  return e;
}

/**
 * A round knob (`--cc-dial-size`, a little larger than a button) turned by
 * held keys or by dragging up and down. An arc fills from 7 o'clock (min) to
 * 5 o'clock (max), a mark on the knob points at the value, the label and value
 * are shown in the middle, and a light at the bottom is lit whenever the value
 * is above min. Created with `container.addDial(...)`.
 */
export class DialApi extends RangeControl {
  readonly element: HTMLElement;

  private readonly valueEl: HTMLElement;
  private readonly fill: SVGPathElement;
  private readonly indicator: SVGLineElement;
  private dragStartY = 0;
  private dragStartRaw = 0;

  constructor(
    accessor: Accessor<number>,
    keyboard: Keyboard,
    options: DialOptions = {},
  ) {
    super(accessor, keyboard, options);

    this.element = document.createElement("div");
    this.element.className = "cc-dial";
    const knob = document.createElement("div");
    knob.className = "cc-dial-face";
    this.element.append(knob);

    const root = svg(
      "svg",
      { viewBox: "0 0 48 48", "aria-hidden": "true" },
      knob,
    );
    svg("path", { class: "cc-dial-track", d: ARC_PATH, pathLength: 1 }, root);
    this.fill = svg(
      "path",
      { class: "cc-dial-fill", d: ARC_PATH, pathLength: 1 },
      root,
    );
    svg("circle", { class: "cc-dial-knob", cx: C, cy: C, r: 16 }, root);
    this.indicator = svg(
      "line",
      // A short mark at the knob's rim, clear of the centered label.
      { class: "cc-dial-indicator", x1: C, y1: C - 12, x2: C, y2: C - 15 },
      root,
    );
    svg(
      "circle",
      { class: "cc-dial-light", cx: C, cy: C + ARC_R, r: 2.2 },
      root,
    );

    // Label and value in the middle of the knob.
    const text = document.createElement("div");
    text.className = "cc-dial-text";
    const labelEl = document.createElement("span");
    labelEl.className = "cc-label";
    labelEl.textContent = options.label ?? "";
    this.valueEl = document.createElement("span");
    this.valueEl.className = "cc-dial-value";
    text.append(labelEl, this.valueEl);
    knob.append(text);

    // Key hint under the knob, only when there are keys, so keyless dials
    // stay compact.
    const keys = [options.upKey, options.downKey].filter(
      (k) => k !== undefined,
    );
    if (keys.length > 0) {
      const hint = document.createElement("div");
      hint.className = "cc-key-hint";
      hint.textContent = keys.map(keyLabel).join(" / ");
      this.element.append(hint);
    }

    this.element.addEventListener("pointerdown", this.onPointerDown);
    this.element.addEventListener("pointermove", this.onPointerMove);

    this.render();
  }

  protected render() {
    const t = this.fraction();
    this.fill.setAttribute("stroke-dasharray", `${t} 1`);
    this.indicator.setAttribute(
      "transform",
      `rotate(${MIN_ANGLE + t * SWEEP} ${C} ${C})`,
    );
    this.element.classList.toggle("cc-lit", this.value > this.min);
    this.valueEl.textContent = this.format(this.value);
  }

  // ---- pointer: drag up to turn clockwise ------------------------------------

  private onPointerDown = (e: PointerEvent) => {
    this.element.setPointerCapture(e.pointerId);
    this.dragStartY = e.clientY;
    this.dragStartRaw = this.raw;
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.element.hasPointerCapture(e.pointerId)) return;
    const turned = (this.dragStartY - e.clientY) / DRAG_PIXELS;
    this.setRaw(this.dragStartRaw + turned * (this.max - this.min));
  };
}
