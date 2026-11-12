// static/js/datos.js

import { 
    state, escalas, traductorSuperficie, 
    latInicio, latFin, lonInicio, lonFin, dx, dy, 
    width, height, latNorteBorde, latSurBorde, 
    lonOesteBorde, lonEsteBorde, limitesData 
} from './config.js';

import { map } from './mapa.js';
import { actualizarTextosFecha } from './interfaz.js';

// ==========================================
// 1. DESCARGA Y DESENCRIPTACIÓN (ZARR)
// ==========================================
export async function descargarCapa(variableBase, timeIdx, levelIdx = null) {
    let variableReal = variableBase;
    let indexNivelZarr = levelIdx;

    if (variableReal === 'vel') variableReal = 'w';

    if (levelIdx === 'surface') {
        if (traductorSuperficie[variableBase]) {
            variableReal = traductorSuperficie[variableBase];
        }
        indexNivelZarr = null;
    }
    else if (['t2m', 'tp', 'msl', 'r2m', 'q2m', 'conv_q2m', 'adv_q2m', 'adv_t2m'].includes(variableBase)) {
        indexNivelZarr = null;
    }

    let repoName = escalas[variableReal] ? escalas[variableReal].repo : 'data1';
    let repoUrl = (repoName === 'data2') ? 'meteoclima-data2' : 'meteoclima-data1';

    let chunkPath = (indexNivelZarr !== null) ? `c/${timeIdx}/${indexNivelZarr}/0/0` : `c/${timeIdx}/0/0`;
    if (variableReal === 'z') chunkPath = `c/0/0`; // Excepción topografía estática

    const url = `https://raw.githubusercontent.com/okasakibot/${repoUrl}/main/current_model1/${variableReal}/${chunkPath}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`[Capa faltante] No se pudo descargar: ${url}`);
            return null;
        }

        const encryptedBuffer = await response.arrayBuffer();
        if (encryptedBuffer.byteLength <= 12) return null;

        try {
            const decryptedBuffer = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: new Uint8Array(encryptedBuffer.slice(0, 12)) },
                state.cryptoKey,
                encryptedBuffer.slice(12)
            );
            return new Float32Array(decryptedBuffer);
        } catch (decryptErr) {
            return new Float32Array(encryptedBuffer);
        }

    } catch (netErr) {
        console.error(`[Error de Red] en ${variableReal}:`, netErr);
        return null;
    }
}

// ==========================================
// 2. ORQUESTADOR PRINCIPAL DE ACTUALIZACIÓN
// ==========================================
export async function actualizarMapa() {
    const loadingUI = document.getElementById('loading-indicator');
    if(loadingUI) loadingUI.classList.remove('hidden');

    const variable = document.getElementById('var-select').value;
    const timeIdx = document.getElementById('time-slider').value;
    const levelIdx = document.getElementById('level-select').value;

    try {
        let uArray = null, vArray = null, baseArray = null;
        const requiereViento = state.isWindActive || variable === 'w';
        const promesas = [];

        promesas.push((variable !== 'w') ? descargarCapa(variable, timeIdx, levelIdx) : Promise.resolve(null));
        if (requiereViento) {
            promesas.push(descargarCapa('u', timeIdx, levelIdx));
            promesas.push(descargarCapa('v', timeIdx, levelIdx));
        }

        const resultados = await Promise.all(promesas);

        if (variable === 'w') {
            uArray = resultados[1]; vArray = resultados[2];
            baseArray = new Float32Array(uArray.length);
            for(let i = 0; i < uArray.length; i++) {
                baseArray[i] = (!isNaN(uArray[i]) && !isNaN(vArray[i])) ? Math.sqrt(Math.pow(uArray[i], 2) + Math.pow(vArray[i], 2)) : null;
            }
        } else {
            baseArray = resultados[0];
            if (requiereViento) { uArray = resultados[1]; vArray = resultados[2]; }
        }

        // Actualizamos el estado global
        state.currentBaseArray = baseArray;
        if (requiereViento) { 
            state.currentUArray = uArray; 
            state.currentVArray = vArray; 
        } else { 
            state.currentUArray = null; 
            state.currentVArray = null; 
        }

        if (baseArray) renderizarCalor(baseArray, variable);

        if (state.isWindActive && uArray && vArray) {
            renderizarViento(uArray, vArray);
        } else if (state.windLayer) { 
            map.removeLayer(state.windLayer); 
            state.windLayer = null; 
        }

    } catch (error) {
        console.error("Error al actualizar el mapa:", error);
    } finally {
        if(loadingUI) loadingUI.classList.add('hidden');
        actualizarTextosFecha(document.getElementById('time-slider').value * 3);
    }
}

// ==========================================
// 3. RENDERIZADORES 2D (VIENTO Y CALOR)
// ==========================================
export function renderizarViento(uArray, vArray) {
    let uClean = []; let vClean = [];

    // Leaflet-Velocity asume orden estricto de Norte a Sur.
    for (let y = height - 1; y >= 0; y--) {
        for (let x = 0; x < width; x++) {
            let idx = y * width + x;
            uClean.push(isNaN(uArray[idx]) || Math.abs(uArray[idx]) > 1e20 ? null : uArray[idx]);
            vClean.push(isNaN(vArray[idx]) || Math.abs(vArray[idx]) > 1e20 ? null : vArray[idx]);
        }
    }

    const velocityData = [
        {
            header: { parameterCategory: 2, parameterNumber: 2, lo1: lonInicio, la1: latFin, dx: dx, dy: dy, nx: width, ny: height, refTime: "2026" },
            data: uClean
        },
        {
            header: { parameterCategory: 2, parameterNumber: 3, lo1: lonInicio, la1: latFin, dx: dx, dy: dy, nx: width, ny: height, refTime: "2026" },
            data: vClean
        }
    ];

    if (state.windLayer) map.removeLayer(state.windLayer);

    let speedCfg = document.getElementById('config-wind-speed-modal') ? parseFloat(document.getElementById('config-wind-speed-modal').value) : 0.015;

    state.windLayer = L.velocityLayer({
        displayValues: false,
        data: velocityData,
        maxVelocity: 25,
        velocityScale: speedCfg,
        particleMultiplier: 1/500,
        colorScale: ["#ffffff"],
        pane: 'windPane'
    });

    state.windLayer.addTo(map);
}

export function renderizarCalor(dataArray, variable) {
    // Fórmulas de proyección a Web Mercator
    function latToMercY(lat) { return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 180 / 2)); }
    function mercYToLat(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI); }
    let mercN = latToMercY(latNorteBorde);
    let mercS = latToMercY(latSurBorde);

    // Definición del tamaño del Canvas
    const factorSubpixel = 2;
    const cw = width * factorSubpixel;
    const ch = height * factorSubpixel;

    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(cw, ch);

    let min = 0, max = 100;
    if (escalas[variable]) {
        min = escalas[variable].min;
        max = escalas[variable].max;
    }

    const elCbMin = document.getElementById('cb-min');
    const elCbMax = document.getElementById('cb-max');
    const elCbContainer = document.getElementById('colorbar-container');
    const cbGradient = elCbContainer ? elCbContainer.querySelector('div') : null;
    const tipoColorR = document.getElementById('config-colormap-r') ? document.getElementById('config-colormap-r').value : 'continuous';
    let opacidadGlobal = document.getElementById('config-opacity-modal') ? parseFloat(document.getElementById('config-opacity-modal').value) : 0.7;

    if (elCbMin) elCbMin.innerText = Number(min.toFixed(1)) + (escalas[variable] ? escalas[variable].unit : '');
    if (elCbMax) elCbMax.innerText = Number(max.toFixed(1)) + (escalas[variable] ? escalas[variable].unit : '');
    if (elCbContainer) elCbContainer.classList.remove('hidden');

    if (cbGradient) {
        if (['r', 'r2m'].includes(variable) && tipoColorR === 'discrete') cbGradient.style.background = 'linear-gradient(to right, #000000 0%, #000000 60%, #e5f5e0 60%, #a1d99b 70%, #41ab5d 80%, #2b8cbe 90%, #084081 100%)';
        else if (tipoColorR === 'viridis') cbGradient.style.background = 'linear-gradient(to right, #440154, #414487, #2a788e, #22a884, #7ad151, #fde725)';
        else if (tipoColorR === 'plasma') cbGradient.style.background = 'linear-gradient(to right, #0d0887, #6a00a8, #b12a90, #e16462, #fca636, #f0f921)';
        else if (tipoColorR === 'custom' && state.customPaletteStops) { /* Procesado por UI */ }
        else cbGradient.style.background = 'linear-gradient(to right, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)';
    }

    // Función de interpolación Bilineal
    function getBilinear(array, yFloat, xFloat, gridW, gridH) {
        let y0 = Math.floor(yFloat); let x0 = Math.floor(xFloat);
        let y1 = Math.min(y0 + 1, gridH - 1); let x1 = Math.min(x0 + 1, gridW - 1);
        if (y0 < 0 || y0 >= gridH || x0 < 0 || x0 >= gridW) return null;
        let v00 = array[y0 * gridW + x0]; let v10 = array[y0 * gridW + x1];
        let v01 = array[y1 * gridW + x0]; let v11 = array[y1 * gridW + x1];
        if (v00 === null || isNaN(v00) || v00 > 1e20 || v00 < -1e20) return null;
        if (v10 === null || isNaN(v10) || v10 > 1e20 || v10 < -1e20) return null;
        if (v01 === null || isNaN(v01) || v01 > 1e20 || v01 < -1e20) return null;
        if (v11 === null || isNaN(v11) || v11 > 1e20 || v11 < -1e20) return null;
        let fy = yFloat - y0; let fx = xFloat - x0;
        let top = v00 * (1 - fx) + v10 * fx; let bot = v01 * (1 - fx) + v11 * fx;
        return top * (1 - fy) + bot * fy;
    }

    // Bucle principal de Renderizado
    let pixelIndex = 0;
    for(let cy = 0; cy < ch; cy++) {
        let currentMercY = mercN - (cy / (ch - 1)) * (mercN - mercS);
        let zarrYFloat = (mercYToLat(currentMercY) - latInicio) / dy;

        for(let cx = 0; cx < cw; cx++) {
            let zarrXFloat = ((lonOesteBorde + (cx / (cw - 1)) * (lonEsteBorde - lonOesteBorde)) - lonInicio) / dx;
            let cIdx = pixelIndex * 4;

            let val = getBilinear(dataArray, zarrYFloat, zarrXFloat, width, height);

            if (val === null) {
                imgData.data[cIdx+3] = 0; // Transparente si es NaN
            } else {
                let norm = Math.max(0, Math.min(1, (val - min) / (max - min)));

                // Lógica de coloreado
                if (tipoColorR === 'custom' && state.customPaletteStops && state.customPaletteStops.length >= 2) {
                    let cNorm = Math.max(0, Math.min(1, (val - state.customPaletteMin) / (state.customPaletteMax - state.customPaletteMin)));
                    let stops = state.customPaletteStops;
                    if (cNorm <= stops[0].t) {
                        imgData.data[cIdx+0] = stops[0].r; imgData.data[cIdx+1] = stops[0].g; imgData.data[cIdx+2] = stops[0].b;
                    } else if (cNorm >= stops[stops.length-1].t) {
                        imgData.data[cIdx+0] = stops[stops.length-1].r; imgData.data[cIdx+1] = stops[stops.length-1].g; imgData.data[cIdx+2] = stops[stops.length-1].b;
                    } else {
                        for (let i = 0; i < stops.length - 1; i++) {
                            if (cNorm >= stops[i].t && cNorm <= stops[i+1].t) {
                                let t_l = (cNorm - stops[i].t) / (stops[i+1].t - stops[i].t);
                                imgData.data[cIdx+0] = Math.round(stops[i].r + t_l * (stops[i+1].r - stops[i].r));
                                imgData.data[cIdx+1] = Math.round(stops[i].g + t_l * (stops[i+1].g - stops[i].g));
                                imgData.data[cIdx+2] = Math.round(stops[i].b + t_l * (stops[i+1].b - stops[i].b));
                                break;
                            }
                        }
                    }
                    imgData.data[cIdx+3] = 200;
                } else if (['r', 'r2m'].includes(variable) && tipoColorR === 'discrete') {
                    let r = 0, g = 0, b = 0;
                    if (val < 59) { r = 0; g = 0; b = 0; }
                    else if (val < 60) { let t = val - 59; r = Math.round(t * 229); g = Math.round(t * 245); b = Math.round(t * 224); }
                    else if (val < 70) { let t = (val - 60) / 10; r = Math.round(229 + t * (161 - 229)); g = Math.round(245 + t * (217 - 245)); b = Math.round(224 + t * (155 - 224)); }
                    else if (val < 80) { let t = (val - 70) / 10; r = Math.round(161 + t * (65 - 161)); g = Math.round(217 + t * (171 - 217)); b = Math.round(155 + t * (93 - 155)); }
                    else if (val < 90) { let t = (val - 80) / 10; r = Math.round(65 + t * (43 - 65)); g = Math.round(171 + t * (140 - 171)); b = Math.round(93 + t * (190 - 93)); }
                    else { let t = Math.min(1, (val - 90) / 10); r = Math.round(43 + t * (8 - 43)); g = Math.round(140 + t * (64 - 140)); b = Math.round(190 + t * (129 - 190)); }
                    imgData.data[cIdx+0] = r; imgData.data[cIdx+1] = g; imgData.data[cIdx+2] = b; imgData.data[cIdx+3] = 200;
                } else if (tipoColorR === 'viridis') {
                    const vir = [ { t: 0, r: 68, g: 1, b: 84 }, { t: 0.25, r: 59, g: 82, b: 139 }, { t: 0.5, r: 33, g: 145, b: 140 }, { t: 0.75, r: 94, g: 201, b: 98 }, { t: 1, r: 253, g: 231, b: 37 } ];
                    for (let i = 0; i < vir.length - 1; i++) {
                        if (norm >= vir[i].t && norm <= vir[i+1].t) {
                            let t_l = (norm - vir[i].t) / (vir[i+1].t - vir[i].t);
                            imgData.data[cIdx+0] = Math.round(vir[i].r + t_l * (vir[i+1].r - vir[i].r)); imgData.data[cIdx+1] = Math.round(vir[i].g + t_l * (vir[i+1].g - vir[i].g)); imgData.data[cIdx+2] = Math.round(vir[i].b + t_l * (vir[i+1].b - vir[i].b)); break;
                        }
                    }
                    imgData.data[cIdx+3] = 200;
                } else if (tipoColorR === 'plasma') {
                    const pla = [ { t: 0, r: 13, g: 8, b: 135 }, { t: 0.25, r: 126, g: 3, b: 168 }, { t: 0.5, r: 204, g: 71, b: 120 }, { t: 0.75, r: 248, g: 149, b: 64 }, { t: 1, r: 240, g: 249, b: 33 } ];
                    for (let i = 0; i < pla.length - 1; i++) {
                        if (norm >= pla[i].t && norm <= pla[i+1].t) {
                            let t_l = (norm - pla[i].t) / (pla[i+1].t - pla[i].t);
                            imgData.data[cIdx+0] = Math.round(pla[i].r + t_l * (pla[i+1].r - pla[i].r)); imgData.data[cIdx+1] = Math.round(pla[i].g + t_l * (pla[i+1].g - pla[i].g)); imgData.data[cIdx+2] = Math.round(pla[i].b + t_l * (pla[i+1].b - pla[i].b)); break;
                        }
                    }
                    imgData.data[cIdx+3] = 200;
                } else {
                    // Default ColorMap
                    imgData.data[cIdx+0] = Math.max(0, 255 * (2 * norm - 1));
                    imgData.data[cIdx+1] = 255 - imgData.data[cIdx+0] - Math.max(0, 255 * (1 - 2 * norm));
                    imgData.data[cIdx+2] = Math.max(0, 255 * (1 - 2 * norm));
                    imgData.data[cIdx+3] = 180;
                }
            }
            pixelIndex++;
        }
    }

    ctx.putImageData(imgData, 0, 0);
    if(state.heatLayer) map.removeLayer(state.heatLayer);

    state.heatLayer = L.imageOverlay(canvas.toDataURL(), limitesData, { 
        opacity: opacidadGlobal, 
        className: 'smooth-layer', 
        pane: 'heatPane' 
    }).addTo(map);
}