// static/js/datos.js

import {
    state, escalas, traductorSuperficie,
    latInicio, latFin, lonInicio, lonFin, dx, dy,
    width, height, latNorteBorde, latSurBorde,
    lonOesteBorde, lonEsteBorde, limitesData
} from './config.js';

import { map } from './mapa.js';
import { actualizarTextosFecha } from './interfaz.js';
import { ForecastRenderer, buildForecastLUT, createHeatCanvasLayer } from './renderizador.js';

const MAX_CACHE_CHUNKS = 350; // ~155 MB RAM (caben ~7 cortes transversales completos)
const chunkCache = new Map();
const inFlightRequests = new Map();
const forecastRenderer = new ForecastRenderer();
console.log(`⚡ Motor de renderizado Meteoclima: ${forecastRenderer.mode}`);

function setChunkCache(key, data) {
    if (chunkCache.has(key)) chunkCache.delete(key);
    chunkCache.set(key, data);
    if (chunkCache.size > MAX_CACHE_CHUNKS) {
        const oldestKey = chunkCache.keys().next().value;
        // Nunca expulsar la topografía estática 'z'
        if (oldestKey !== 'z_static') chunkCache.delete(oldestKey);
    }
}

// ==========================================
// 1. DESCARGA Y DESENCRIPTACIÓN (ZARR)
// ==========================================
export async function descargarCapa(variableBase, timeIdx, levelIdx = null) {
    let variableReal = variableBase;
    let indexNivelZarr = levelIdx;

    if (variableReal === 'vel') variableReal = 'w';
    if (levelIdx === 'surface') {
        if (traductorSuperficie[variableBase]) variableReal = traductorSuperficie[variableBase];
        indexNivelZarr = null;
    } else if (['t2m', 'tp', 'msl', 'r2m', 'q2m', 'conv_q2m', 'adv_q2m', 'adv_t2m'].includes(variableBase)) {
        indexNivelZarr = null;
    }

    const cacheKey = (variableReal === 'z')
        ? 'z_static'
        : `${variableReal}_${timeIdx}_${indexNivelZarr ?? 'sfc'}`;

    // 1. Acierto en caché RAM (0 ms)
    if (chunkCache.has(cacheKey)) {
        const cached = chunkCache.get(cacheKey);
        setChunkCache(cacheKey, cached); // Refrescar LRU
        return cached;
    }

    // 2. Si ya se está descargando este mismo chunk (ej. por prefetch), reutilizar promesa
    if (inFlightRequests.has(cacheKey)) {
        return inFlightRequests.get(cacheKey);
    }

    let repoName = escalas[variableReal] ? escalas[variableReal].repo : 'data1';
    let repoUrl = (repoName === 'data2') ? 'meteoclima-data2' : 'meteoclima-data1';
    let chunkPath = (indexNivelZarr !== null) ? `c/${timeIdx}/${indexNivelZarr}/0/0` : `c/${timeIdx}/0/0`;
    if (variableReal === 'z') chunkPath = `c/0/0`;

    const url = `https://raw.githubusercontent.com/okasakibot/${repoUrl}/main/current_model1/${variableReal}/${chunkPath}`;

    const promise = (async () => {
        try {
            const response = await fetch(url);
            if (!response.ok) return null;

            const encryptedBuffer = await response.arrayBuffer();
            if (encryptedBuffer.byteLength <= 12) return null;

            let result;
            try {
                const decryptedBuffer = await crypto.subtle.decrypt(
                    { name: "AES-GCM", iv: new Uint8Array(encryptedBuffer.slice(0, 12)) },
                    state.cryptoKey,
                    encryptedBuffer.slice(12)
                );
                result = new Float32Array(decryptedBuffer);
            } catch {
                result = new Float32Array(encryptedBuffer);
            }

            setChunkCache(cacheKey, result);
            return result;
        } catch (netErr) {
            console.error(`[Error de Red] en ${variableReal}:`, netErr);
            return null;
        } finally {
            inFlightRequests.delete(cacheKey);
        }
    })();

    inFlightRequests.set(cacheKey, promise);
    return promise;
}

// Precarga silenciosa en segundo plano para el siguiente time step del corte transversal
export function prefetchCorteTransversal(nextTimeIdx, maxTimeIdx) {
    if (nextTimeIdx < 0 || nextTimeIdx > maxTimeIdx) return;
    const totalNiveles = 12;
    for (let i = 0; i < totalNiveles; i++) {
        descargarCapa('r', nextTimeIdx, i).catch(() => {});
        descargarCapa('u', nextTimeIdx, i).catch(() => {});
        descargarCapa('v', nextTimeIdx, i).catch(() => {});
        descargarCapa('w', nextTimeIdx, i).catch(() => {});
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
    let min = escalas[variable] ? escalas[variable].min : 0;
    let max = escalas[variable] ? escalas[variable].max : 100;

    const elCbMin = document.getElementById('cb-min');
    const elCbMax = document.getElementById('cb-max');
    const elCbContainer = document.getElementById('colorbar-container');
    const cbGradient = elCbContainer ? elCbContainer.querySelector('div') : null;
    const tipoColorR = document.getElementById('config-colormap-r')?.value || 'continuous';
    const opacidadGlobal = document.getElementById('config-opacity-modal')
        ? parseFloat(document.getElementById('config-opacity-modal').value)
        : 0.7;

    if (tipoColorR === 'custom' && state.customPaletteStops?.length >= 2) {
        min = state.customPaletteMin;
        max = state.customPaletteMax;
    }

    if (elCbMin) elCbMin.innerText = Number(min.toFixed(1)) + (escalas[variable]?.unit || '');
    if (elCbMax) elCbMax.innerText = Number(max.toFixed(1)) + (escalas[variable]?.unit || '');
    if (elCbContainer) elCbContainer.classList.remove('hidden');

    if (cbGradient) {
        if (['r', 'r2m'].includes(variable) && tipoColorR === 'discrete') cbGradient.style.background = 'linear-gradient(to right, #000000 0%, #000000 60%, #e5f5e0 60%, #a1d99b 70%, #41ab5d 80%, #2b8cbe 90%, #084081 100%)';
        else if (tipoColorR === 'viridis') cbGradient.style.background = 'linear-gradient(to right, #440154, #414487, #2a788e, #22a884, #7ad151, #fde725)';
        else if (tipoColorR === 'plasma') cbGradient.style.background = 'linear-gradient(to right, #0d0887, #6a00a8, #b12a90, #e16462, #fca636, #f0f921)';
        else if (tipoColorR !== 'custom') cbGradient.style.background = 'linear-gradient(to right, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)';
    }

    const lut = buildForecastLUT(variable, tipoColorR, min, max);
    forecastRenderer.setData(dataArray, lut, min, max);

    if (!state.heatLayer) {
        state.heatLayer = createHeatCanvasLayer(forecastRenderer).addTo(map);
    }
    state.heatLayer.setOpacity(opacidadGlobal);
    forecastRenderer.render(map.getBounds());
}
