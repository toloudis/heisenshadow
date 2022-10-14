import type { Renderer } from "./renderer";

export class Canvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private paperAspect: number;
  private isDrawing: boolean;
  private autoClear: boolean;
  private frameNum: number;
  private animationId: number;
  private renderer?: Renderer;
  private lastTime: DOMHighResTimeStamp;
  private isPainting: boolean;

  private glcanvas: HTMLCanvasElement;
  private glctx: WebGLRenderingContext;
  private gltexture: WebGLTexture;

  constructor(canvas: HTMLCanvasElement, paperAspect: number) {
    // TODO swap glcanvas and canvas
    this.glcanvas = document.createElement("canvas");
    this.glctx = this.glcanvas.getContext("webgl")!;
    this.gltexture = this.glctx.createTexture()!;

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.shadowBlur = 0; // 0.01;
    this.ctx.shadowColor = "rgb(0, 0, 0)";
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    //this.ctx.globalCompositeOperation = "destination-over";

    this.paperAspect = paperAspect;
    this.isDrawing = false;
    this.frameNum = 0;
    this.autoClear = true;
    this.animationId = 0;
    this.lastTime = 0;

    this.isPainting = false;

    this.setCanvasSize();
    window.addEventListener("resize", () => {
      this.setCanvasSize();
    });

    this.getCanvas().addEventListener(
      "pointerdown",
      this.pointerDown.bind(this)
    );

    this.getCanvas().addEventListener(
      "pointermove",
      this.pointerMove.bind(this)
    );

    this.getCanvas().addEventListener("pointerup", this.pointerUp.bind(this));
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
  private setCanvasSize() {
    const windowAspect = window.innerWidth / window.innerHeight;
    let w = window.innerWidth;
    let h = window.innerHeight;
    if (this.paperAspect > windowAspect) {
      this.canvas.width = w;
      h = w / this.paperAspect;
      this.canvas.height = h;
    } else {
      this.canvas.height = h;
      w = h * this.paperAspect;
      this.canvas.width = w;
    }
    // set coordinate system to 0,0-1,1
    this.ctx.setTransform(w, 0, 0, h, 0, 0);
    //context.scale(canvas.width, canvas.height);
    this.ctx.lineWidth = 0.001;
    //this.ctx.filter = "blur(0.5px)";
    this.ctx.shadowBlur = 0; // 0.01;
    this.ctx.shadowColor = "rgb(0, 0, 0)";
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    if (this.renderer) {
      this.renderer.resize(w, h);
    }

    // set up for quad post processing
    this.setupGL(w, h);
  }

  private compileShader(
    gl: WebGLRenderingContext,
    type: number,
    shaderSource: string
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) {
      return shader;
    }
    gl.shaderSource(shader, shaderSource);
    gl.compileShader(shader);

    const outcome = gl.getShaderParameter(shader, gl.COMPILE_STATUS);

    if (outcome === false) {
      // logging the error message on failure
      console.error(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
    }

    return shader;
  }

  private createProgram(
    gl: WebGLRenderingContext,
    vertexShader: WebGLShader,
    fragmentShader: WebGLShader
  ): WebGLProgram | null {
    const program = gl.createProgram();
    if (!program) {
      return program;
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    const outcome = gl.getProgramParameter(program, gl.LINK_STATUS);

    if (outcome === false) {
      // logging the error message on failure
      console.error(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
    }

    return program;
  }

  private setupGL(w: number, h: number) {
    this.glcanvas = document.createElement("canvas");
    this.glcanvas.width = w;
    this.glcanvas.height = h;
    this.glctx = this.glcanvas.getContext("webgl")!;

    const gl = this.glctx;

    // clearing the canvas
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const vertexShaderSource = `
attribute vec2 position;
varying vec2 v_coordinate;
void main() {
  gl_Position = vec4(position, 0, 1);
  v_coordinate = gl_Position.xy * 0.5 + 0.5;
}
`;

    const fragmentShaderSource = `
precision mediump float;
// the varible defined in the vertex shader above
varying vec2 v_coordinate;
uniform vec2 imageSize;
uniform sampler2D u_texture;

void main() {
  vec2 position = vec2(v_coordinate.x, 1.0 - v_coordinate.y);
  vec2 onePixel = vec2(1, 1) / imageSize;
  vec4 color = vec4(0);
  mat3 kernel = mat3(
    0.1, 0.1, 0.1,0.1, 0.1, 0.1,0.1, 0.1, 0.1
  );
  // implementing the convolution operation
  for(int i = 0; i < 3; i++) {
    for(int j = 0; j < 3; j++) {
      // retrieving the sample position pixel
      vec2 samplePosition = position + vec2(i - 1 , j - 1) * onePixel;
      // retrieving the sample color
      vec4 sampleColor = texture2D(u_texture, samplePosition);
      sampleColor *= kernel[i][j];
      color += sampleColor;
    }
  }
  color.a = 1.0;
  gl_FragColor = color;
}
`;

    const vertexShader = this.compileShader(
      gl,
      gl.VERTEX_SHADER,
      vertexShaderSource
    );
    const fragmentShader = this.compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentShaderSource
    );

    // iniziailing the program
    const program = this.createProgram(gl, vertexShader!, fragmentShader!);

    const positionAttributeLocation = gl.getAttribLocation(
      program!,
      "position"
    );

    const imageSizeLocation = gl.getUniformLocation(program!, "imageSize");

    // binding the position buffer to positionBuffer
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    // using the program defined above
    gl.useProgram(program);
    // enabling the texcoord attribute
    gl.enableVertexAttribArray(positionAttributeLocation);
    // setting up the size of the image
    gl.uniform2f(imageSizeLocation, this.canvas.width, this.canvas.height);
    // telling positionAttributeLocation how to retrieve data out of positionBuffer
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
    // provide the texture coordinates
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1, 1, -1, -1, 1]),
      gl.STATIC_DRAW
    );

    // loading the original image as a texture
    this.gltexture = gl.createTexture()!;

    gl.bindTexture(gl.TEXTURE_2D, this.gltexture);
    // setting the parameters to be able to render any image,
    // regardless of its size
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    // loading the original image as a texture
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.canvas
    );
  }

  private drawGL() {
    const gl = this.glctx;
    gl.bindTexture(gl.TEXTURE_2D, this.gltexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.canvas // this.ctx.getImageData(0,0,this.width(), this.height())
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  public draw(dt: number) {
    if (this.autoClear) {
      this.clear();
    }
    this.frameNum = this.frameNum + 1;
    if (this.renderer) {
      this.renderer.render(this.ctx, dt);
    }
    this.drawGL();
  }

  private animate(t: DOMHighResTimeStamp) {
    if (this.autoClear) {
      this.clear();
    }
    this.frameNum = this.frameNum + 1;
    const dt = t - this.lastTime;
    this.lastTime = t;

    if (this.renderer) {
      this.renderer.render(this.ctx, dt);
    }

    if (this.isDrawing) {
      this.animationId = window.requestAnimationFrame((t0) => this.animate(t0));
    }
  }

  public start() {
    this.lastTime = performance.now();
    this.isDrawing = true;
    this.animationId = window.requestAnimationFrame((t0) => this.animate(t0));
  }

  public stop() {
    this.isDrawing = false;
    window.cancelAnimationFrame(this.animationId);
  }

  public clear() {
    const oldFill = this.ctx.fillStyle;
    this.ctx.fillStyle = "rgba(255,255,255,1)";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = oldFill;
  }

  public getRenderer(): Renderer | undefined {
    return this.renderer;
  }
  public setRenderer(renderer: Renderer) {
    this.renderer = renderer;
  }
  public setAutoClear(autoClear: boolean) {
    this.autoClear = autoClear;
  }
  public width() {
    return this.canvas.width;
  }
  public height() {
    return this.canvas.height;
  }

  pointerDown(_e: PointerEvent) {
    this.isPainting = true;
  }
  pointerMove(_e: PointerEvent) {
    if (!this.isPainting) {
      return;
    }
    const addedStroke = this.renderer?.pointerMove(
      _e,
      _e.offsetX / this.canvas.width,
      _e.offsetY / this.canvas.height
    );
    // todo work out how many times to redraw
    if (addedStroke) window.requestAnimationFrame((t0) => this.animate(t0));
  }
  pointerUp(_e: PointerEvent) {
    this.isPainting = false;
  }
}
