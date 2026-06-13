import { Pane } from "tweakpane";
import * as EssentialsPlugin from "@tweakpane/plugin-essentials";
//import { ButtonGridApi } from "@tweakpane/plugin-essentials/dist/types/button-grid/api/button-grid";

import {
  //loadStrokeAssets,
  setCurveSize,
  setCurveUniformity,
  //strokeImage,
} from "./strokes";

import "./style.css";
import { Canvas } from "./canvas";
import { loadParamsFromObj, params } from "./params";
import type { Renderer } from "./renderer";
import { VoronoiRadialRenderer } from "./voronoiRadialRenderer";
import { VoronoiRadialRendererRetained } from "./voronoiRadialRendererRetained";
import { GridRenderer } from "./gridRenderer";

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
  if (clusteri === 0) {
    x = rand(0.02, 0.98);
    y = rand(0.02, 0.98);
    lastx = x;
    lasty = y;
  } else {
    x = lastx + rand(-params.clusters.spread, params.clusters.spread);
    y = lasty + rand(-params.clusters.spread, params.clusters.spread);
  }
  clusteri = (clusteri + 1) % params.clusters.size;

  drawCluster(ctx, x, y);

  // draw all voronoi cells
  //drawAllVoronoiCells();

  if (params.isDrawing) {
    window.requestAnimationFrame(render);
  }
}
END IFDEF */

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const paper = new Canvas(canvas, params.canvasAspect);
const voronoiRenderer = new VoronoiRadialRenderer(paper);
const gridRenderer = new GridRenderer(paper);

//loadStrokeAssets(paper.ctx);

const pane = new Pane();
pane.registerPlugin(EssentialsPlugin);

// ---- Renderer modes: single source of truth -------------------------------
// Each entry describes a renderer button: its label, the legacy params.mode
// value (used internally by renderers that branch on it), and how to obtain
// the Renderer instance to activate.
type ModeDef = {
  id: string;
  title: string;
  modeValue: number;
  activate: () => Renderer;
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
  },
];
const DEFAULT_MODE_ID = "grid";

// Track which renderer button is currently active so we can highlight it.
let activeRendererBtnEl: HTMLElement | null = null;
function setActiveRendererBtn(el: HTMLElement) {
  if (activeRendererBtnEl) {
    activeRendererBtnEl.classList.remove("tp-btn-active");
  }
  activeRendererBtnEl = el;
  activeRendererBtnEl.classList.add("tp-btn-active");
}

function selectMode(mode: ModeDef, btnEl: HTMLElement) {
  paper.setRenderer(mode.activate());
  params.mode = mode.modeValue;
  setActiveRendererBtn(btnEl);
}

const modeButtons = new Map<string, HTMLElement>();
for (const mode of MODES) {
  const btn = pane.addButton({ title: mode.title });
  btn.on("click", () => selectMode(mode, btn.element));
  modeButtons.set(mode.id, btn.element);
}

// Apply the default mode (drives initial renderer, params.mode, and highlight).
const defaultMode = MODES.find((m) => m.id === DEFAULT_MODE_ID)!;
selectMode(defaultMode, modeButtons.get(DEFAULT_MODE_ID)!);
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

const fMarks = pane.addFolder({
  title: "Marks",
});

// helper: set a native HTML tooltip on a Tweakpane binding row
function tip<T extends { element: HTMLElement }>(binding: T, text: string): T {
  binding.element.title = text;
  return binding;
}

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
tip(
  fMarks.addBinding(params, "border", { min: 0, max: 0.2, step: 0.01 }),
  "Margin around the drawable area. Cells/clusters near the edge are skipped.",
);
tip(
  fMarks.addBinding(params.radialVoronoi, "center", {
    x: { min: -1, max: 1 },
    y: { min: -1, max: 1 },
  }),
  "Center point used by the Voronoi Radial mode to compute stroke angles.",
);
const fClusters = pane.addFolder({
  title: "Clusters",
});
fClusters.addBinding(params.clusters, "size", { min: 1, max: 100, step: 1 });
fClusters.addBinding(params.clusters, "spread", {
  min: 0,
  max: 0.2,
  step: 0.01,
});

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
