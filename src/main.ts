import './style.css'

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
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

const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

ctx.lineWidth = 5;
ctx.lineJoin = ctx.lineCap = 'round';
ctx.shadowBlur = 5;
ctx.shadowColor = 'rgb(0, 0, 0)';

function triple(px:number, py:number, angleDegrees:number) {
  ctx?.rotate(angleDegrees * Math.PI / 180);
  let x = px;
  let y = py;
  const separation = 40;
  let dx = 5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x-dx/2, y-10, x, y-10);
  ctx.stroke();
  ctx.quadraticCurveTo(x+dx, y+100, x, y+100);
  ctx.stroke();
  ctx.quadraticCurveTo(x-dx/2, y+150, x, y+150);
  ctx.stroke();
  ctx.quadraticCurveTo(x+dx/4, y+175, x, y+175);
  ctx.stroke();
  
  x = x + separation;
  dx = 7;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x-dx/2, y-10, x, y-10);
  ctx.stroke();
  ctx.quadraticCurveTo(x+dx, y+100, x, y+100);
  ctx.stroke();
  ctx.quadraticCurveTo(x-dx/2, y+150, x, y+150);
  ctx.stroke();
  ctx.quadraticCurveTo(x+dx/4, y+175, x, y+175);
  ctx.stroke();  

  x = x + separation;
  dx = 9;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x-dx/2, y-10, x, y-10);
  ctx.stroke();
  ctx.quadraticCurveTo(x+dx, y+100, x, y+100);
  ctx.stroke();
  ctx.quadraticCurveTo(x-dx/2, y+150, x, y+150);
  ctx.stroke();
  ctx.quadraticCurveTo(x+dx/4, y+175, x, y+175);
  ctx.stroke();  

  // Reset transformation matrix to the identity matrix
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

for (let i = 0; i < 1000; ++i) {
  triple(Math.random() * canvas.width, Math.random() * canvas.height, Math.random() * 45);  
}
// triple(100, 100, 7);
// //triple(110, 100);
// triple(125, 100, 9);
