import type { RendererSetting } from "../renderer";

// How each "marks" setting is presented. Renderers keep their own values for
// these (in their settings.ts) but share the ranges and descriptions, so a
// setting means the same thing in every renderer that has it.
const MARK_SETTINGS = {
  verticality: {
    min: -1,
    max: 1,
    step: 0.01,
    tooltip:
      "How vertical the strokes are. -1/1 = vertical, 0 = horizontal, 0.5 = diagonal ↗, -0.5 = diagonal ↖.",
  },
  angleVariation: {
    min: 0,
    max: 100,
    step: 0.1,
    tooltip:
      "Random angular jitter (in degrees) added to each stroke's orientation.",
  },
  thickness: {
    min: 0,
    max: 0.1,
    step: 0.001,
    tooltip: "Base stroke line width (in normalized canvas units).",
  },
  thicknessVariation: {
    min: 0,
    max: 1,
    step: 0.01,
    tooltip:
      "Per-stroke random variation of thickness, as a fraction of the base thickness.",
  },
  linelength: {
    min: 0,
    max: 0.1,
    step: 0.001,
    tooltip: "Length of each curve stroke (in normalized canvas units).",
  },
  linelengthVariation: {
    min: 0,
    max: 1,
    step: 0.01,
    tooltip:
      "Per-stroke random variation of line length, as a fraction of the base length.",
  },
  uniformity: {
    min: 0,
    max: 1,
    step: 0.01,
    tooltip:
      "How uniform the curve shape is. 1 = clean, 0 = wild bezier control points.",
  },
  dilation: {
    min: 0,
    max: 1,
    step: 0.01,
    tooltip:
      "Expands each cell's clipping region outward, letting strokes spill across cell boundaries.",
  },
  multiplicity: {
    options: { "1": 1, "2": 2, "3": 3, "4": 4 },
    tooltip: "Number of parallel strokes drawn at each cluster position.",
  },
} satisfies Record<string, Omit<RendererSetting, "target" | "key">>;

export type MarkKey = keyof typeof MARK_SETTINGS;

/** Settings descriptions for the given marks of `target`, in the order given. */
export function markSettings<T extends Partial<Record<MarkKey, number>>>(
  target: T,
  keys: (MarkKey & keyof T)[],
): RendererSetting[] {
  return keys.map((key) => ({ target, key, ...MARK_SETTINGS[key] }));
}
