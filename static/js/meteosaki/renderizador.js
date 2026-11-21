// static/js/meteosaki/renderizador.js
import {
    state, escalas, latInicio, latFin, lonInicio, lonFin,
    width, height, limitesData
} from './config.js';

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

uniform sampler2D uDataTex;
uniform sampler2D uLutTex;
uniform vec2 uDataSize;
uniform vec4 uViewBox;  // (lonMin, lonMax, mercMin, mercMax)
uniform vec4 uDataBox;  // (lonMin, lonMax, latMin, latMax)
uniform vec2 uValRange; // (vmin, vmax)

in vec2 vUv;
out vec4 fragColor;

const float RAD2DEG = 57.29577951308232;
const float PI_HALF = 1.5707963267948966;

bool isInvalid(float v) {
  return isnan(v) || abs(v) > 1e19;
}

float cubic(float p0, float p1, float p2, float p3, float t) {
  if (isInvalid(p1) || isInvalid(p2)) return 1e25;
  if (isInvalid(p0)) p0 = p1;
  if (isInvalid(p3)) p3 = p2;
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
  if (isInvalid(val)) discard;

  float norm = clamp((val - uValRange.x) / (uValRange.y - uValRange.x), 0.0, 1.0);
  fragColor = texture(uLutTex, vec2(norm, 0.5));
}`;

// Generador de LUT (512 colores RGBA) compatible con todas tus paletas
export function buildForecastLUT(variable, tipoColorR, min, max) {
    const size = 512;
    const lut = new Uint8Array(size * 4);

    const interpStops = (stops, norm) => {
        if (norm <= stops[0].t) return stops[0];
        if (norm >= stops[stops.length - 1].t) return stops[stops.length - 1];
        for (let i = 0; i < stops.length - 1; i++) {
            if (norm >= stops[i].t && norm <= stops[i + 1].t) {
                const f = (norm - stops[i].t) / (stops[i + 1].t - stops[i].t);
                return {
                    r: Math.round(stops[i].r + f * (stops[i + 1].r - stops[i].r)),
                    g: Math.round(stops[i].g + f * (stops[i + 1].g - stops[i].g)),
                    b: Math.round(stops[i].b + f * (stops[i + 1].b - stops[i].b)),
                };
            }
        }
        return stops[0];
    };

    const vir = [
        { t: 0, r: 68, g: 1, b: 84 }, { t: 0.25, r: 59, g: 82, b: 139 },
        { t: 0.5, r: 33, g: 145, b: 140 }, { t: 0.75, r: 94, g: 201, b: 98 },
        { t: 1, r: 253, g: 231, b: 37 }
    ];
    const pla = [
        { t: 0, r: 13, g: 8, b: 135 }, { t: 0.25, r: 126, g: 3, b: 168 },
        { t: 0.5, r: 204, g: 71, b: 120 }, { t: 0.75, r: 248, g: 149, b: 64 },
        { t: 1, r: 240, g: 249, b: 33 }
    ];

    for (let i = 0; i < size; i++) {
        const norm = i / (size - 1);
        const val = min + norm * (max - min);
        let r = 0, g = 0, b = 0, a = 200;

        if (tipoColorR === 'custom' && state.customPaletteStops?.length >= 2) {
            const c = interpStops(state.customPaletteStops, norm);
            r = c.r; g = c.g; b = c.b;
        } else if (['r', 'r2m'].includes(variable) && tipoColorR === 'discrete') {
            if (val < 69) { r = 0; g = 0; b = 0; }
            else if (val < 70) { const t = val - 69; r = Math.round(t * 229); g = Math.round(t * 245); b = Math.round(t * 224); }
            else if (val < 77.5) { const t = (val - 70) / 7.5; r = Math.round(229 + t * (161 - 229)); g = Math.round(245 + t * (217 - 245)); b = Math.round(224 + t * (155 - 224)); }
            else if (val < 85) { const t = (val - 77.5) / 7.5; r = Math.round(161 + t * (65 - 161)); g = Math.round(217 + t * (171 - 217)); b = Math.round(155 + t * (93 - 155)); }
            else if (val < 92.5) { const t = (val - 85) / 7.5; r = Math.round(65 + t * (43 - 65)); g = Math.round(171 + t * (140 - 171)); b = Math.round(93 + t * (190 - 93)); }
            else { const t = Math.min(1, (val - 92.5) / 7.5); r = Math.round(43 + t * (8 - 43)); g = Math.round(140 + t * (64 - 140)); b = Math.round(190 + t * (129 - 190)); }
        } else if (tipoColorR === 'viridis') {
            const c = interpStops(vir, norm);
            r = c.r; g = c.g; b = c.b;
        } else if (tipoColorR === 'plasma') {
            const c = interpStops(pla, norm);
            r = c.r; g = c.g; b = c.b;
        } else {
            r = Math.max(0, Math.round(255 * (2 * norm - 1)));
            b = Math.max(0, Math.round(255 * (1 - 2 * norm)));
            g = 255 - r - b;
            a = 180;
        }

        lut[i * 4] = r;
        lut[i * 4 + 1] = g;
        lut[i * 4 + 2] = b;
        lut[i * 4 + 3] = a;
    }
    return lut;
}

export class ForecastRenderer {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.gl = this._initWebGL2();
        this.mode = this.gl ? 'GPU (WebGL2)' : 'CPU (Canvas 2D)';
        if (!this.gl) this.ctx2d = this.canvas.getContext('2d');
        this._lastDraw = null;
    }

    _initWebGL2() {
        const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
        if (!gl) return null;

        const compile = (type, src) => {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
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
        const loc = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        this._u = {
            dataTex: gl.getUniformLocation(prog, 'uDataTex'),
            lutTex: gl.getUniformLocation(prog, 'uLutTex'),
            dataSize: gl.getUniformLocation(prog, 'uDataSize'),
            viewBox: gl.getUniformLocation(prog, 'uViewBox'),
            dataBox: gl.getUniformLocation(prog, 'uDataBox'),
            valRange: gl.getUniformLocation(prog, 'uValRange'),
        };

        this._dataTex = gl.createTexture();
        this._lutTex = gl.createTexture();
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        return gl;
    }

    resize(w, h) {
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
            if (this.gl) this.gl.viewport(0, 0, w, h);
        }
    }

    setData(dataArray, lut, min, max) {
        this._lastDraw = { dataArray, lut, min, max };
        if (this.gl) {
            const gl = this.gl;
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this._dataTex);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, dataArray);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this._lutTex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
        }
    }

    render(viewBounds) {
        if (!this._lastDraw) return;
        const { dataArray, lut, min, max } = this._lastDraw;
        const viewBox = [
            viewBounds.getWest(),
            viewBounds.getEast(),
            latToMercY(viewBounds.getSouth()),
            latToMercY(viewBounds.getNorth()),
        ];

        if (this.gl) {
            const gl = this.gl;
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform1i(this._u.dataTex, 0);
            gl.uniform1i(this._u.lutTex, 1);
            gl.uniform2f(this._u.dataSize, width, height);
            gl.uniform4f(this._u.viewBox, viewBox[0], viewBox[1], viewBox[2], viewBox[3]);
            gl.uniform4f(this._u.dataBox, lonInicio, lonFin, latInicio, latFin);
            gl.uniform2f(this._u.valRange, min, max);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        } else {
            this._renderCPU(dataArray, lut, min, max, viewBox);
        }
    }

    _renderCPU(dataArray, lut, min, max, viewBox) {
        const w = this.canvas.width, h = this.canvas.height;
        const imgData = this.ctx2d.createImageData(w, h);
        const out = imgData.data;
        const [vLonMin, vLonMax, vMercMin, vMercMax] = viewBox;
        const lonSpan = lonFin - lonInicio, latSpan = latFin - latInicio;

        for (let y = 0; y < h; y++) {
            const lat = mercYToLat(vMercMax - (y / (h - 1)) * (vMercMax - vMercMin));
            if (lat < latInicio || lat > latFin) continue;
            const fy = ((lat - latInicio) / latSpan) * (height - 1);
            const iy = Math.floor(fy), ty = fy - iy, iy1 = Math.min(height - 1, iy + 1);

            for (let x = 0; x < w; x++) {
                const lon = vLonMin + (x / (w - 1)) * (vLonMax - vLonMin);
                if (lon < lonInicio || lon > lonFin) continue;
                const fx = ((lon - lonInicio) / lonSpan) * (width - 1);
                const ix = Math.floor(fx), tx = fx - ix, ix1 = Math.min(width - 1, ix + 1);

                const v00 = dataArray[iy * width + ix], v10 = dataArray[iy * width + ix1];
                const v01 = dataArray[iy1 * width + ix], v11 = dataArray[iy1 * width + ix1];
                const val = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
                if (isNaN(val) || Math.abs(val) > 1e19) continue;

                const idx = Math.max(0, Math.min(511, Math.round(((val - min) / (max - min)) * 511))) * 4;
                const px = (y * w + x) * 4;
                out[px] = lut[idx]; out[px + 1] = lut[idx + 1]; out[px + 2] = lut[idx + 2]; out[px + 3] = lut[idx + 3];
            }
        }
        this.ctx2d.putImageData(imgData, 0, 0);
    }
}

export function createHeatCanvasLayer(renderer) {
    const HeatCanvasLayer = L.Layer.extend({
        onAdd(map) {
            this._map = map;
            this._canvas = renderer.canvas;
            this._canvas.className = 'leaflet-layer leaflet-zoom-animated';
            this._canvas.style.pointerEvents = 'none';
            map.getPane('heatPane').appendChild(this._canvas);
            map.on('move zoom viewreset resize', this._redraw, this);
            map.on('zoomanim', this._animateZoom, this);
            this._redraw();
        },
        onRemove(map) {
            L.DomUtil.remove(this._canvas);
            map.off('move zoom viewreset resize', this._redraw, this);
            map.off('zoomanim', this._animateZoom, this);
        },
        setOpacity(val) {
            this._canvas.style.opacity = String(val);
        },
        _animateZoom(e) {
            const scale = this._map.getZoomScale(e.zoom);
            const offset = this._map._latLngBoundsToNewLayerBounds(this._map.getBounds(), e.zoom, e.center).min;
            L.DomUtil.setTransform(this._canvas, offset, scale);
        },
        _redraw() {
            const size = this._map.getSize();
            const topLeft = this._map.containerPointToLayerPoint([0, 0]);
            L.DomUtil.setPosition(this._canvas, topLeft);
            renderer.resize(size.x, size.y);
            renderer.render(this._map.getBounds());
        }
    });
    return new HeatCanvasLayer();
}