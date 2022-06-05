import { Pane } from "tweakpane";
import * as EssentialsPlugin from "@tweakpane/plugin-essentials";

import { rand } from "./rand";
import {
  curvy2,
  loadStrokeAssets,
  setCurveUniformity,
  strokeImage,
  triad,
} from "./strokes";

import "./style.css";

const params = {
  width: 0.03,
  uniformity: 0.7,
  angleVariation: 8.0,
  isDrawing: false,
  canvasAspect: 8.5 / 11,
  strokeType: 0,
};

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

const pane = new Pane();
pane.registerPlugin(EssentialsPlugin);

pane.addInput(params, "angleVariation", {
  min: 0,
  max: 100,
  step: 0.1,
});
pane.addInput(params, "width", {
  min: 0,
  max: 1,
  step: 0.001,
});
// .on("change", () => {
//   setCurveSize(params.width);
// });
pane
  .addInput(params, "uniformity", {
    min: 0,
    max: 1,
    step: 0.01,
  })
  .on("change", () => {
    setCurveUniformity(params.uniformity);
  });
pane.addInput(params, "strokeType", {
  options: {
    triLine: 0,
    bitmap0: 1,
    bitmap1: 2,
    bitmap2: 3,
    bitmap3: 4,
    bitmap4: 5,
    bitmap5: 6,
  },
});

pane
  .addButton({
    title: "Pause/Play",
  })
  .on("click", () => {
    params.isDrawing = !params.isDrawing;
    if (params.isDrawing) {
      window.requestAnimationFrame(render);
    }
  });

function render(_t: DOMHighResTimeStamp) {
  const oldlw = ctx.lineWidth;

  // draw one of each bitmap stroke
  // for (let i = 0; i < 6; i++) {
  //   ctx.translate(i / 6.0, 0.2);
  //   strokeImage(ctx, i);
  //   ctx.translate(-i / 6.0, -0.2);
  // }

  // ctx.translate(0.2, 0.2);
  // straight(ctx);
  // ctx.translate(-0.2, -0.2);
  // ctx.stroke();

  // ctx.translate(0.4, 0.2);
  // curvy1(ctx);
  // ctx.translate(-0.4, -0.2);
  // ctx.stroke();

  // ctx.translate(0.6, 0.2);
  // triad(ctx, straight, 0.02, 0);
  // ctx.translate(-0.6, -0.2);
  // ctx.setTransform(canvas.width, 0, 0, canvas.height, 0, 0);

  // ctx.translate(0.8, 0.2);
  // triad(ctx, curvy1, 0.02, 0);
  // ctx.translate(-0.8, -0.2);
  // ctx.setTransform(canvas.width, 0, 0, canvas.height, 0, 0);

  const x = rand(0.02, 0.98);
  const y = rand(0.02, 0.98);
  const ang = rand(-params.angleVariation, params.angleVariation);
  const linewidth = (y * params.width) / 10.0; //rand(0.01, 0.1);
  ctx.translate(x, y);
  ctx.rotate((ang * Math.PI) / 180);
  ctx.lineWidth = linewidth;
  if (params.strokeType === 0) {
    ctx.lineWidth = linewidth;
    triad(ctx, curvy2, 0.01, 0);
  } else {
    const oldAlpha = ctx.globalAlpha;
    ctx.globalAlpha = y + params.width;
    strokeImage(ctx, params.strokeType - 1);
    ctx.globalAlpha = oldAlpha;
  }
  ctx.rotate((-ang * Math.PI) / 180);
  ctx.translate(-x, -y);
  ctx.setTransform(canvas.width, 0, 0, canvas.height, 0, 0);
  // ctx.stroke();
  ctx.lineWidth = oldlw;

  if (params.isDrawing) {
    window.requestAnimationFrame(render);
  }
}
