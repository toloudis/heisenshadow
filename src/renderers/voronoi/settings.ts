import { registerParams } from "../../params";
import { type RendererSetting, setting } from "../../renderer";
import { setCurveSize, setCurveUniformity } from "../../strokes";
import { type MarkKey, markSettings } from "../marks";

/**
 * Params shared by the voronoi renderers (Voronoi, Voronoi Radial, Retained):
 * their marks, and the center the radial modes spiral around.
 */
export const voronoiParams = registerParams("voronoi", {
  verticality: 1.0,
  angleVariation: 8.0,
  thickness: 0.048,
  thicknessVariation: 0.0,
  linelength: 0.03,
  linelengthVariation: 0.0,
  uniformity: 0.7,
  dilation: 0.0,
  multiplicity: 3,

  center: { x: 0.0, y: 0.0 },
});

export type VoronoiVariant = "plain" | "radial" | "retained";

/** The settings each voronoi variant actually uses. */
export function voronoiSettings(variant: VoronoiVariant): RendererSetting[] {
  const marks: MarkKey[] = [];
  if (variant !== "radial") marks.push("verticality");
  marks.push("angleVariation", "thickness");
  if (variant !== "plain") marks.push("thicknessVariation");
  marks.push(
    "linelength",
    "linelengthVariation",
    "uniformity",
    "dilation",
    "multiplicity",
  );
  const settings = markSettings(voronoiParams, marks);
  if (variant !== "plain") {
    settings.push(
      setting(voronoiParams, "center", {
        min: -1,
        max: 1,
        tooltip: "Center point used to compute spiral angles.",
      }),
    );
  }
  return settings;
}

/**
 * Push the voronoi line length and curve uniformity into the strokes module,
 * which draws (and builds strokes) from its own copy. Call right before
 * drawing or building strokes, so animated values take effect.
 */
export function applyVoronoiStrokeSettings() {
  setCurveSize(
    0.03,
    voronoiParams.linelength,
    0.0,
    voronoiParams.linelengthVariation,
  );
  setCurveUniformity(voronoiParams.uniformity);
}
