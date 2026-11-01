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
import { Animator } from "./animation";
import { Canvas } from "./canvas";
import { ControlConsole } from "./console";
import { GridRenderer } from "./gridRenderer";
import { setImageThicknessMapChangedCallback } from "./imageThicknessMap";
import {
  loadParamsFromObj,
  loadParamsFromSearchParams,
  params,
  writeParamsToSearchParams,
} from "./params";
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

// Load any params shared via the URL before anything reads them.
const initialSearch = new URLSearchParams(window.location.search);
loadParamsFromSearchParams(initialSearch);

const canvasElement = document.querySelector<HTMLCanvasElement>("#canvas");
if (!canvasElement) throw new Error("Canvas element not found");
const paper = new Canvas(canvasElement, params.canvasAspect);

// Paper shapes as portrait width / height (<= 1); the orientation dropdown
// flips them to landscape. All ISO A sizes (A3, A4, A5, ...) share the 1:√2
// ratio, so they are a single entry. Video ratios keep their usual names.
const PAPER_SIZES: Record<string, number> = {
  "A4 / A5 / A3": 1 / Math.SQRT2,
  Letter: 8.5 / 11,
  Legal: 8.5 / 14,
  Tabloid: 11 / 17,
  "1:1": 1,
  "4:3": 3 / 4,
  "3:2": 2 / 3,
  "16:9": 9 / 16,
};

// UI-only state for the paper dropdowns. params.canvasAspect remains the
// single persisted value; this is derived from it and written back to it.
const paperShape = { size: params.canvasAspect, orientation: "portrait" };
function syncPaperShapeFromParams() {
  const aspect = params.canvasAspect;
  const portrait = Math.min(aspect, 1 / aspect);
  paperShape.orientation = aspect > 1 ? "landscape" : "portrait";
  // Snap to a preset so the dropdown shows its name despite float rounding.
  paperShape.size =
    Object.values(PAPER_SIZES).find((v) => Math.abs(v - portrait) < 1e-9) ??
    portrait;
}

// The stroke settings the strokes module caches from params.
function applyStrokeSettings() {
  setCurveSize(0.03, params.linelength, 0.0, params.linelengthVariation);
  setCurveUniformity(params.uniformity);
}

// Push param values that live outside `params` into their consumers. Needed
// whenever params are replaced wholesale (URL on startup, Load Settings).
function applyParamSideEffects() {
  applyStrokeSettings();
  paper.setAutoClear(params.clearInBetween);
  paper.setPaperAspect(params.canvasAspect);
  syncPaperShapeFromParams();
}
applyParamSideEffects();

// ---- Animation channels -------------------------------------------------------
// Each channel moves one numeric param along a waveform. Params keep their base
// values (what the panes, URL and saved settings see); the animated values are
// swapped in only while each frame renders. The clock runs only during
// playback (at a rate set by speed) and on Step, so pausing freezes the
// animation. Console controls drive the
// channels' amplitude / frequency / enabled fields (see the console section).
const animator = new Animator(applyStrokeSettings);
// Playback speed scales animation time: 5 (the default) is real time, 10 is
// double speed, 0 freezes it.
const animationRate = () => params.speed / 5;
// Animation time one Step advances at speed 5 (about six frames of playback).
const STEP_SECONDS = 0.1;
paper.frameHooks = {
  before: () => {
    animator.tick(params.isDrawing, animationRate());
    animator.apply();
  },
  after: () => animator.restore(),
};

// Advance playback by one step and draw it. Shared by the pane's and the
// console's Step buttons. The voronoi renderers also advance their own state
// on each draw.
function stepFrame() {
  animator.advance(STEP_SECONDS * animationRate());
  paper.draw(1.0);
}
// Line length, for every mode: the voronoi modes use params.linelength, while
// grid mode scales strokes relative to their cell by params.grid.lineLength
// (above 1 they reach past the cell, clipped at the dilated cell edge).
const lineLengthWave = animator
  .channel({ waveform: "sine", frequency: 0.5 })
  .drive(params, "linelength", { depth: 0.03, min: 0 }) // ±0.03 at full amplitude
  .drive(params.grid, "lineLength", { depth: 0.5, min: 0 }); // ±50% at full amplitude

// The thickness image loads asynchronously; redraw when it arrives so a paused
// scene reflects it.
setImageThicknessMapChangedCallback(() => {
  if (!params.isDrawing) {
    paper.draw(0.0);
  }
});
const voronoiRenderer = new VoronoiRadialRenderer(paper);
const gridRenderer = new GridRenderer();

//loadStrokeAssets(paper.ctx);

// Two panes flank the canvas: actions on the left, parameters on the right.
function paneContainer(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Pane container ${selector} not found`);
  return el;
}
const leftPane = new Pane({ container: paneContainer("#left-panes") });
const rightPane = new Pane({ container: paneContainer("#right-panes") });
const panes = [leftPane, rightPane];
for (const p of panes) {
  p.registerPlugin(EssentialsPlugin);
}

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
        folder.addBinding(params.grid, "cellsAcross", {
          min: 2,
          max: 100,
          step: 1,
          label: "cells across",
        }),
        "Number of grid cells along the shorter side of the paper. The longer side gets proportionally more, so cells stay roughly square. Independent of screen or export resolution.",
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
      tip(
        folder.addBinding(params.grid, "patternVariation", {
          min: 0,
          max: 1,
          step: 0.01,
          label: "pattern var.",
        }),
        "Breaks up the regular diagonal angle pattern. Octagon-shaped patches of cells shift or mirror the angle cycle, and a few single cells change angle. 0 = perfectly regular.",
      );
      tip(
        folder.addBinding(params.grid, "lineLength", {
          min: 0,
          max: 2,
          step: 0.01,
          label: "line length",
        }),
        "Stroke length relative to the cell. 1 = strokes reach the cell edges. Above 1 they extend past the cell, visible as far as dilation allows.",
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

// Mirror the current view (mode + all params) into the URL so it can be
// bookmarked or shared. replaceState avoids flooding history on every tweak.
let activeModeId = DEFAULT_MODE_ID;
function syncUrl() {
  const search = new URLSearchParams();
  search.set("mode", activeModeId);
  writeParamsToSearchParams(search);
  const url = new URL(window.location.href);
  url.search = search.toString();
  window.history.replaceState(null, "", url);
}

function selectMode(mode: ModeDef, btnEl: HTMLElement) {
  paper.setRenderer(mode.activate());
  params.mode = mode.modeValue;
  setActiveRendererBtn(btnEl);
  setActiveSettingsFolder(mode.id);
  activeModeId = mode.id;
  syncUrl();
  // Refresh once so the new renderer's output is visible immediately,
  // even while paused. (Auto-clears if clearInBetween is on.)
  paper.draw(0);
}

const modeButtons = new Map<string, HTMLElement>();
for (const mode of MODES) {
  const btn = leftPane.addButton({ title: mode.title });
  btn.on("click", () => selectMode(mode, btn.element));
  modeButtons.set(mode.id, btn.element);
}

// Apply the initial mode from the URL, falling back to the default (drives
// initial renderer, params.mode, and highlight).
const initialMode =
  MODES.find((m) => m.id === initialSearch.get("mode")) ??
  MODES.find((m) => m.id === DEFAULT_MODE_ID);
if (initialMode) {
  const modeButton = modeButtons.get(initialMode.id);
  if (modeButton) {
    selectMode(initialMode, modeButton);
  }
}
leftPane
  .addButton({
    title: "Clear",
  })
  .on("click", () => {
    paper.clear();
    if (paper.getRenderer()) {
      paper.getRenderer()?.clear(null as unknown as CanvasRenderingContext2D);
    }
  });

// Start or stop the animation to match params.isDrawing. Shared by the pane's
// Pause/Play button and the console's play button.
function applyIsDrawing() {
  if (params.isDrawing) {
    paper.start();
  } else {
    paper.stop();
  }
}

const fAnimation = leftPane.addFolder({ title: "Animation" });
fAnimation
  .addButton({
    title: "Pause/Play",
  })
  .on("click", () => {
    params.isDrawing = !params.isDrawing;
    applyIsDrawing();
    // Light or unlight the console's play button.
    controlConsole.refresh();
  });
fAnimation
  .addButton({
    title: "Step",
  })
  .on("click", () => {
    stepFrame();
  });
const speedBinding = fAnimation.addBinding(params, "speed", {
  min: 0.0,
  max: 10.0,
  step: 0.1,
});
fAnimation.addBinding(params, "clearInBetween").on("change", () => {
  paper.setAutoClear(params.clearInBetween);
});

// line length variation
// stroke taper (-1..1)

function applyPaperShape() {
  params.canvasAspect =
    paperShape.orientation === "landscape"
      ? 1 / paperShape.size
      : paperShape.size;
  paper.setPaperAspect(params.canvasAspect);
}

const fPaper = rightPane.addFolder({
  title: "Paper",
});

const fMarks = rightPane.addFolder({
  title: "Marks",
});

// Create one settings folder per mode that defines a `settings` callback.
// Folders are positioned together here so they render consistently in the
// UI. Only the active mode's folder is visible (managed by selectMode).
for (const mode of MODES) {
  if (!mode.settings) continue;
  const folder = rightPane.addFolder({ title: `${mode.title} Settings` });
  mode.settings(folder);
  modeSettingsFolders.set(mode.id, folder);
}
// Re-apply visibility now that folders exist (initial mode was selected
// before its folder was created).
setActiveSettingsFolder(activeModeId);

tip(
  fPaper
    .addBinding(paperShape, "size", {
      label: "aspect ratio",
      options: PAPER_SIZES,
    })
    .on("change", applyPaperShape),
  "Shape of the paper. Combined with orientation to set the canvas aspect ratio.",
);
tip(
  fPaper
    .addBinding(paperShape, "orientation", {
      options: { Portrait: "portrait", Landscape: "landscape" },
    })
    .on("change", applyPaperShape),
  "Portrait (taller than wide) or landscape (wider than tall).",
);

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
const imageThicknessUrlBinding = tip(
  fMarks.addBinding(params, "imageThicknessUrl", {
    label: "thickness img url",
  }),
  "Image URL used to modulate thickness by HSV value (darker = thicker). Clear to disable image-driven thickness.",
);
addFilePickerButton(imageThicknessUrlBinding.element, "image/*");

// Adds a "..." button next to a text binding's input. Picking a local file puts
// a blob: URL into the input, which only stays valid for this page session.
function addFilePickerButton(bindingEl: HTMLElement, accept: string) {
  const valueEl = bindingEl.querySelector<HTMLElement>(".tp-lblv_v");
  const input = bindingEl.querySelector<HTMLInputElement>("input");
  if (!valueEl || !input) return;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = accept;
  fileInput.style.display = "none";

  const btn = document.createElement("button");
  btn.className = "tp-file-btn";
  btn.textContent = "...";
  btn.title = "Choose a local file";
  btn.addEventListener("click", () => fileInput.click());

  let blobUrl = "";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(file);
    // Go through the input's own change handling so Tweakpane updates the
    // param and fires its change events as if the url had been typed.
    input.value = blobUrl;
    input.dispatchEvent(new Event("change"));
    fileInput.value = "";
  });

  valueEl.classList.add("tp-file-row");
  valueEl.append(btn, fileInput);
}
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

leftPane.addButton({ title: "Save Settings" }).on("click", () => {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(
    new Blob([JSON.stringify(params, null, 2)], {
      type: "text/plain",
    }),
  );
  anchor.download = "settings.json";
  anchor.click();
});

leftPane.addButton({ title: "Load Settings" }).on("click", () => {
  const fileinput: HTMLInputElement = document.createElement("input");
  fileinput.type = "file";
  fileinput.style.display = "none";
  fileinput.addEventListener("change", (e: Event) => {
    const reader = new FileReader();
    reader.onload = (event: ProgressEvent<FileReader>) => {
      const obj = JSON.parse(event?.target?.result as string);
      loadParamsFromObj(obj);
      applyParamSideEffects();
      // update ui
      for (const p of panes) {
        p.refresh();
      }
      updateJpegQualityVisibility();
      syncUrl();
    };
    const files = (e.target as HTMLInputElement).files;
    if (files !== null) {
      reader.readAsText(files[0]);
    }
  });
  fileinput.click();
});

leftPane.addButton({ title: "Copy Link" }).on("click", () => {
  syncUrl();
  navigator.clipboard.writeText(window.location.href).catch((err) => {
    console.error("Failed to copy link", err);
  });
});

// ---- Export -----------------------------------------------------------------
const fExport = leftPane.addFolder({ title: "Export" });

// Bindings whose changes the pane change handler doesn't redraw for while
// paused. Export settings don't affect the drawing, and a redraw would
// re-randomize the picture about to be exported. Speed only matters during
// playback, so while paused changing it just stores the value.
const noRedrawBindings = new Set<unknown>([speedBinding]);

function exportSize(): { w: number; h: number } {
  const longEdge = Math.round(params.export.longEdge);
  const aspect = params.canvasAspect;
  return aspect >= 1
    ? { w: longEdge, h: Math.round(longEdge / aspect) }
    : { w: Math.round(longEdge * aspect), h: longEdge };
}

noRedrawBindings.add(
  tip(
    fExport
      .addBinding(params.export, "format", {
        options: { PNG: "png", JPEG: "jpeg" },
      })
      .on("change", () => updateJpegQualityVisibility()),
    "Image file format for export.",
  ),
);
noRedrawBindings.add(
  tip(
    fExport.addBinding(params.export, "longEdge", {
      min: 256,
      max: 16384,
      step: 1,
      label: "long edge (px)",
    }),
    "Pixels along the longer side of the exported image. The other side follows the paper aspect ratio.",
  ),
);
const jpegQualityBinding = tip(
  fExport.addBinding(params.export, "jpegQuality", {
    min: 0.5,
    max: 1,
    step: 0.01,
    label: "jpeg quality",
  }),
  "JPEG compression quality. 1 = best quality, largest file.",
);
noRedrawBindings.add(jpegQualityBinding);
function updateJpegQualityVisibility() {
  jpegQualityBinding.hidden = params.export.format !== "jpeg";
}
updateJpegQualityVisibility();

// The getter tracks the long edge and paper aspect ratio. Polling is off
// (interval 0): a read-only binding normally rewrites its field 5×/s, which
// makes the mouse cursor flicker everywhere on the page in Chrome on Windows.
// Instead it's refreshed from the pane change handler below.
const exportInfo = {
  get size() {
    const { w, h } = exportSize();
    return `${w} × ${h}`;
  },
};
const exportSizeBinding = fExport.addBinding(exportInfo, "size", {
  readonly: true,
  interval: 0,
});

const EXPORT_TITLE = "Export Image";
const exportButton = fExport.addButton({ title: EXPORT_TITLE });
tip(
  exportButton,
  "Redraws the current frame at the export resolution and downloads it.",
);
exportButton.on("click", async () => {
  const { w, h } = exportSize();
  const { format, jpegQuality } = params.export;
  exportButton.disabled = true;
  exportButton.title = "Exporting...";
  // Let the button label update before the (synchronous) high-res render.
  await new Promise((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 0)),
  );
  try {
    const blob = await paper.exportImage(
      w,
      h,
      `image/${format}`,
      format === "jpeg" ? jpegQuality : undefined,
    );
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `heisenshadow-${activeModeId}-${w}x${h}.${format === "jpeg" ? "jpg" : "png"}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    exportButton.title = EXPORT_TITLE;
  } catch (err) {
    // Usually the browser's canvas size limit.
    console.error("Export failed", err);
    exportButton.title = "Export failed (too large?)";
    setTimeout(() => {
      exportButton.title = EXPORT_TITLE;
    }, 3000);
  } finally {
    exportButton.disabled = false;
  }
});

// When any pane binding changes (slider, checkbox, etc.) keep the URL in sync,
// and while the animation is paused, redraw once so the change is visible
// immediately. Tweakpane fires this after the binding's own change handlers
// (setCurveSize, applyPaperShape, ...), so their side effects are applied.
for (const p of panes) {
  p.on("change", (ev) => {
    // Refreshing the read-only size line below fires this event too (always:
    // a monitor's value is a fresh buffer each time), so ignore it to avoid
    // infinite recursion.
    if (ev.target === exportSizeBinding) return;
    syncUrl();
    exportSizeBinding.refresh();
    // Keep console controls bound to the same params in step. (The console's
    // refresh fires no events, so this can't loop back here.)
    controlConsole.refresh();
    if (!params.isDrawing && !noRedrawBindings.has(ev.target)) {
      paper.draw(0.0);
    }
  });
}

// ---- Control console ----------------------------------------------------------
// Bottom panel of hold-to-move sliders, dials and buttons. The transport row
// (play, step, speed) drives the animation; the channels, grid and dials aren't
// wired to params yet. To hook one up, bind it like a Tweakpane binding, e.g.
//   strip.addSlider(params, "speed", { min: 0, max: 10, upKey: "q", downKey: "a" })
// or listen with slider.on("change", ...) / button.on("change", ...).
const controlConsole = new ControlConsole({
  container: paneContainer("#console-panel"),
});
// Left: master playback controls above the channel strips.
const mainColumn = controlConsole.addColumn();
const transport = mainColumn.addRow({ panel: true });
// Slightly smaller buttons keep the strips' sliders tall enough.
transport.element.style.setProperty("--cc-button-size", "40px");
// Play toggles params.isDrawing (lit while playing).
transport
  .addButton(params, "isDrawing", { label: "play" })
  .on("change", applyIsDrawing);
transport
  .addButton({ label: "step", mode: "continuous" })
  .on("press", stepFrame);
// Same range as the pane's speed slider. Refreshing that binding fires the
// pane change handler, which also syncs the URL.
transport
  .addSlider(params, "speed", {
    label: "speed",
    orientation: "horizontal",
    min: 0,
    max: 10,
    step: 0.1,
  })
  .on("change", () => speedBinding.refresh());
const channels = mainColumn.addRow({ grow: true });
const STRIP_KEYS = [
  { up: "q", down: "a", button: "z" },
  { up: "w", down: "s", button: "x" },
  { up: "e", down: "d", button: "c" },
  { up: "r", down: "f", button: "v" },
];
STRIP_KEYS.forEach((keys, i) => {
  channels.addSliderWithButton({
    label: `S${i + 1}`,
    upKey: keys.up,
    downKey: keys.down,
    value: 0.5,
    buttonLabel: `B${i + 1}`,
    buttonKey: keys.button,
  });
});
// Animation channel: the slider sets how far line length swings, and the gate
// switches the animation on and off (off = lines keep their base length).
channels
  .addSliderWithButton(lineLengthWave, "amplitude", {
    label: "length",
    upKey: "t",
    downKey: "g",
    gated: true,
    buttonKey: "b",
  })
  .on("enable", (on) => {
    lineLengthWave.enabled = on;
  });
// Right: the button grid with a row of dials underneath.
const gridColumn = controlConsole.addColumn();
const consoleGrid = gridColumn.addGrid({ columns: 2 });
for (let i = 0; i < 4; i++) {
  consoleGrid.addButton({ label: `G${i + 1}`, mode: "continuous" });
}
const dialRow = gridColumn.addRow({ panel: true });
dialRow.addDial({ label: "D1", upKey: "i", downKey: "k" });
dialRow.addDial({ label: "D2", upKey: "o", downKey: "l" });
