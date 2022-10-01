import { Pane } from "tweakpane";
import * as EssentialsPlugin from "@tweakpane/plugin-essentials";
import { ButtonGridApi } from "@tweakpane/plugin-essentials/dist/types/button-grid/api/button-grid";

import { rand } from "./rand";
import {
  curvy2,
  loadStrokeAssets,
  setCurveSize,
  setCurveUniformity,
  strokeImage,
  triad,
} from "./strokes";

import "./style.css";
import { VoronoiDiagram, createVoronoiFromRandomPoints } from "./voronoi";

const params = {
  speed: 50,
  clearInBetween: true,
  thickness: 0.03,
  thicknessVariation: 0.0,
  uniformity: 0.7,
  verticality: 1.0,
  angleVariation: 8.0,
  isDrawing: false,
  canvasAspect: 8.5 / 11,
  strokeType: 0,
  multiplicity: 3,
  linelength: 0.03,
  linelengthVariation: 0.0,
  clusters: {
    size: 1,
    spread: 0.04,
  },
};
const nVoronoiCells = 1024;
let voronoi: VoronoiDiagram;

function setCanvasSize(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D
) {
  const windowAspect = window.innerWidth / window.innerHeight;
  let w = window.innerWidth;
  let h = window.innerHeight;
  if (params.canvasAspect > windowAspect) {
    canvas.width = w;
    h = w / params.canvasAspect;
    canvas.height = h;
  } else {
    canvas.height = h;
    w = h * params.canvasAspect;
    canvas.width = w;
  }
  // set coordinate system to 0,0-1,1
  context.setTransform(w, 0, 0, h, 0, 0);
  //context.scale(canvas.width, canvas.height);
  context.lineWidth = 0.001;

  // regenerate the voronoi cells
  voronoi = createVoronoiFromRandomPoints(1.0, 1.0, nVoronoiCells);
  //  voronoi = createVoronoiFromRandomPoints(w, h, nVoronoiCells);
}

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
ctx.lineJoin = ctx.lineCap = "round";
ctx.shadowBlur = 0; // 0.01;
ctx.shadowColor = "rgb(0, 0, 0)";
setCanvasSize(canvas, ctx);
window.addEventListener("resize", () => {
  setCanvasSize(canvas, ctx);
});
loadStrokeAssets(ctx);

function clear() {
  const oldFill = ctx.fillStyle;
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = oldFill;
}

const pane = new Pane();
pane.registerPlugin(EssentialsPlugin);
pane
  .addButton({
    title: "Pause/Play",
  })
  .on("click", () => {
    params.isDrawing = !params.isDrawing;
    if (params.isDrawing) {
      window.requestAnimationFrame(false ? render : render_radial);
      //window.requestAnimationFrame(render);
    }
  });
pane.addButton({ title: "Voronoi" }).on("click", () => {
  drawAllVoronoiCells();
});
pane.addButton({ title: "Voronoi Radial" }).on("click", () => {
  drawAllVoronoiCells_Radial(1.0);
});
pane
  .addButton({
    title: "Clear",
  })
  .on("click", () => {
    clear();

    // voronoi = createVoronoiFromRandomPoints(
    //   canvas.width,
    //   canvas.height,
    //   nVoronoiCells
    // );
    voronoi = createVoronoiFromRandomPoints(1.0, 1.0, nVoronoiCells);
  });

const fAnimation = pane.addFolder({ title: "Animation" });
fAnimation.addInput(params, "speed", { min: 0.0, max: 100.0, step: 1 });
fAnimation.addInput(params, "clearInBetween");

// line length variation
// stroke taper (-1..1)

const fMarks = pane.addFolder({
  title: "Marks",
});

fMarks.addInput(params, "verticality", {
  min: 0,
  max: 1,
  step: 0.01,
});
fMarks.addInput(params, "angleVariation", {
  min: 0,
  max: 100,
  step: 0.1,
});
fMarks.addInput(params, "thickness", {
  min: 0,
  max: 0.1,
  step: 0.001,
});
fMarks.addInput(params, "thicknessVariation", {
  min: 0,
  max: 1,
  step: 0.01,
});
fMarks
  .addInput(params, "linelength", {
    min: 0,
    max: 0.1,
    step: 0.001,
  })
  .on("change", () => {
    setCurveSize(0.03, params.linelength, 0.0, params.linelengthVariation);
  });
fMarks
  .addInput(params, "linelengthVariation", {
    min: 0,
    max: 1.0,
    step: 0.01,
  })
  .on("change", () => {
    setCurveSize(0.03, params.linelength, 0.0, params.linelengthVariation);
  });
fMarks
  .addInput(params, "uniformity", {
    min: 0,
    max: 1,
    step: 0.01,
  })
  .on("change", () => {
    setCurveUniformity(params.uniformity);
  });
// pane.addInput(params, "strokeType", {
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
fMarks.addInput(params, "multiplicity", {
  options: {
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
  },
});

const fClusters = pane.addFolder({
  title: "Clusters",
});
fClusters.addInput(params.clusters, "size", { min: 1, max: 100, step: 1 });
fClusters.addInput(params.clusters, "spread", { min: 0, max: 0.2, step: 0.01 });

pane.addButton({ title: "Save Settings" }).on("click", () => {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(
    new Blob([JSON.stringify(params, null, 2)], {
      type: "text/plain",
    })
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
      params.angleVariation = obj.angleVariation;
      params.clearInBetween = obj.clearInBetween;
      params.speed = obj.speed;
      params.clearInBetween = obj.clearInBetween;
      params.thickness = obj.thickness;
      params.thicknessVariation = obj.thicknessVariation;
      params.uniformity = obj.uniformity;
      params.verticality = obj.verticality;
      params.angleVariation = obj.angleVariation;
      params.isDrawing = obj.isDrawing;
      params.canvasAspect = obj.canvasAspect;
      params.strokeType = obj.strokeType;
      params.multiplicity = obj.multiplicity;
      params.linelength = obj.linelength;
      params.linelengthVariation = obj.linelengthVariation;
      params.clusters.size = obj.clusters.size;
      params.clusters.spread = obj.clusters.spread;
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

function drawAllVoronoiCells() {
  for (const cell of voronoi.cells) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cell.points[0][0], cell.points[0][1]);
    for (let i = 1; i < cell.points.length; i++) {
      ctx.lineTo(cell.points[i][0], cell.points[i][1]);
    }
    ctx.closePath();
    //ctx.stroke();
    ctx.clip();
    drawCluster(cell.centroid.x, cell.centroid.y);
    ctx.restore();
  }
}

function drawAllVoronoiCells_Radial(spiralness: number) {
  for (const cell of voronoi.cells) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cell.points[0][0], cell.points[0][1]);
    for (let i = 1; i < cell.points.length; i++) {
      ctx.lineTo(cell.points[i][0], cell.points[i][1]);
    }
    ctx.closePath();
    //ctx.stroke();
    ctx.clip();

    // look at centroid;
    // check radius from center of screen.
    const relativeCentroidX = cell.centroid.x - 0.5;
    const relativeCentroidY = cell.centroid.y - 0.5;
    const theta = Math.atan2(relativeCentroidY, relativeCentroidX);
    const r = Math.sqrt(
      relativeCentroidX * relativeCentroidX +
        relativeCentroidY * relativeCentroidY
    );
    //const spiralness = 1.0 / 0.2;
    const ang =
      ((theta + r * spiralness) / Math.PI) * 180.0 +
      rand(-params.angleVariation, params.angleVariation);

    const thickness =
      params.thickness +
      rand(
        -params.thicknessVariation * params.thickness,
        params.thicknessVariation * params.thickness
      );
    const linewidth = (r * thickness) / 10.0; //rand(0.01, 0.1);
    //(Math.cos(r * 4) * Math.cos(r * 4) * params.thickness) / 10.0; //rand(0.01, 0.1);

    drawClusterParams(cell.centroid.x, cell.centroid.y, ang, linewidth);
    ctx.restore();
  }
}

function drawClusterParams(
  x: number,
  y: number,
  ang: number,
  linewidth: number
) {
  const oldlw = ctx.lineWidth;

  ctx.translate(x, y);

  ctx.rotate((ang * Math.PI) / 180);
  ctx.lineWidth = linewidth;
  if (params.strokeType === 0) {
    ctx.lineWidth = linewidth;
    const triadspacing = 0.01;
    triad(ctx, params.multiplicity, curvy2, triadspacing, 0);
  } else {
    const oldAlpha = ctx.globalAlpha;
    ctx.globalAlpha = y + params.thickness;
    strokeImage(ctx, params.strokeType - 1);
    ctx.globalAlpha = oldAlpha;
  }
  ctx.rotate((-ang * Math.PI) / 180);
  ctx.translate(-x, -y);
  ctx.setTransform(canvas.width, 0, 0, canvas.height, 0, 0);
  // ctx.stroke();
  ctx.lineWidth = oldlw;
}

function drawCluster(x: number, y: number) {
  const ang =
    (1.0 - params.verticality) * 90.0 +
    rand(-params.angleVariation, params.angleVariation);

  const linewidth = (y * y * params.thickness) / 10.0; //rand(0.01, 0.1);
  drawClusterParams(x, y, ang, linewidth);
}

let lastx = 0;
let lasty = 0;
let clusteri = 0;
function render(_t: DOMHighResTimeStamp) {
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

  drawCluster(x, y);

  // draw all voronoi cells
  //drawAllVoronoiCells();

  if (params.isDrawing) {
    window.requestAnimationFrame(render);
  }
}

// stateful variables
let framenum = 0;
let framet = 0;
function render_radial(_t: DOMHighResTimeStamp) {
  // draw one of each bitmap stroke
  // for (let i = 0; i < 6; i++) {
  //   ctx.translate(i / 6.0, 0.2);
  //   strokeImage(ctx, i);
  //   ctx.translate(-i / 6.0, -0.2);
  // }

  if (params.clearInBetween) {
    clear();
  }
  framenum = framenum + 1;
  const delta = 0.001 * (params.speed + 1.0);
  framet = framet + delta;
  drawAllVoronoiCells_Radial(framet);
  framenum = framenum + 1;

  // draw all voronoi cells
  //drawAllVoronoiCells();

  if (params.isDrawing) {
    window.requestAnimationFrame(render_radial);
  }
}
