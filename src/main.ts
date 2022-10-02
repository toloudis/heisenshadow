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
import { params } from "./params";
import { VoronoiRadialRenderer } from "./voronoiRadialRenderer";

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
paper.setRenderer(voronoiRenderer);

//loadStrokeAssets(paper.ctx);

const pane = new Pane();
pane.registerPlugin(EssentialsPlugin);
pane.addButton({ title: "Voronoi" }).on("click", () => {
  params.mode = 1;
});
pane.addButton({ title: "Voronoi Radial" }).on("click", () => {
  params.mode = 0;
});
pane
  .addButton({
    title: "Clear",
  })
  .on("click", () => {
    paper.clear();
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
fAnimation.addInput(params, "speed", { min: 0.0, max: 10.0, step: 0.1 });
fAnimation.addInput(params, "clearInBetween").on("change", () => {
  paper.setAutoClear(params.clearInBetween);
});

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
fMarks.addInput(params, "dilation", {
  min: 0,
  max: 1,
  step: 0.01,
});

fMarks.addInput(params, "multiplicity", {
  options: {
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
  },
});
fMarks.addInput(params, "border", { min: 0, max: 0.2, step: 0.01 });

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
