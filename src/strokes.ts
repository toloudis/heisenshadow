export function straight(ctx:CanvasRenderingContext2D) {
    ctx.moveTo(0,-1);
    ctx.quadraticCurveTo(0, -1, 0, -0.333);
    ctx.quadraticCurveTo(0, -0.333, 0, 0.333);
    ctx.quadraticCurveTo(0, 0.333, 0, 1);
    ctx.quadraticCurveTo(0, 1, 0, 1);
    ctx.moveTo(0,0);
}

export function curvy1(ctx:CanvasRenderingContext2D) {
    ctx.moveTo(-0.25, -1);
    ctx.bezierCurveTo(0.25, -0.333, 0.25, 0.333, -0.25, 1);
    // ctx.quadraticCurveTo(-0.25, -1, 0.25, -0.333);
    // ctx.quadraticCurveTo(0.25, -0.333, 0.25, 0.333);
    // ctx.quadraticCurveTo(0.25, 0.333, -0.25, 1);
    // ctx.quadraticCurveTo(-0.25, 1, -0.25, 1);
    ctx.moveTo(0,0);
}

export function triad(ctx:CanvasRenderingContext2D, strokeFn:(ctx:CanvasRenderingContext2D)=>void, dx:number, dy:number) {
    // ctx.beginPath();
    ctx.translate(-dx, -dy);
    strokeFn(ctx);
    ctx.translate(dx, dy);
    strokeFn(ctx);
    ctx.translate(dx, dy);
    strokeFn(ctx);
    ctx.moveTo(0,0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
}