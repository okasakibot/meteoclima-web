import { GOES_CHANNELS_CFG as CHANNELS_CFG } from "./config.js";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const latToMercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * DEG2RAD) / 2));
const mercYToLat = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * RAD2DEG;

const VERT_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform vec4 uDomainBox; // (lonMin, lonMax, latMin, latMax) del dominio completo
uniform float uFeather;  // Grados de difuminado en el borde (0.0 para SA, 0.8 para Perú)
uniform sampler2D uDataTex;
uniform sampler2D uLutTex;
uniform vec2 uDataSize;
uniform vec4 uViewBox; // (lonMin, lonMax, mercMin, mercMax)
uniform vec4 uDataBox; // (lonMin, lonMax, latMin, latMax)
uniform vec2 uValRange; // (vmin, vmax)
uniform float uOpacity;

in vec2 vUv;
out vec4 fragColor;

const float RAD2DEG = 57.29577951308232;
const float PI_HALF = 1.5707963267948966;

float cubic(float p0, float p1, float p2, float p3, float t) {
  if (isnan(p1) || isnan(p2)) return p1;
  if (isnan(p0)) p0 = p1;
  if (isnan(p3)) p3 = p2;
  float a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
  float b = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
  float c = -0.5 * p0 + 0.5 * p2;
  return ((a * t + b) * t + c) * t + p1;
}

float sampleData(int x, int y) {
  int cx = clamp(x, 0, int(uDataSize.x) - 1);
  int cy = clamp(y, 0, int(uDataSize.y) - 1);
  return texelFetch(uDataTex, ivec2(cx, cy), 0).r;
}

void main() {
  float lon = mix(uViewBox.x, uViewBox.y, vUv.x);
  float mercY = mix(uViewBox.z, uViewBox.w, vUv.y);
  float lat = (2.0 * atan(exp(mercY)) - PI_HALF) * RAD2DEG;

  if (lon < uDataBox.x || lon > uDataBox.y || lat < uDataBox.z || lat > uDataBox.w) {
    discard;
  }

  float fx = ((lon - uDataBox.x) / (uDataBox.y - uDataBox.x)) * (uDataSize.x - 1.0);
  float fy = ((lat - uDataBox.z) / (uDataBox.w - uDataBox.z)) * (uDataSize.y - 1.0);

  int ix = int(floor(fx));
  int iy = int(floor(fy));
  float tx = fx - float(ix);
  float ty = fy - float(iy);

  // Interpolación bicúbica Catmull-Rom 4x4 sobre temperaturas crudas (bordes curvilíneos)
  float rows[4];
  for (int j = -1; j <= 2; j++) {
    rows[j + 1] = cubic(
      sampleData(ix - 1, iy + j),
      sampleData(ix,     iy + j),
      sampleData(ix + 1, iy + j),
      sampleData(ix + 2, iy + j),
      tx
    );
  }
  float val = cubic(rows[0], rows[1], rows[2], rows[3], ty);
  if (isnan(val)) discard;

  float norm = clamp((val - uValRange.x) / (uValRange.y - uValRange.x), 0.0, 1.0);
  vec3 rgb = texture(uLutTex, vec2(norm, 0.5)).rgb;

  float alpha = uOpacity;
  if (uFeather > 0.0) {
    float dx = min(lon - uDomainBox.x, uDomainBox.y - lon);
    float dy = min(lat - uDomainBox.z, uDomainBox.w - lat);
    float edgeDist = min(dx, dy);
    alpha *= smoothstep(0.0, uFeather, edgeDist);
  }
  fragColor = vec4(rgb, alpha);
}`;

export class SatelliteRenderer {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.gl = this._initWebGL2();
    this.mode = this.gl ? "GPU (WebGL2)" : "CPU (Canvas 2D)";
    if (!this.gl) {
      this.ctx2d = this.canvas.getContext("2d");
    }
  }

  _initWebGL2() {
    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    if (!gl) return null;

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn("WebGL2 shader error:", gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;

    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this._prog = prog;
    this._u = {
      dataTex: gl.getUniformLocation(prog, "uDataTex"),
      lutTex: gl.getUniformLocation(prog, "uLutTex"),
      dataSize: gl.getUniformLocation(prog, "uDataSize"),
      viewBox: gl.getUniformLocation(prog, "uViewBox"),
      dataBox: gl.getUniformLocation(prog, "uDataBox"),
      valRange: gl.getUniformLocation(prog, "uValRange"),
      opacity: gl.getUniformLocation(prog, "uOpacity"),
      domainBox: gl.getUniformLocation(prog, "uDomainBox"),
      feather: gl.getUniformLocation(prog, "uFeather"),
    };

    this._dataTex = gl.createTexture();
    this._lutTextures = {};
    for (const [key, cfg] of Object.entries(CHANNELS_CFG)) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, cfg.lut);
      this._lutTextures[key] = tex;
    }

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE, gl.ONE_MINUS_SRC_ALPHA
    );
    return gl;
  }

  resize(width, height) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      if (this.gl) this.gl.viewport(0, 0, width, height);
    }
  }

  clear() {
    if (this.gl) {
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    } else {
      this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  drawSlice(slice, varName, viewBounds, opacity = 1.0, domainBox = null, feather = 0.0) {
    if (!slice) return;
    const viewBox = [
      viewBounds.getWest(),
      viewBounds.getEast(),
      latToMercY(viewBounds.getSouth()),
      latToMercY(viewBounds.getNorth()),
    ];

    if (this.gl) {
      const dBox = domainBox || [slice.lonMin, slice.lonMax, slice.latMin, slice.latMax];
      this._drawWebGL2(slice, varName, viewBox, opacity, dBox, feather);
    } else {
      this._drawCPU(slice, varName, viewBox, opacity);
    }
  }

  _drawWebGL2(slice, varName, viewBox, opacity, dBox, feather) {
    const gl = this.gl;
    const cfg = CHANNELS_CFG[varName];

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._dataTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, slice.nx, slice.ny, 0, gl.RED, gl.FLOAT, slice.data);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._lutTextures[varName]);

    gl.uniform1i(this._u.dataTex, 0);
    gl.uniform1i(this._u.lutTex, 1);
    gl.uniform2f(this._u.dataSize, slice.nx, slice.ny);
    gl.uniform4f(this._u.viewBox, viewBox[0], viewBox[1], viewBox[2], viewBox[3]);
    gl.uniform4f(this._u.dataBox, slice.lonMin, slice.lonMax, slice.latMin, slice.latMax);
    gl.uniform2f(this._u.valRange, cfg.vmin, cfg.vmax);
    gl.uniform1f(this._u.opacity, opacity);
    gl.uniform4f(this._u.domainBox, dBox[0], dBox[1], dBox[2], dBox[3]);
    gl.uniform1f(this._u.feather, feather);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _drawCPU(slice, varName, viewBox, opacity) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cfg = CHANNELS_CFG[varName];
    const imgData = this.ctx2d.getImageData(0, 0, w, h);
    const out = imgData.data;
    const alpha = Math.round(opacity * 255);

    const [vLonMin, vLonMax, vMercMin, vMercMax] = viewBox;
    const lonSpan = slice.lonMax - slice.lonMin;
    const latSpan = slice.latMax - slice.latMin;

    for (let y = 0; y < h; y++) {
      const mercY = vMercMax - (y / (h - 1)) * (vMercMax - vMercMin);
      const lat = mercYToLat(mercY);
      if (lat < slice.latMin || lat > slice.latMax) continue;

      const fy = ((lat - slice.latMin) / latSpan) * (slice.ny - 1);
      const iy = Math.floor(fy);
      const ty = fy - iy;
      const iy1 = Math.min(slice.ny - 1, iy + 1);

      for (let x = 0; x < w; x++) {
        const lon = vLonMin + (x / (w - 1)) * (vLonMax - vLonMin);
        if (lon < slice.lonMin || lon > slice.lonMax) continue;

        const fx = ((lon - slice.lonMin) / lonSpan) * (slice.nx - 1);
        const ix = Math.floor(fx);
        const tx = fx - ix;
        const ix1 = Math.min(slice.nx - 1, ix + 1);

        const v00 = slice.data[iy * slice.nx + ix];
        const v10 = slice.data[iy * slice.nx + ix1];
        const v01 = slice.data[iy1 * slice.nx + ix];
        const v11 = slice.data[iy1 * slice.nx + ix1];
        const val = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
        if (Number.isNaN(val)) continue;

        const idx = Math.max(0, Math.min(511, Math.round(((val - cfg.vmin) / (cfg.vmax - cfg.vmin)) * 511))) * 4;
        const px = (y * w + x) * 4;
        out[px]     = cfg.lut[idx];
        out[px + 1] = cfg.lut[idx + 1];
        out[px + 2] = cfg.lut[idx + 2];
        out[px + 3] = alpha;
      }
    }
    this.ctx2d.putImageData(imgData, 0, 0);
  }
}
