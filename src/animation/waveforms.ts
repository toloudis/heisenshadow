/**
 * A periodic shape. Takes a phase in cycles (any real number; one cycle per
 * unit) and returns a value from -1 to 1.
 */
export type Waveform = (phase: number) => number;

const frac = (x: number) => x - Math.floor(x);

/**
 * Built-in waveforms. All start at 0 and rise at phase 0, so they can be
 * swapped for one another without jumping (except square, which can't).
 */
export const waveforms = {
  sine: (p) => Math.sin(2 * Math.PI * p),
  triangle: (p) => 1 - 4 * Math.abs(frac(p + 0.25) - 0.5),
  saw: (p) => 2 * frac(p + 0.5) - 1,
  square: (p) => (frac(p) < 0.5 ? 1 : -1),
} satisfies Record<string, Waveform>;

export type WaveformName = keyof typeof waveforms;
