import { Pane } from "tweakpane";
import * as EssentialsPlugin from "@tweakpane/plugin-essentials";

import { curvy1, straight, triad } from "./strokes";

import "./style.css";

const params = {
  range: { min: 16, max: 48 },
  width: 3,
  isDrawing: false,
  canvasAspect: 8.5 / 11,
};

function setCanvasSize(canvas: HTMLCanvasElement) {
  const windowAspect = window.innerWidth / window.innerHeight;
  if (params.canvasAspect > windowAspect) {
    canvas.width = window.innerWidth;
    canvas.height = canvas.width / params.canvasAspect;
  } else {
    canvas.height = window.innerHeight
    canvas.width = canvas.height * params.canvasAspect;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
setCanvasSize(canvas);
window.addEventListener("resize", () => {
  setCanvasSize(canvas);
});

// const canvas = document.createElement("canvas");
// canvas.width = window.innerWidth;
// canvas.height = window.innerHeight;
// // canvas.style.width = window.innerWidth;
// // canvas.style.height = window.innerHeight;
// app.appendChild(canvas);

// app.innerHTML = `
//   <h1>Hello Vite!</h1>
//   <a href="https://vitejs.dev/guide/features.html" target="_blank">Documentation</a>
// `

const pane = new Pane();
pane.registerPlugin(EssentialsPlugin);

pane.addInput(params, "range", {
  min: 0,
  max: 100,
  step: 1,
});
pane.addInput(params, "width", {
  min: 0,
  max: 7,
  step: 0.1,
});
const btn = pane.addButton({
  title: 'Pause/Play',
});
btn.on('click', () => {
  params.isDrawing = !params.isDrawing;
  if (params.isDrawing) {
    window.requestAnimationFrame(render);
  }
});

const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
ctx.lineWidth = 2;
ctx.lineJoin = ctx.lineCap = "round";
ctx.shadowBlur = 2;
ctx.shadowColor = "rgb(0, 0, 0)";

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function triple(
  px: number,
  py: number,
  angleDegrees: number,
  linewidth: number
) {
  ctx.lineWidth = linewidth;
  ctx.shadowBlur = linewidth + 2;
  ctx.shadowColor = "rgb(0, 0, 0)";

  let wiggle = rand(-3, 3);
  ctx?.rotate((angleDegrees * Math.PI) / 180);
  let x = px;
  let y = py;
  const separation = 40;
  let dx = 5 + wiggle;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - dx / 2, y - 10, x, y - 10);
  ctx.stroke();
  ctx.quadraticCurveTo(x + dx, y + 100, x, y + 100);
  ctx.stroke();
  ctx.quadraticCurveTo(x - dx / 2, y + 150, x, y + 150);
  ctx.stroke();
  ctx.quadraticCurveTo(x + dx / 4, y + 175, x, y + 175);
  ctx.stroke();

  x = x + separation;
  wiggle = rand(-4, 4);
  dx = 7 + wiggle;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - dx / 2, y - 10, x, y - 10);
  ctx.stroke();
  ctx.quadraticCurveTo(x + dx, y + 100, x, y + 100);
  ctx.stroke();
  ctx.quadraticCurveTo(x - dx / 2, y + 150, x, y + 150);
  ctx.stroke();
  ctx.quadraticCurveTo(x + dx / 4, y + 175, x, y + 175);
  ctx.stroke();

  x = x + separation;
  wiggle = rand(-5, 5);
  dx = 9 + wiggle;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - dx / 2, y - 10, x, y - 10);
  ctx.stroke();
  ctx.quadraticCurveTo(x + dx, y + 100, x, y + 100);
  ctx.stroke();
  ctx.quadraticCurveTo(x - dx / 2, y + 150, x, y + 150);
  ctx.stroke();
  ctx.quadraticCurveTo(x + dx / 4, y + 175, x, y + 175);
  ctx.stroke();

  // Reset transformation matrix to the identity matrix
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function render(t: DOMHighResTimeStamp) {
  //  for (let i = 0; i < 750; ++i) {
  // triple(
  //   Math.random() * canvas.width,
  //   Math.random() * canvas.height,
  //   Math.random() * 45,
  //   ((t % 1000) / 1000) * params.width
  // );


  ctx.translate(100, 100);
  ctx.scale(1, 50);
  straight(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.stroke();

  ctx.translate(200, 100);
  ctx.scale(50, 50);
  curvy1(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.stroke();

  ctx.translate(300, 100);
  ctx.scale(1, 50);
  triad(ctx, straight, 10, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.stroke();


  ctx.translate(400, 100);
  ctx.scale(10, 50);
  triad(ctx, curvy1, 10, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.stroke();

  //  }
  // triple(100, 100, 7);
  // //triple(110, 100);
  // triple(125, 100, 9);
  if (params.isDrawing) {
    window.requestAnimationFrame(render);
  }
}
