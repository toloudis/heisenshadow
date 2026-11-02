// Benchmark the canvas 2D and WebGPU backends of src/main2.ts in real Chrome.
//
// Starts a Vite dev server, opens a visible Chrome window (so the real GPU and
// compositor are used), loads main2.ts with each renderer / backend /
// setting combination from the URL, and reads the page's stats readout.
// main2.ts must be the page's entry script (index.html).
//
//   pnpm bench                  every renderer, both backends, with vsync
//   pnpm bench --uncapped       vsync and the frame rate limit off
//   pnpm bench smoke            a few quick runs, with screenshots
//
// Options:
//   --configs=a,b   settings per run, as URL query strings
//                   (default "draws=1&wait=0,draws=1&wait=1")
//   --extra=...     appended to every run's URL, e.g. "&grid.cellsAcross=100"
//   --modes=a,b     renderers to run (default all)
//   --seconds=N     samples to take per run, one per second (default 6)
//
// Results are printed as JSON lines and a table, and saved to bench-results/.
// Set CHROME_PATH if Chrome isn't installed in the default Windows location.

import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ??
  fallback;
const smoke = args.includes("smoke");
const uncapped = args.includes("--uncapped");
const configs = option("configs", "draws=1&wait=0,draws=1&wait=1").split(",");
const extra = option("extra", "");
const modes = option("modes", "grid,voronoi,voronoi-radial,retained").split(
  ",",
);
const seconds = Number(option("seconds", "6"));
const chromePath =
  process.env.CHROME_PATH ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const PORT = 5199;
const server = await createServer({
  server: { port: PORT, strictPort: true },
  logLevel: "warn",
});
await server.listen();

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    // Without these, frames can't come faster than the display refreshes.
    ...(uncapped ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : []),
  ],
});
// At this viewport, main.ts's layout gives a 633 x 820 canvas.
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = new Set();
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.add(m.text());
});
page.on("pageerror", (e) => errors.add(String(e)));

// Parse the stats readout (see reportStats in main2.ts).
function parse(text) {
  const num = (re) => Number(text.match(re)?.[1] ?? Number.NaN);
  return {
    backend: text.match(/backend\s+(.+)/)?.[1],
    canvas: text.match(/canvas\s+(\d+ x \d+)/)?.[1],
    frame: num(/frame\s+([\d.]+)/),
    cpu: num(/cpu\s+([\d.]+) ms avg/),
    cpuMax: num(/avg, ([\d.]+) max/),
    gpu: num(/gpu done\s+([\d.]+)/),
    strokes: num(/strokes\s+(\d+)/),
  };
}

function median(xs) {
  const s = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}

// Load one configuration, warm up, then take the median of the once-a-second
// stats reports.
async function run(query) {
  await page.goto(`http://localhost:${PORT}/?${query}`);
  const stats = page.locator("pre");
  await page.waitForFunction(
    () => /frame/.test(document.querySelector("pre")?.textContent ?? ""),
    null,
    { timeout: 20000 },
  );
  await page.waitForTimeout(1500);
  const samples = [];
  let last = "";
  for (let i = 0; i < seconds * 8 && samples.length < seconds; i++) {
    await page.waitForTimeout(250);
    const text = await stats.textContent();
    if (text && text !== last) {
      samples.push(parse(text));
      last = text;
    }
  }
  const result = {
    query,
    backend: samples[0]?.backend,
    canvas: samples[0]?.canvas,
  };
  for (const k of ["frame", "cpu", "cpuMax", "gpu", "strokes"]) {
    result[k] = median(samples.map((s) => s[k]));
  }
  console.log(JSON.stringify(result));
  return result;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = `bench-results/${stamp}${uncapped ? "-uncapped" : ""}`;
mkdirSync(outDir, { recursive: true });

const results = [];
try {
  if (smoke) {
    for (const q of [
      "mode=grid&backend=webgpu",
      "mode=voronoi-radial&backend=webgpu",
      "mode=voronoi-radial&backend=canvas2d",
    ]) {
      results.push(await run(q));
      await page.screenshot({
        path: `${outDir}/${q.replace(/[&=]/g, "_")}.png`,
      });
    }
  } else {
    for (const mode of modes) {
      for (const cfg of configs) {
        for (const backend of ["canvas2d", "webgpu"]) {
          results.push(
            await run(`mode=${mode}&backend=${backend}&${cfg}${extra}`),
          );
        }
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}

const fmt = (x, digits = 1) => (x === null ? "" : x.toFixed(digits));
const table = [
  "| run | backend | frame ms | cpu ms (avg / max) | gpu done ms | strokes |",
  "|---|---|---|---|---|---|",
  ...results.map(
    (r) =>
      `| ${r.query.replace(/&?backend=[^&]+/, "")} | ${r.backend} | ${fmt(r.frame, 2)} | ${fmt(r.cpu, 2)} / ${fmt(r.cpuMax, 1)} | ${fmt(r.gpu, 2)} | ${r.strokes ?? ""} |`,
  ),
].join("\n");
console.log(`\n${table}\n`);
if (errors.size) console.log("Console errors/warnings:", [...errors]);

writeFileSync(
  `${outDir}/results.json`,
  JSON.stringify({ args, uncapped, results, errors: [...errors] }, null, 2),
);
writeFileSync(`${outDir}/results.md`, `${table}\n`);
console.log(`Saved to ${outDir}/`);
