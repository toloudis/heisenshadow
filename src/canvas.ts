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
    this.glcanvas = canvas;
    //this.glcanvas = document.createElement("canvas");
    this.glctx = this.glcanvas.getContext("webgl")!;
    this.gltexture = this.glctx.createTexture()!;

    this.canvas = document.createElement("canvas");
    //this.canvas = canvas;
    this.ctx = this.canvas.getContext("2d")!;
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
    //this.glcanvas = document.createElement("canvas");
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


// For multiple octaves
#define NOISE fbm
#define NUM_NOISE_OCTAVES 5

// Precision-adjusted variations of https://www.shadertoy.com/view/4djSRW
float hash(float p) { p = fract(p * 0.011); p *= p + 7.5; p *= p + p; return fract(p); }
float hash(vec2 p) {vec3 p3 = fract(vec3(p.xyx) * 0.13); p3 += dot(p3, p3.yzx + 3.333); return fract((p3.x + p3.y) * p3.z); }

float noise(float x) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), u);
}

float noise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);

	// Four corners in 2D of a tile
	float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    // Simple 2D lerp using smoothstep envelope between the values.
	// return vec3(mix(mix(a, b, smoothstep(0.0, 1.0, f.x)),
	//			mix(c, d, smoothstep(0.0, 1.0, f.x)),
	//			smoothstep(0.0, 1.0, f.y)));

	// Same code, with the clamps in smoothstep and common subexpressions
	// optimized away.
    vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(float x) {
	float v = 0.0;
	float a = 0.5;
	float shift = float(100);
	for (int i = 0; i < NUM_NOISE_OCTAVES; ++i) {
		v += a * noise(x);
		x = x * 2.0 + shift;
		a *= 0.5;
	}
	return v;
}


float fbm(vec2 x) {
	float v = 0.0;
	float a = 0.5;
	vec2 shift = vec2(100);
	// Rotate to reduce axial bias
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
	for (int i = 0; i < NUM_NOISE_OCTAVES; ++i) {
		v += a * noise(x);
		x = rot * x * 2.0 + shift;
		a *= 0.5;
	}
	return v;
}
void make_kernel(inout vec4 n[9], sampler2D tex, vec2 coord)
{
	float w = 1.0 / imageSize.x;
	float h = 1.0 / imageSize.y;

	n[0] = texture2D(tex, coord + vec2( -w, -h));
	n[1] = texture2D(tex, coord + vec2(0.0, -h));
	n[2] = texture2D(tex, coord + vec2(  w, -h));
	n[3] = texture2D(tex, coord + vec2( -w, 0.0));
	n[4] = texture2D(tex, coord);
	n[5] = texture2D(tex, coord + vec2(  w, 0.0));
	n[6] = texture2D(tex, coord + vec2( -w, h));
	n[7] = texture2D(tex, coord + vec2(0.0, h));
	n[8] = texture2D(tex, coord + vec2(  w, h));
}
vec4 sobel(vec2 uv) {
	vec4 n[9];
	make_kernel( n, u_texture, uv );

	vec4 sobel_edge_h = n[2] + (2.0*n[5]) + n[8] - (n[0] + (2.0*n[3]) + n[6]);
  vec4 sobel_edge_v = n[0] + (2.0*n[1]) + n[2] - (n[6] + (2.0*n[7]) + n[8]);
	vec4 sobel = sqrt((sobel_edge_h * sobel_edge_h) + (sobel_edge_v * sobel_edge_v));
  return sobel;
}

void main() {
  vec2 position = vec2(v_coordinate.x, 1.0 - v_coordinate.y);
  vec2 onePixel = vec2(1, 1) / imageSize;
  vec4 color = vec4(0);
  mat3 kernel = mat3(
    0.11111, 0.11111, 0.11111,
    0.11111, 0.11111, 0.11111,
    0.11111, 0.11111, 0.11111
  );
  // implementing the convolution operation
  for(int i = 0; i < 3; i++) {
    for(int j = 0; j < 3; j++) {
      // retrieving the sample position pixel
      vec2 samplePosition = position + vec2((0.5)*float(i - 1) , (0.5)*float(j - 1)) * onePixel;
      // retrieving the sample color
      vec4 sampleColor = texture2D(u_texture, samplePosition);
      sampleColor *= kernel[i][j];
      color += sampleColor;
    }
  }
  color.a = 1.0;


  //vec2 coord = v_coordinate.xy * 1000.0;// * 0.1;
  //float v = NOISE(coord);
  float v = 1.0;

  vec4 sobel_val = sobel(v_coordinate.xy);
//  gl_FragColor = color*v*(1.0-sobel_val);
  gl_FragColor = 1.0-color*v*(sobel_val);
  gl_FragColor.a = 1.0;
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
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
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

    // render strokes into the canvas
    if (this.renderer) {
      this.renderer.render(this.ctx, dt);
    }
    // send canvas to gl and do gl filtering
    this.drawGL();
  }

  private animate(t: DOMHighResTimeStamp) {
    if (this.autoClear) {
      this.clear();
    }
    this.frameNum = this.frameNum + 1;
    const dt = t - this.lastTime;
    this.lastTime = t;

    // render strokes into the canvas
    if (this.renderer) {
      this.renderer.render(this.ctx, dt);
    }
    // send canvas to gl and do gl filtering
    this.drawGL();

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
    this.drawGL();
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
