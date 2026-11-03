// Temporary benchmark: run the app's renderers on either canvas 2D (as in
// main.ts) or WebGPU, animating continuously, and report frame timings.
//
// The page layout matches main.ts (pane columns and console panel around the
// canvas), so the canvas comes out the same size. Both backends draw at that
// size, in CSS pixels.
//
// For WebGPU, each frame the renderer draws into a RecordingContext, which
// captures every stroke as a cubic bezier in 0..1 paper coordinates along with
// its line width and clip polygon. The strokes are uploaded, a compute pass
// tessellates them into triangle strips, and a render pass draws one instance
// per stroke, clipping per sample against the stroke's polygon. That code is in
// renderers/webgpu/.
//
// The end cap demo that used to live here is now the Cap Demo renderer
// (renderers/capDemo/), selectable in main.ts.

import type { FolderApi } from "tweakpane";
import { Pane } from "tweakpane";

import "./style.css";
import { Animator } from "./animation";
import type { Paper } from "./paper";
import { loadParamsFromSearchParams, params } from "./params";
import { newRandomSeed, setRandomSeed } from "./rand";
import type { Renderer, RendererSetting } from "./renderer";
import { GridRenderer } from "./renderers/grid/gridRenderer";
import { gridParams } from "./renderers/grid/settings";
import { voronoiParams } from "./renderers/voronoi/settings";
import { VoronoiRadialRenderer } from "./renderers/voronoi/voronoiRadialRenderer";
import { VoronoiRadialRendererRetained } from "./renderers/voronoi/voronoiRadialRendererRetained";
import { GpuBackend } from "./renderers/webgpu/gpuBackend";
import { RecordingContext } from "./renderers/webgpu/recordingContext";

// ---- Page setup -------------------------------------------------------------

loadParamsFromSearchParams(new URLSearchParams(window.location.search));

function element<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`${selector} not found`);
  return el;
}

// The 2D canvas is the page's own #canvas. A canvas can only ever have one
// kind of context, so WebGPU gets a second one beside it, and only the
// active backend's canvas is shown.
const canvas2d = element<HTMLCanvasElement>("#canvas");
const canvasGpu = document.createElement("canvas");
canvasGpu.style.backgroundColor = "white";
canvas2d.after(canvasGpu);
const ctx2dOrNull = canvas2d.getContext("2d");
if (!ctx2dOrNull) throw new Error("Failed to get 2D context from canvas");
const ctx2d = ctx2dOrNull;

// Set in start(); null when WebGPU isn't available.
let gpu: GpuBackend | null = null;
const recorder = new RecordingContext();

// Same as setupContext in canvas.ts: 0..1 drawing coordinates and the stroke
// defaults the renderers rely on.
function setup2dContext(w: number, h: number) {
  ctx2d.setTransform(w, 0, 0, h, 0, 0);
  ctx2d.lineWidth = 0.001;
  ctx2d.shadowBlur = 0;
  ctx2d.shadowColor = "rgb(0, 0, 0)";
  ctx2d.lineCap = "round";
  ctx2d.lineJoin = "round";
}

// The voronoi renderers only ask their Canvas for its size.
const paperSize = {
  width: () => canvas2d.width,
  height: () => canvas2d.height,
} as unknown as Paper;

const MODES: Record<string, { title: string; create: () => Renderer }> = {
  voronoi: {
    title: "Voronoi",
    create: () => new VoronoiRadialRenderer(paperSize, "plain"),
  },
  "voronoi-radial": {
    title: "Voronoi Radial",
    create: () => new VoronoiRadialRenderer(paperSize, "radial"),
  },
  retained: {
    title: "Retained",
    create: () => new VoronoiRadialRendererRetained(paperSize),
  },
  grid: { title: "Grid", create: () => new GridRenderer() },
};

// Benchmark settings can also come from the URL (mode, backend, draws, wait),
// e.g. ?mode=voronoi&backend=canvas2d&draws=5&wait=1, for scripted runs.
const search = new URLSearchParams(window.location.search);
const urlMode = search.get("mode") ?? "";
const state = {
  mode: urlMode in MODES ? urlMode : "grid",
  backend: "canvas2d", // switched to "webgpu" in start() when available
  playing: true,
  // Draws per animation frame. Only the last is shown; raise it to measure
  // past the display's refresh rate.
  drawsPerFrame: Number(search.get("draws") ?? 1) || 1,
  // Wait for the GPU to finish each frame before timing it (canvas 2D: read
  // back a pixel), so frame time includes GPU work.
  waitForGpu: search.get("wait") === "1",
};
let renderer = MODES[state.mode].create();

/** The WebGPU backend when it's the active one. */
function activeGpu(): GpuBackend | null {
  return state.backend === "webgpu" ? gpu : null;
}

function showActiveCanvas() {
  const webgpu = activeGpu() !== null;
  canvas2d.style.display = webgpu ? "none" : "block";
  canvasGpu.style.display = webgpu ? "block" : "none";
}

// Fit both canvases to the container at the paper's aspect ratio, as
// Canvas.setCanvasSize does in main.ts.
function setCanvasSize() {
  const container = canvas2d.parentElement;
  const availW = container?.clientWidth ?? window.innerWidth;
  const availH = container?.clientHeight ?? window.innerHeight;
  let w = availW;
  let h = availH;
  if (params.canvasAspect > availW / availH) {
    h = w / params.canvasAspect;
  } else {
    w = h * params.canvasAspect;
  }
  w = Math.floor(w);
  h = Math.floor(h);
  if (w === canvas2d.width && h === canvas2d.height) return;
  for (const c of [canvas2d, canvasGpu]) {
    c.width = w;
    c.height = h;
  }
  setup2dContext(w, h);
  renderer.resize(w, h);
  if (!state.playing) drawFrame(0);
}

// ---- Animation --------------------------------------------------------------

// As in main.ts: line length can follow a sine wave. Its amplitude is
// exposed below so the grid, which is otherwise static, animates too.
const animator = new Animator();
const lineLengthWave = animator
  .channel({ waveform: "sine", frequency: 0.5, amplitude: 1 })
  .drive(voronoiParams, "linelength", { depth: 0.03, min: 0 })
  .drive(gridParams, "lineLength", { depth: 0.5, min: 0 });
// Thickness variation defaults to 0 and can't go below it, so this wave only
// rises: from the base value up by depth and back, (1 - cos) / 2 going 0..1.
// A different frequency from the length wave keeps the two out of step.
// (Voronoi's plain mode doesn't use thickness variation.)
const thicknessVariationWave = animator
  .channel({
    waveform: (p) => (1 - Math.cos(2 * Math.PI * p)) / 2,
    frequency: 0.3,
    amplitude: 1,
  })
  .drive(voronoiParams, "thicknessVariation", { depth: 1, min: 0, max: 1 })
  .drive(gridParams, "thicknessVariation", { depth: 1, min: 0, max: 1 });

// Draw one frame with the active backend, as Canvas.renderFrame does.
function drawOnce(dt: number) {
  setRandomSeed(newRandomSeed());
  animator.tick(state.playing, params.speed / 5);
  animator.apply();
  try {
    const g = activeGpu();
    if (g) {
      recorder.reset();
      renderer.render(recorder as unknown as CanvasRenderingContext2D, dt);
      g.draw(recorder);
    } else {
      const oldFill = ctx2d.fillStyle;
      ctx2d.fillStyle = "rgba(255,255,255,1)";
      ctx2d.fillRect(0, 0, canvas2d.width, canvas2d.height);
      ctx2d.fillStyle = oldFill;
      renderer.render(ctx2d, dt);
    }
  } finally {
    animator.restore();
  }
}

// Timing window, reported about once a second.
const stats = {
  windowStart: performance.now(),
  frames: 0,
  cpuSum: 0,
  cpuMax: 0,
  gpuSum: 0,
  gpuCount: 0,
};

async function drawFrame(dt: number) {
  const start = performance.now();
  const draws = Math.max(1, Math.round(state.drawsPerFrame));
  for (let i = 0; i < draws; i++) {
    drawOnce(dt / draws);
  }
  const g = activeGpu();
  if (g) {
    // How long after submitting the GPU finishes, measured without blocking.
    const submitted = performance.now();
    const done = g.whenIdle();
    done.then(() => {
      stats.gpuSum += performance.now() - submitted;
      stats.gpuCount++;
    });
    if (state.waitForGpu) await done;
  } else if (state.waitForGpu) {
    ctx2d.getImageData(0, 0, 1, 1);
  }
  const cpu = performance.now() - start;
  stats.frames++;
  stats.cpuSum += cpu;
  stats.cpuMax = Math.max(stats.cpuMax, cpu);
}

let lastT: number | undefined;
let rafId = 0;
async function animate(t: DOMHighResTimeStamp) {
  const dt = lastT === undefined ? 0 : t - lastT;
  lastT = t;
  await drawFrame(dt);
  reportStats();
  if (state.playing) rafId = requestAnimationFrame(animate);
}

function setPlaying(playing: boolean) {
  state.playing = playing;
  cancelAnimationFrame(rafId);
  lastT = undefined;
  if (playing) rafId = requestAnimationFrame(animate);
}

// ---- Panes ------------------------------------------------------------------

const leftPane = new Pane({ container: element("#left-panes") });
const rightPane = new Pane({ container: element("#right-panes") });

const statsEl = document.createElement("pre");
statsEl.style.cssText =
  "color: #ddd; font: 12px/1.5 monospace; margin: 8px 4px; white-space: pre-wrap;";
element("#left-panes").append(statsEl);

function reportStats() {
  const now = performance.now();
  const elapsed = now - stats.windowStart;
  if (elapsed < 1000 || stats.frames === 0) return;
  const g = activeGpu();
  const fps = (stats.frames * 1000) / elapsed;
  const lines = [
    `backend   ${g ? "WebGPU" : "canvas 2D"}`,
    `canvas    ${canvas2d.width} x ${canvas2d.height}`,
    `fps       ${fps.toFixed(1)}`,
    `frame     ${(elapsed / stats.frames).toFixed(2)} ms`,
    `cpu       ${(stats.cpuSum / stats.frames).toFixed(2)} ms avg, ${stats.cpuMax.toFixed(2)} max`,
  ];
  if (g) {
    const gpuMs = stats.gpuCount ? stats.gpuSum / stats.gpuCount : 0;
    lines.push(
      `gpu done  ${gpuMs.toFixed(2)} ms after submit`,
      `strokes   ${recorder.strokeCount} per draw`,
    );
  }
  if (!gpu) lines.push("", "WebGPU is not available in this browser.");
  statsEl.textContent = lines.join("\n");
  Object.assign(stats, {
    windowStart: now,
    frames: 0,
    cpuSum: 0,
    cpuMax: 0,
    gpuSum: 0,
    gpuCount: 0,
  });
}

function buildBenchmarkPane() {
  const fBench = leftPane.addFolder({ title: "Benchmark" });
  fBench
    .addBinding(state, "mode", {
      label: "renderer",
      options: Object.fromEntries(
        Object.entries(MODES).map(([id, m]) => [m.title, id]),
      ),
    })
    .on("change", () => {
      renderer = MODES[state.mode].create();
      renderer.resize(canvas2d.width, canvas2d.height);
      showRendererSettings();
    });
  fBench
    .addBinding(state, "backend", {
      options: gpu
        ? { "canvas 2D": "canvas2d", WebGPU: "webgpu" }
        : { "canvas 2D": "canvas2d" },
    })
    .on("change", showActiveCanvas);
  fBench
    .addBinding(state, "playing")
    .on("change", () => setPlaying(state.playing));
  fBench.addBinding(state, "drawsPerFrame", {
    label: "draws / frame",
    min: 1,
    max: 20,
    step: 1,
  });
  fBench.addBinding(state, "waitForGpu", { label: "wait for GPU" });
  fBench.addBinding(params, "speed", { min: 0, max: 10 });
  fBench.addBinding(lineLengthWave, "amplitude", {
    label: "length wave",
    min: 0,
    max: 1,
  });
  fBench.addBinding(thicknessVariationWave, "amplitude", {
    label: "thickness wave",
    min: 0,
    max: 1,
  });
}

// The active renderer's settings, as in main.ts.
let rendererSettingsFolder: FolderApi | undefined;
function showRendererSettings() {
  rendererSettingsFolder?.dispose();
  rendererSettingsFolder = undefined;
  const settings = renderer.settings?.() ?? [];
  if (settings.length === 0) return;
  rendererSettingsFolder = rightPane.addFolder({
    title: `${MODES[state.mode].title} Settings`,
  });
  for (const s of settings) {
    addSettingBinding(rendererSettingsFolder, s);
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
  const binding = folder.addBinding(
    s.target as Record<string, unknown>,
    s.key,
    definedOnly(options),
  );
  if (s.tooltip) binding.element.title = s.tooltip;
}

// Drop undefined entries, so Tweakpane only sees options that were given.
function definedOnly<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

// ---- Start ------------------------------------------------------------------

async function start() {
  gpu = await GpuBackend.create(canvasGpu);
  if (gpu && search.get("backend") !== "canvas2d") state.backend = "webgpu";
  showActiveCanvas();
  buildBenchmarkPane();
  showRendererSettings();
  // Redraw on any change while paused, so it shows.
  for (const p of [leftPane, rightPane]) {
    p.on("change", () => {
      if (!state.playing) drawFrame(0);
    });
  }
  setCanvasSize();
  const container = canvas2d.parentElement;
  if (container) new ResizeObserver(setCanvasSize).observe(container);
  setPlaying(true);
}

start();
