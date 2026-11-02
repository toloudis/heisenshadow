import * as EssentialsPlugin from "@tweakpane/plugin-essentials";
import type { FolderApi } from "tweakpane";
import { Pane } from "tweakpane";
//import { ButtonGridApi } from "@tweakpane/plugin-essentials/dist/types/button-grid/api/button-grid";

//import { loadStrokeAssets, strokeImage } from "./strokes";

import "./style.css";
import { Animator } from "./animation";
import { Canvas } from "./canvas";
import { ControlConsole } from "./console";
import { setImageThicknessMapChangedCallback } from "./imageThicknessMap";
import {
  allParams,
  loadParamsFromObj,
  loadParamsFromSearchParams,
  params,
  writeParamsToSearchParams,
} from "./params";
import type { Renderer, RendererSetting } from "./renderer";
import { GridRenderer } from "./renderers/grid/gridRenderer";
import { gridParams } from "./renderers/grid/settings";
import { voronoiParams } from "./renderers/voronoi/settings";
import { VoronoiRadialRenderer } from "./renderers/voronoi/voronoiRadialRenderer";
import { VoronoiRadialRendererRetained } from "./renderers/voronoi/voronoiRadialRendererRetained";

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

// Push param values that live outside `params` into their consumers. Needed
// whenever params are replaced wholesale (URL on startup, Load Settings).
function applyParamSideEffects() {
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
const animator = new Animator();
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
// console's Step buttons. Renderers get the same slice of time as the
// animation clock, in the milliseconds a playing frame passes them (the
// voronoi renderers turn by an amount proportional to it, and apply speed
// themselves).
function stepFrame() {
  animator.advance(STEP_SECONDS * animationRate());
  paper.draw(STEP_SECONDS * 1000);
}
// Line length, for every mode: the voronoi renderers use their linelength,
// while the grid scales strokes relative to their cell by its lineLength
// (above 1 they reach past the cell, clipped at the dilated cell edge).
const lineLengthWave = animator
  .channel({ waveform: "sine", frequency: 0.5 })
  .drive(voronoiParams, "linelength", { depth: 0.03, min: 0 }) // ±0.03 at full amplitude
  .drive(gridParams, "lineLength", { depth: 0.5, min: 0 }); // ±50% at full amplitude

// The thickness image loads asynchronously; redraw when it arrives so a paused
// scene reflects it.
setImageThicknessMapChangedCallback(() => {
  if (!params.isDrawing) {
    paper.draw(0.0);
  }
});

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
// Each entry describes a renderer button: its label and how to create its
// Renderer. Every click creates a fresh instance, so modes never share state.
// A renderer's own settings panel comes from the renderer (see
// showRendererSettings).
type ModeDef = {
  id: string;
  title: string;
  create: () => Renderer;
};
const MODES: ModeDef[] = [
  {
    id: "voronoi",
    title: "Voronoi",
    create: () => new VoronoiRadialRenderer(paper, "plain"),
  },
  {
    id: "voronoi-radial",
    title: "Voronoi Radial",
    create: () => new VoronoiRadialRenderer(paper, "radial"),
  },
  {
    id: "retained",
    title: "Retained",
    create: () => new VoronoiRadialRendererRetained(paper),
  },
  {
    id: "grid",
    title: "Grid",
    create: () => new GridRenderer(),
  },
];
const DEFAULT_MODE_ID = "grid";

// helper: set a native HTML tooltip on a Tweakpane binding row
function tip<T extends { element: HTMLElement }>(binding: T, text?: string): T {
  if (text) binding.element.title = text;
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

// The active renderer's settings panel, rebuilt on every mode change from the
// settings the new renderer describes. It's appended to the right pane, after
// Paper and Marks.
let rendererSettingsFolder: FolderApi | undefined;
function showRendererSettings(renderer: Renderer, title: string) {
  rendererSettingsFolder?.dispose();
  rendererSettingsFolder = undefined;
  const settings = renderer.settings?.() ?? [];
  if (settings.length === 0) return;
  rendererSettingsFolder = rightPane.addFolder({ title: `${title} Settings` });
  for (const s of settings) {
    tip(addSettingBinding(rendererSettingsFolder, s), s.tooltip);
  }
}

// Turn a renderer's setting description into a Tweakpane binding. Number
// ranges apply to plain numbers, or to both axes of an {x, y} point.
function addSettingBinding(folder: FolderApi, s: RendererSetting) {
  const value = (s.target as Record<string, unknown>)[s.key];
  const isPoint =
    typeof value === "object" && value !== null && "x" in value && "y" in value;
  const range = definedOnly({ min: s.min, max: s.max });
  const options = isPoint
    ? { label: s.label, x: range, y: range }
    : s.options
      ? { label: s.label, options: s.options }
      : { label: s.label, ...range, ...definedOnly({ step: s.step }) };
  return folder.addBinding(
    s.target as Record<string, unknown>,
    s.key,
    definedOnly(options),
  );
}

// Drop undefined entries, so Tweakpane only sees options that were given.
function definedOnly<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
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
  const renderer = mode.create();
  paper.setRenderer(renderer);
  showRendererSettings(renderer, mode.title);
  setActiveRendererBtn(btnEl);
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

// The thickness image is shared by every renderer. Each renderer's own marks
// (thickness, dilation, ...) are in its settings panel.
const fImage = rightPane.addFolder({
  title: "Thickness Image",
});

// Apply the initial mode from the URL, falling back to the default (drives
// initial renderer, its settings panel, and highlight). Done after the fixed
// folders exist, so the renderer's settings folder lands after them.
const initialMode =
  MODES.find((m) => m.id === initialSearch.get("mode")) ??
  MODES.find((m) => m.id === DEFAULT_MODE_ID);
if (initialMode) {
  const modeButton = modeButtons.get(initialMode.id);
  if (modeButton) {
    selectMode(initialMode, modeButton);
  }
}

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
  fImage.addBinding(params, "imageThicknessEnabled", {
    label: "thickness img",
  }),
  "Toggle image-driven thickness modulation. When off, strokes ignore the thickness image.",
);
const imageThicknessUrlBinding = tip(
  fImage.addBinding(params, "imageThicknessUrl", {
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

leftPane.addButton({ title: "Save Settings" }).on("click", () => {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(
    new Blob([JSON.stringify(allParams(), null, 2)], {
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
// (applyPaperShape, ...), so their side effects are applied.
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
// Far right: a trackpad for the radial voronoi modes' spiral center. Same range
// and y direction as the pane's center control. Refreshing the settings panel
// fires the pane change handler (URL sync, redraw while paused) when center is
// shown there; other modes don't use center, so only the URL needs updating.
controlConsole
  .addColumn({ panel: true })
  .addTrackpad(voronoiParams, "center", { label: "center" })
  .on("change", () => {
    rendererSettingsFolder?.refresh();
    syncUrl();
  });
