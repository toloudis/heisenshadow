import { registerParams } from "../../params";
import { type RendererSetting, setting } from "../../renderer";
import { markSettings } from "../marks";

/** The grid renderer's params: its own marks, then the grid layout. */
export const gridParams = registerParams("grid", {
  angleVariation: 8.0,
  thickness: 0.048,
  thicknessVariation: 0.0,
  linelengthVariation: 0.0,
  uniformity: 0.7,
  dilation: 0.0,
  multiplicity: 3,

  cellsAcross: 35, // cells along the shorter side of the paper
  verticalThickness: 0.0,
  orientationVariationProbability: 1 / 25,
  patternVariation: 0.0,
  lineLength: 1.0, // stroke length relative to the cell (1 = reaches the cell edges)
});

export function gridSettings(): RendererSetting[] {
  return [
    ...markSettings(gridParams, [
      "angleVariation",
      "thickness",
      "thicknessVariation",
      "linelengthVariation",
      "uniformity",
      "dilation",
      "multiplicity",
    ]),
    setting(gridParams, "cellsAcross", {
      min: 2,
      max: 100,
      step: 1,
      label: "cells across",
      tooltip:
        "Number of grid cells along the shorter side of the paper. The longer side gets proportionally more, so cells stay roughly square. Independent of screen or export resolution.",
    }),
    setting(gridParams, "verticalThickness", {
      min: 0,
      max: 1,
      step: 0.01,
      label: "vert. thickness",
      tooltip:
        "How much line thickness ramps from top (thin) to bottom (thick). 0 = uniform, 1 = full quadratic ramp.",
    }),
    setting(gridParams, "orientationVariationProbability", {
      min: 0,
      max: 0.5,
      step: 0.001,
      label: "orientation var.",
      tooltip:
        "Chance each cell deviates from the diagonal orientation pattern. Higher values allow more off-pattern cells.",
    }),
    setting(gridParams, "patternVariation", {
      min: 0,
      max: 1,
      step: 0.01,
      label: "pattern var.",
      tooltip:
        "Breaks up the regular diagonal angle pattern. Octagon-shaped patches of cells shift or mirror the angle cycle, and a few single cells change angle. 0 = perfectly regular.",
    }),
    setting(gridParams, "lineLength", {
      min: 0,
      max: 2,
      step: 0.01,
      label: "line length",
      tooltip:
        "Stroke length relative to the cell. 1 = strokes reach the cell edges. Above 1 they extend past the cell, visible as far as dilation allows.",
    }),
  ];
}
