import type { Accessor } from "./binding";
import { Emitter } from "./emitter";
import type { Keyboard } from "./keyboard";

/** Options shared by every control with a numeric range (sliders, dials). */
export type RangeOptions = {
  /** Lowest value. Default 0. */
  min?: number;
  /** Highest value. Default 1. */
  max?: number;
  /** Snap the value to multiples of this, counted from `min`. Default: no snapping. */
  step?: number;
  /**
   * Key that raises the value continuously while held, e.g. `"q"`. A single
   * letter or digit, or a `KeyboardEvent.code` such as `"ArrowUp"`.
   */
  upKey?: string;
  /** Key that lowers the value continuously while held. Same format as `upKey`. */
  downKey?: string;
  /** Fraction of the full range traveled per second while a key is held. Default 0.5. */
  speed?: number;
  /** Formats the value readout. Default: fixed decimals matching `step` (2 without a step). */
  format?: (value: number) => string;
  /** Starting value when the control isn't bound to a target. Default `min`. */
  value?: number;
};

/** Events of a range control ({@link SliderApi}, {@link DialApi}). Handlers run synchronously. */
export type RangeEvents = {
  /**
   * The value changed; carries the new value, already clamped and snapped
   * and written to the target. Fires on every change while dragging or while
   * a key is held (up to once per animation frame), on each key tap, and when
   * `value` is set. Never fires from `refresh()` or when the value is
   * unchanged (e.g. held against `min`/`max`, or a move smaller than `step`).
   */
  change: number;
};

/**
 * The value logic behind sliders and dials: range, snapping, binding, events,
 * and continuous motion while a key is held. Subclasses build `element`, call
 * `render()` once it exists, and turn pointer input into `setRaw` calls.
 */
export abstract class RangeControl {
  abstract readonly element: HTMLElement;

  protected readonly min: number;
  protected readonly max: number;
  protected readonly step: number | undefined;
  protected readonly format: (value: number) => string;
  private readonly speed: number;
  private readonly emitter = new Emitter<RangeEvents>();
  private readonly unbindKeys: (() => void)[] = [];

  // Unsnapped value. Key motion accumulates here so that slow movement still
  // crosses step boundaries instead of being rounded away every frame.
  protected raw: number;
  private upHeld = false;
  private downHeld = false;
  private frame = 0;
  private lastTime = 0;

  constructor(
    private readonly accessor: Accessor<number>,
    keyboard: Keyboard,
    options: RangeOptions,
  ) {
    this.min = options.min ?? 0;
    this.max = options.max ?? 1;
    this.step = options.step;
    this.speed = options.speed ?? 0.5;
    this.format = options.format ?? ((v) => v.toFixed(this.decimals()));

    if (options.upKey) {
      this.unbindKeys.push(
        keyboard.bind(options.upKey, {
          down: () => this.hold(1, true),
          up: () => this.hold(1, false),
        }),
      );
    }
    if (options.downKey) {
      this.unbindKeys.push(
        keyboard.bind(options.downKey, {
          down: () => this.hold(-1, true),
          up: () => this.hold(-1, false),
        }),
      );
    }

    this.raw = this.clamp(accessor.get());
  }

  /** Current value. Setting it clamps, snaps, and writes the target. */
  get value(): number {
    return this.accessor.get();
  }

  set value(v: number) {
    this.setRaw(v);
  }

  /** Listen for `"change"` (the new value). Returns an unsubscribe function. */
  on<K extends keyof RangeEvents>(
    name: K,
    handler: (value: RangeEvents[K]) => void,
  ): () => void {
    return this.emitter.on(name, handler);
  }

  /** Re-read the bound value, e.g. after the target object was changed elsewhere. */
  refresh() {
    this.raw = this.clamp(this.accessor.get());
    this.render();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    for (const unbind of this.unbindKeys) unbind();
    this.element.remove();
  }

  /** Update the visuals from `value` and `fraction()`. */
  protected abstract render(): void;

  /** The value's position in the range, 0 at `min` to 1 at `max`. */
  protected fraction(): number {
    const range = this.max - this.min;
    return range > 0 ? (this.clamp(this.value) - this.min) / range : 0;
  }

  protected setRaw(v: number) {
    this.raw = this.clamp(v);
    const next = this.snap(this.raw);
    if (next !== this.accessor.get()) {
      this.accessor.set(next);
      this.emitter.emit("change", next);
    }
    this.render();
  }

  private decimals(): number {
    if (this.step === undefined) return 2;
    const s = String(this.step);
    return s.includes(".") ? s.length - s.indexOf(".") - 1 : 0;
  }

  private clamp(v: number): number {
    return Math.min(this.max, Math.max(this.min, v));
  }

  private snap(v: number): number {
    if (this.step === undefined) return v;
    const snapped =
      this.min + Math.round((v - this.min) / this.step) * this.step;
    return this.clamp(Number(snapped.toFixed(this.decimals())));
  }

  // ---- keyboard: continuous motion while held -------------------------------

  private get direction(): number {
    return (this.upHeld ? 1 : 0) - (this.downHeld ? 1 : 0);
  }

  private hold(dir: 1 | -1, held: boolean) {
    // Settle motion under the old direction up to this moment, so travel
    // matches how long the key was actually held even if frames were sparse.
    this.advance(performance.now());
    if (dir === 1) this.upHeld = held;
    else this.downHeld = held;
    this.element.classList.toggle("cc-active", this.upHeld || this.downHeld);
    if (held) {
      // A quick tap still moves by one step even if released before the next
      // animation frame.
      this.setRaw(this.raw + dir * (this.step ?? (this.max - this.min) / 200));
    }
    if (this.direction !== 0 && !this.frame) {
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  // Move by the held direction for the time elapsed since the last advance.
  private advance(now: number) {
    const dt = Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const dir = this.direction;
    if (dir !== 0) {
      this.setRaw(this.raw + dir * this.speed * (this.max - this.min) * dt);
    }
  }

  private tick = () => {
    this.frame = 0;
    if (this.direction === 0) return;
    // performance.now() rather than the frame timestamp, which can predate
    // the keydown that started the loop.
    this.advance(performance.now());
    this.frame = requestAnimationFrame(this.tick);
  };
}
