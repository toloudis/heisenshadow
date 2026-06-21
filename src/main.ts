import * as EssentialsPlugin from "@tweakpane/plugin-essentials";
import type { FolderApi } from "tweakpane";
import { Pane } from "tweakpane";
//import { ButtonGridApi } from "@tweakpane/plugin-essentials/dist/types/button-grid/api/button-grid";

import {
  //loadStrokeAssets,
  setCurveSize,
  setCurveUniformity,
  //strokeImage,
} from "./strokes";

import "./style.css";
import { Canvas } from "./canvas";
import { GridRenderer } from "./gridRenderer";
import { loadParamsFromObj, params } from "./params";
import type { Renderer } from "./renderer";
import { VoronoiRadialRenderer } from "./voronoiRadialRenderer";
import { VoronoiRadialRendererRetained } from "./voronoiRadialRendererRetained";

/** BEGIN IFDEF
let lastx = 0;
let lasty = 0;
let clusteri = 0;
function render(ctx: CanvasRenderingContext2D, _t: DOMHighResTimeStamp) {
  // draw one of each bitmap stroke
  // for (let i = 0; i < 6; i++) {
  //   ctx.translate(i / 6.0, 0.2);
  //   strokeImage(ctx, i);
  //   ctx.translate(-i / 6.0, -0.2);
  // }

  let x = 0,
    y = 0;
  x = rand(0.02, 0.98);
  y = rand(0.02, 0.98);
  lastx = x;
  lasty = y;
  clusteri = clusteri + 1;

  drawCluster(ctx, x, y);

  // draw all voronoi cells
  //drawAllVoronoiCells();

  if (params.isDrawing) {
    window.requestAnimationFrame(render);
  }
}
END IFDEF */

const canvasElement = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvasElement) throw new Error("Canvas element not found");
const paper = new Canvas(canvasElement, params.canvasAspect);
const voronoiRenderer = new VoronoiRadialRenderer(paper);
const gridRenderer = new GridRenderer(paper);

//loadStrokeAssets(paper.ctx);

const pane = new Pane();
pane.registerPlugin(EssentialsPlugin);

// ---- Renderer modes: single source of truth -------------------------------
// Each entry describes a renderer button: its label, the legacy params.mode
// value (used internally by renderers that branch on it), and how to obtain
// the Renderer instance to activate. `settings`, if provided, populates a
// mode-specific folder in the UI that is only visible while that mode is
// active.
type ModeDef = {
  id: string;
  title: string;
  modeValue: number;
  activate: () => Renderer;
  settings?: (folder: FolderApi) => void;
};
const MODES: ModeDef[] = [
  {
    id: "voronoi",
    title: "Voronoi",
    modeValue: 1,
    activate: () => voronoiRenderer,
  },
  {
    id: "voronoi-radial",
    title: "Voronoi Radial",
    modeValue: 0,
    activate: () => voronoiRenderer,
    settings: (folder) => {
      tip(
        folder.addBinding(params.radialVoronoi, "center", {
          x: { min: -1, max: 1 },
          y: { min: -1, max: 1 },
        }),
        "Center point used to compute spiral angles.",
      );
    },
  },
  {
    id: "retained",
    title: "Retained",
    modeValue: 0,
    activate: () => new VoronoiRadialRendererRetained(paper),
  },
  {
    id: "grid",
    title: "Grid",
    modeValue: 2,
    activate: () => gridRenderer,
    settings: (folder) => {
      tip(
        folder.addBinding(params.grid, "cellPx", {
          min: 10,
          max: 200,
          step: 1,
          label: "cell size (px)",
        }),
        "Approximate size of each grid cell in pixels. The grid snaps to the drawable area.",
      );
      tip(
        folder.addBinding(params.grid, "verticalThickness", {
          min: 0,
          max: 1,
          step: 0.01,
          label: "vert. thickness",
        }),
        "How much line thickness ramps from top (thin) to bottom (thick). 0 = uniform, 1 = full quadratic ramp.",
      );
      tip(
        folder.addBinding(params.grid, "orientationVariationProbability", {
          min: 0,
          max: 0.5,
          step: 0.001,
          label: "orientation var.",
        }),
        "Chance each cell deviates from the diagonal orientation pattern. Higher values allow more off-pattern cells.",
      );
    },
  },
];
const DEFAULT_MODE_ID = "grid";

// helper: set a native HTML tooltip on a Tweakpane binding row
function tip<T extends { element: HTMLElement }>(binding: T, text: string): T {
  binding.element.title = text;
  return binding;
}

// Track which renderer button is currently active so we can highlight it.
let activeRendererBtnEl: HTMLElement | null = null;
function setActiveRendererBtn(el: HTMLElement) {
  if (activeRendererBtnEl) {
    activeRendererBtnEl.classList.remove("tp-btn-active");
  }
  activeRendererBtnEl = el;
  activeRendererBtnEl.classList.add("tp-btn-active");
}

// Per-mode settings folders, populated below. Only the active mode's folder
// is visible at a time.
const modeSettingsFolders = new Map<string, FolderApi>();
function setActiveSettingsFolder(modeId: string) {
  for (const [id, folder] of modeSettingsFolders) {
    folder.element.style.display = id === modeId ? "" : "none";
  }
}

function selectMode(mode: ModeDef, btnEl: HTMLElement) {
  paper.setRenderer(mode.activate());
  params.mode = mode.modeValue;
  setActiveRendererBtn(btnEl);
  setActiveSettingsFolder(mode.id);
  // Refresh once so the new renderer's output is visible immediately,
  // even while paused. (Auto-clears if clearInBetween is on.)
  paper.draw(0);
}

const modeButtons = new Map<string, HTMLElement>();
for (const mode of MODES) {
  const btn = pane.addButton({ title: mode.title });
  btn.on("click", () => selectMode(mode, btn.element));
  modeButtons.set(mode.id, btn.element);
}

// Apply the default mode (drives initial renderer, params.mode, and highlight).
const defaultMode = MODES.find((m) => m.id === DEFAULT_MODE_ID);
if (defaultMode) {
  const modeButton = modeButtons.get(DEFAULT_MODE_ID);
  if (modeButton) {
    selectMode(defaultMode, modeButton);
  }
}
pane
  .addButton({
    title: "Clear",
  })
  .on("click", () => {
    paper.clear();
    if (paper.getRenderer()) {
      paper.getRenderer()?.clear(null as unknown as CanvasRenderingContext2D);
    }
  });

const fAnimation = pane.addFolder({ title: "Animation" });
fAnimation
  .addButton({
    title: "Pause/Play",
  })
  .on("click", () => {
    params.isDrawing = !params.isDrawing;
    if (params.isDrawing) {
      paper.start();
    } else {
      paper.stop();
    }
  });
fAnimation
  .addButton({
    title: "Step",
  })
  .on("click", () => {
    paper.draw(1.0);
  });
fAnimation.addBinding(params, "speed", { min: 0.0, max: 10.0, step: 0.1 });
fAnimation.addBinding(params, "clearInBetween").on("change", () => {
  paper.setAutoClear(params.clearInBetween);
});

// line length variation
// stroke taper (-1..1)

const fPaper = pane.addFolder({
  title: "Paper",
});

const fMarks = pane.addFolder({
  title: "Marks",
});

// Create one settings folder per mode that defines a `settings` callback.
// Folders are positioned together here so they render consistently in the
// UI. Only the active mode's folder is visible (managed by selectMode).
for (const mode of MODES) {
  if (!mode.settings) continue;
  const folder = pane.addFolder({ title: `${mode.title} Settings` });
  mode.settings(folder);
  modeSettingsFolders.set(mode.id, folder);
}
// Re-apply visibility now that folders exist (default mode was selected
// before its folder was created).
setActiveSettingsFolder(DEFAULT_MODE_ID);

tip(
  fPaper.addBinding(params, "border", { min: 0, max: 0.2, step: 0.01 }),
  "Margin around the drawable area. Cells/clusters near the edge are skipped.",
);

tip(
  fMarks.addBinding(params, "verticality", {
    min: -1,
    max: 1,
    step: 0.01,
  }),
  "How vertical the strokes are. -1/1 = vertical, 0 = horizontal, 0.5 = diagonal ↗, -0.5 = diagonal ↖.",
);
tip(
  fMarks.addBinding(params, "angleVariation", {
    min: 0,
    max: 100,
    step: 0.1,
  }),
  "Random angular jitter (in degrees) added to each stroke's orientation.",
);
tip(
  fMarks.addBinding(params, "thickness", {
    min: 0,
    max: 0.1,
    step: 0.001,
  }),
  "Base stroke line width (in normalized canvas units).",
);
tip(
  fMarks.addBinding(params, "thicknessVariation", {
    min: 0,
    max: 1,
    step: 0.01,
  }),
  "Per-stroke random variation of thickness, as a fraction of the base thickness.",
);
tip(
  fMarks.addBinding(params, "imageThicknessEnabled", {
    label: "thickness img",
  }),
  "Toggle image-driven thickness modulation. When off, strokes ignore the thickness image.",
);
tip(
  fMarks.addBinding(params, "imageThicknessUrl", {
    label: "thickness img url",
  }),
  "Image URL used to modulate thickness by HSV value (darker = thicker). Clear to disable image-driven thickness.",
);
tip(
  fMarks
    .addBinding(params, "linelength", {
      min: 0,
      max: 0.1,
      step: 0.001,
    })
    .on("change", () => {
      setCurveSize(0.03, params.linelength, 0.0, params.linelengthVariation);
    }),
  "Length of each curve stroke (in normalized canvas units).",
);
tip(
  fMarks
    .addBinding(params, "linelengthVariation", {
      min: 0,
      max: 1.0,
      step: 0.01,
    })
    .on("change", () => {
      setCurveSize(0.03, params.linelength, 0.0, params.linelengthVariation);
    }),
  "Per-stroke random variation of line length, as a fraction of the base length.",
);
tip(
  fMarks
    .addBinding(params, "uniformity", {
      min: 0,
      max: 1,
      step: 0.01,
    })
    .on("change", () => {
      setCurveUniformity(params.uniformity);
    }),
  "How uniform the curve shape is. 1 = clean, 0 = wild bezier control points.",
);
// pane.addBinding(params, "strokeType", {
//   options: {
//     triLine: 0,
//     bitmap0: 1,
//     bitmap1: 2,
//     bitmap2: 3,
//     bitmap3: 4,
//     bitmap4: 5,
//     bitmap5: 6,
//   },
// });
tip(
  fMarks.addBinding(params, "dilation", {
    min: 0,
    max: 1,
    step: 0.01,
  }),
  "Expands each cell's clipping region outward, letting strokes spill across cell boundaries.",
);

tip(
  fMarks.addBinding(params, "multiplicity", {
    options: {
      "1": 1,
      "2": 2,
      "3": 3,
      "4": 4,
    },
  }),
  "Number of parallel strokes drawn at each cluster position.",
);

pane.addButton({ title: "Save Settings" }).on("click", () => {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(
    new Blob([JSON.stringify(params, null, 2)], {
      type: "text/plain",
    }),
  );
  anchor.download = "settings.json";
  anchor.click();
});

pane.addButton({ title: "Load Settings" }).on("click", () => {
  const fileinput: HTMLInputElement = document.createElement("input");
  fileinput.type = "file";
  fileinput.style.display = "none";
  fileinput.addEventListener("change", (e: Event) => {
    const reader = new FileReader();
    reader.onload = (event: ProgressEvent<FileReader>) => {
      const obj = JSON.parse(event?.target?.result as string);
      loadParamsFromObj(obj);
      // update ui
      pane.refresh();
    };
    const files = (e.target as HTMLInputElement).files;
    if (files !== null) {
      reader.readAsText(files[0]);
    }
  });
  fileinput.click();
});

// When any pane binding changes (slider, checkbox, etc.) while the animation
// is paused, redraw once so the change is visible immediately.
pane.on("change", () => {
  if (!params.isDrawing) {
    paper.draw(0.0);
  }
});
