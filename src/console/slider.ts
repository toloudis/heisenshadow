import type { Accessor } from "./binding";
import { type Keyboard, keyLabel } from "./keyboard";
import {
  RangeControl,
  type RangeEvents,
  type RangeOptions,
} from "./rangeControl";

export type SliderOptions = RangeOptions & {
  /** Text shown above (vertical) or left of (horizontal) the track. */
  label?: string;
  /** Default `"vertical"` (increases upward); `"horizontal"` increases to the right. */
  orientation?: Orientation;
};

export type Orientation = "vertical" | "horizontal";

/** Events of {@link SliderApi}. Handlers run synchronously. */
export type SliderEvents = RangeEvents;

function el(tag: string, className: string, parent?: HTMLElement) {
  const e = document.createElement(tag);
  e.className = className;
  parent?.append(e);
  return e;
}

/**
 * A slider that can be dragged with the pointer or moved with held keys.
 * Created with `container.addSlider(...)`.
 */
export class SliderApi extends RangeControl {
  readonly element: HTMLElement;

  private readonly horizontal: boolean;
  private readonly track: HTMLElement;
  private readonly valueEl: HTMLElement;

  constructor(
    accessor: Accessor<number>,
    keyboard: Keyboard,
    options: SliderOptions = {},
  ) {
    super(accessor, keyboard, options);
    this.horizontal = options.orientation === "horizontal";

    this.element = el("div", "cc-slider");
    this.element.classList.add(
      this.horizontal ? "cc-horizontal" : "cc-vertical",
    );
    el("div", "cc-label", this.element).textContent = options.label ?? "";
    this.valueEl = el("div", "cc-slider-value", this.element);
    this.track = el("div", "cc-slider-track", this.element);
    el("div", "cc-slider-fill", this.track);
    el("div", "cc-slider-thumb", this.track);
    const keys = el("div", "cc-key-hint", this.element);
    keys.textContent = [options.upKey, options.downKey]
      .filter((k) => k !== undefined)
      .map(keyLabel)
      .join(" / ");

    this.track.addEventListener("pointerdown", this.onPointerDown);
    this.track.addEventListener("pointermove", this.onPointerMove);

    this.render();
  }

  protected render() {
    this.element.style.setProperty("--cc-t", String(this.fraction()));
    this.valueEl.textContent = this.format(this.value);
  }

  // ---- pointer: drag along the track ----------------------------------------

  private setFromPointer(e: PointerEvent) {
    const rect = this.track.getBoundingClientRect();
    const t = this.horizontal
      ? (e.clientX - rect.left) / rect.width
      : 1 - (e.clientY - rect.top) / rect.height;
    this.setRaw(this.min + t * (this.max - this.min));
  }

  private onPointerDown = (e: PointerEvent) => {
    this.track.setPointerCapture(e.pointerId);
    this.setFromPointer(e);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.track.hasPointerCapture(e.pointerId)) this.setFromPointer(e);
  };
}
