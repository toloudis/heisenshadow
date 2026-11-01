import { type Waveform, type WaveformName, waveforms } from "./waveforms";

// Keys of T whose values are numbers.
type NumberKeys<T> = {
  [K in keyof T]: T[K] extends number ? K : never;
}[keyof T] &
  string;

export type ChannelOptions = {
  /** A built-in waveform name or a custom function. Default `"sine"`. */
  waveform?: WaveformName | Waveform;
  /** Scales every driven parameter's `depth`; usually set by a slider. Default 0 (no motion). */
  amplitude?: number;
  /** Cycles per second of animation time. Default 0.5. */
  frequency?: number;
  /** Starting point in the cycle, in cycles (0.25 = a quarter cycle in). Default 0. */
  phase?: number;
  /** Whether the channel animates at all. Default true. */
  enabled?: boolean;
};

export type DriveOptions = {
  /** Offset from the base value at full amplitude, in this parameter's own units. */
  depth: number;
  /** Lowest value the animated parameter may take. Default: unclamped. */
  min?: number;
  /** Highest value the animated parameter may take. Default: unclamped. */
  max?: number;
};

type Drive = {
  target: Record<string, number>;
  key: string;
  depth: number;
  min: number;
  max: number;
};

/**
 * One animation: a waveform with an amplitude and frequency that drives one or
 * more numeric parameters, each offset from its base value by up to
 * `amplitude × depth`. Driving several parameters lets one idea ("line
 * length") reach renderers that store it differently.
 *
 * `amplitude`, `frequency` and `enabled` are plain fields, so console controls
 * can bind to them directly.
 */
export class AnimationChannel {
  amplitude: number;
  frequency: number;
  enabled: boolean;
  phase: number;
  waveform: Waveform;
  /** @internal The parameters this channel drives. */
  readonly drives: Drive[] = [];

  constructor(options: ChannelOptions = {}) {
    this.amplitude = options.amplitude ?? 0;
    this.frequency = options.frequency ?? 0.5;
    this.phase = options.phase ?? 0;
    this.enabled = options.enabled ?? true;
    const w = options.waveform ?? "sine";
    this.waveform = typeof w === "string" ? waveforms[w] : w;
  }

  /** Also animate the numeric property `key` of `target`. Returns the channel, for chaining. */
  drive<T extends object>(
    target: T,
    key: NumberKeys<T>,
    options: DriveOptions,
  ): this {
    this.drives.push({
      target: target as unknown as Record<string, number>,
      key,
      depth: options.depth,
      min: options.min ?? Number.NEGATIVE_INFINITY,
      max: options.max ?? Number.POSITIVE_INFINITY,
    });
    return this;
  }

  /** Whether the channel currently moves its parameters. */
  get active(): boolean {
    return this.enabled && this.amplitude !== 0 && this.drives.length > 0;
  }

  /** The waveform's value (-1 to 1) scaled by amplitude, at animation time `t` seconds. */
  level(t: number): number {
    return this.amplitude * this.waveform(this.frequency * t + this.phase);
  }
}

/**
 * Runs animation channels. Parameters keep their base values (what the panes,
 * URL and saved settings see); `apply()` swaps in the animated values just
 * for the duration of one frame and `restore()` puts the base values back.
 *
 * The clock only advances while playing, so pausing freezes every channel in
 * place and paused redraws show the same moment.
 */
export class Animator {
  private readonly channels: AnimationChannel[] = [];
  private readonly saved: {
    target: Record<string, number>;
    key: string;
    base: number;
  }[] = [];
  private time = 0;
  private lastNow: number | undefined;

  /**
   * @param onValuesChanged Called after values are applied and after they're
   *   restored, for parameters whose consumers cache them (e.g. stroke sizes).
   */
  constructor(private readonly onValuesChanged?: () => void) {}

  /** Create a channel. Add the parameters it animates with `.drive(...)`. */
  channel(options: ChannelOptions = {}): AnimationChannel {
    const channel = new AnimationChannel(options);
    this.channels.push(channel);
    return channel;
  }

  /** Animation time in seconds. */
  get seconds(): number {
    return this.time;
  }

  /**
   * Advance the clock by the real time since the last tick, times `rate`,
   * while `playing`; hold it while not. Call once per frame, before `apply()`.
   */
  tick(playing: boolean, rate = 1, now = performance.now()) {
    if (playing && this.lastNow !== undefined) {
      // Cap the step so a stalled tab doesn't jump the animation.
      this.time += Math.min(0.1, (now - this.lastNow) / 1000) * rate;
    }
    this.lastNow = playing ? now : undefined;
  }

  /** Move the clock forward by `seconds` of animation time, e.g. to step while paused. */
  advance(seconds: number) {
    this.time += seconds;
  }

  /** Swap in animated values. Must be paired with `restore()`. */
  apply() {
    for (const channel of this.channels) {
      if (!channel.active) continue;
      const level = channel.level(this.time);
      for (const d of channel.drives) {
        const base = d.target[d.key];
        this.saved.push({ target: d.target, key: d.key, base });
        // Channels on the same parameter stack: each offsets the previous result.
        d.target[d.key] = Math.min(
          d.max,
          Math.max(d.min, base + level * d.depth),
        );
      }
    }
    if (this.saved.length > 0) this.onValuesChanged?.();
  }

  /** Put back the base values replaced by `apply()`. */
  restore() {
    if (this.saved.length === 0) return;
    // Reverse order, so stacked channels unwind to the original base.
    for (let i = this.saved.length - 1; i >= 0; i--) {
      const { target, key, base } = this.saved[i];
      target[key] = base;
    }
    this.saved.length = 0;
    this.onValuesChanged?.();
  }
}
