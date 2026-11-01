import { type Accessor, localValue } from "./binding";
import { ButtonApi, type ButtonEvents, type ButtonMode } from "./button";
import { Emitter } from "./emitter";
import type { Keyboard } from "./keyboard";
import { SliderApi, type SliderOptions } from "./slider";

export type SliderWithButtonOptions = SliderOptions & {
  /**
   * When true, the button is an on/off gate: the slider only writes to its
   * target while the button is on. Default false: the button is independent
   * (listen via `.button`).
   */
  gated?: boolean;
  /** Text on the button. Default `"on"` when gated, otherwise empty. */
  buttonLabel?: string;
  /** Key that presses the button. Same format as `ButtonOptions.key`. */
  buttonKey?: string;
  /** Button behavior when not gated. Default `"toggle"`. A gate always toggles. */
  buttonMode?: ButtonMode;
  /** Starting button state. Default true (connected) when gated, otherwise false. */
  buttonValue?: boolean;
};

/** Events of {@link SliderWithButtonApi}. Handlers run synchronously. */
export type SliderWithButtonEvents = {
  /**
   * The target was written; carries the new value. Fires while the slider
   * moves (if not gated off), and once when a gate turns on and the target
   * catches up to a slider that moved while off (right after `enable`). Never
   * fires while gated off, from `refresh()`, or when the value is unchanged.
   */
  change: number;
  /**
   * The gate turned on (`true`) or off (`false`), by key, pointer, or setting
   * `enabled`. Only fires when `gated` is true.
   */
  enable: boolean;
  /** The button went down. Same as {@link ButtonEvents.press}. */
  press: undefined;
  /** The button came back up. Same as {@link ButtonEvents.release}. */
  release: undefined;
};

/**
 * A slider and a button paired as one channel. Vertical: slider above the
 * button. Horizontal: button left of the slider. Created with
 * `container.addSliderWithButton(...)`.
 *
 * Gated: the slider can always be moved, but it only writes to the target
 * while the button is on. Turning the button back on writes the slider's
 * current position right away, so the target catches up with wherever the
 * slider was moved while gated off.
 */
export class SliderWithButtonApi {
  readonly element: HTMLElement;
  readonly slider: SliderApi;
  readonly button: ButtonApi;

  private readonly gated: boolean;
  private readonly emitter = new Emitter<SliderWithButtonEvents>();

  constructor(
    private readonly target: Accessor<number>,
    keyboard: Keyboard,
    options: SliderWithButtonOptions = {},
  ) {
    this.gated = options.gated ?? false;
    const horizontal = options.orientation === "horizontal";

    // The slider keeps its own position; only this class writes the target.
    this.slider = new SliderApi(localValue(target.get()), keyboard, options);
    this.button = new ButtonApi(
      localValue(options.buttonValue ?? this.gated),
      keyboard,
      {
        label: options.buttonLabel ?? (this.gated ? "on" : ""),
        key: options.buttonKey,
        mode: this.gated ? "toggle" : options.buttonMode,
      },
    );

    this.element = document.createElement("div");
    this.element.className = `cc-slider-button cc-panel ${horizontal ? "cc-row" : "cc-column"}`;
    this.element.classList.toggle("cc-gated", this.gated);
    if (horizontal) {
      this.element.append(this.button.element, this.slider.element);
    } else {
      this.element.append(this.slider.element, this.button.element);
    }

    this.slider.on("change", (v) => {
      if (this.enabled) this.write(v);
    });
    this.button.on("press", () => this.emitter.emit("press", undefined));
    this.button.on("release", () => this.emitter.emit("release", undefined));
    if (this.gated) {
      this.button.on("change", (on) => {
        this.render();
        // Announce the gate before the catch-up write it causes.
        this.emitter.emit("enable", on);
        if (on) this.write(this.slider.value);
      });
    }
    this.render();
  }

  /** The target's value, which lags the slider while gated off. */
  get value(): number {
    return this.target.get();
  }

  /**
   * Whether the slider writes to the target: the gate's state, or always true
   * when not gated. Setting it has no effect when not gated.
   */
  get enabled(): boolean {
    return !this.gated || this.button.value;
  }

  set enabled(on: boolean) {
    if (this.gated) this.button.value = on;
  }

  /**
   * Listen for `"change"` (the value written to the target), `"enable"` (the
   * gate turned on or off), or `"press"` / `"release"` (the button went down /
   * came up, by key or pointer). Returns an unsubscribe function.
   */
  on<K extends keyof SliderWithButtonEvents>(
    name: K,
    handler: (value: SliderWithButtonEvents[K]) => void,
  ): () => void {
    return this.emitter.on(name, handler);
  }

  /**
   * Re-read the target. While gated off the slider is deliberately detached
   * from the target, so it keeps its position.
   */
  refresh() {
    if (this.enabled) this.slider.value = this.target.get();
    this.button.refresh();
    this.render();
  }

  dispose() {
    this.slider.dispose();
    this.button.dispose();
    this.element.remove();
  }

  private write(v: number) {
    if (v !== this.target.get()) {
      this.target.set(v);
      this.emitter.emit("change", v);
    }
  }

  private render() {
    this.element.classList.toggle("cc-off", !this.enabled);
  }
}
