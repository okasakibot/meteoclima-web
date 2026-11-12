// static/js/interfaz.js

import {
    state, escalas, latInicio, latFin, lonInicio, lonFin,
    dx, dy, width, height, limitesData
} from './config.js';
import { map, cargarMapaBase } from './mapa.js';
import { actualizarMapa, descargarCapa, renderizarCalor, renderizarViento } from './datos.js';

// ==========================================
// 1. FORMATO DE FECHAS
// ==========================================
function formatForecastDate(baseDateStr, addedHours) {
    if (!baseDateStr) return `Cargando...`;
    let str = String(baseDateStr).replace(/\D/g, '');

    if (str.length >= 10) {
        let year = parseInt(str.substring(0, 4));
        let month = parseInt(str.substring(4, 6)) - 1;
        let day = parseInt(str.substring(6, 8));
        let hour = parseInt(str.substring(8, 10));

        let dateObj = new Date(Date.UTC(year, month, day, hour, 0, 0));
        dateObj.setUTCHours(dateObj.getUTCHours() + parseInt(addedHours));

        let yF = dateObj.getUTCFullYear();
        let mF = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
        let dF = String(dateObj.getUTCDate()).padStart(2, '0');
        let hF = String(dateObj.getUTCHours()).padStart(2, '0');

        return `${yF}-${mF}-${dF} ${hF}:00 UTC`;
    }
    return `Error de fecha`;
}

export function actualizarTextosFecha(horasAgregadas) {
    const elDate = document.getElementById('top-date-text');
    if (elDate) elDate.innerText = formatForecastDate(state.fechaActual, horasAgregadas);

    const elTimeDisplay = document.getElementById('time-display');
    if(elTimeDisplay) elTimeDisplay.innerText = `+${horasAgregadas}h`;
}

// ==========================================
// 2. INTERACCIÓN CON EL MAPA (HOVER)
// ==========================================
map.on('mousemove', (e) => {
    const hoverText = document.getElementById('hover-text');
    if (!limitesData.contains(e.latlng) || !state.currentBaseArray) {
        hoverText.innerText = `📍 Fuera de dominio`;
        return;
    }

    let lat = e.latlng.lat; let lon = e.latlng.lng;
    let y = Math.round((lat - latInicio) / dy);
    let x = Math.round((lon - lonInicio) / dx);

    if (y >= 0 && y < height && x >= 0 && x < width) {
        let idx = y * width + x;
        let val = state.currentBaseArray[idx];
        let varName = document.getElementById('var-select').value;
        let unit = escalas[varName] ? escalas[varName].unit : '';
        let txtLat = lat > 0 ? `${lat.toFixed(2)}°N` : `${Math.abs(lat).toFixed(2)}°S`;
        let txtLon = lon > 0 ? `${lon.toFixed(2)}°E` : `${Math.abs(lon).toFixed(2)}°W`;
        let strFinal = `📍 ${txtLat}, ${txtLon} | `;

        if (val !== null && !isNaN(val) && val < 1e20) {
            if (varName !== 'w') strFinal += `${val.toFixed(1)}${unit}`;
            if (state.currentUArray && state.currentVArray) {
                let u = state.currentUArray[idx]; let v = state.currentVArray[idx];
                if (!isNaN(u) && !isNaN(v)) {
                    let dir = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
                    if (varName === 'w') strFinal += `${val.toFixed(1)}${unit}, ${dir.toFixed(0)}°`;
                    else {
                        let speed = Math.sqrt(u*u + v*v);
                        strFinal += ` (🌬️ ${speed.toFixed(1)} m/s, ${dir.toFixed(0)}°)`;
                    }
                }
            }
        } else {
            strFinal += `Sin datos`;
        }
        hoverText.innerText = strFinal;
    }
});

// ==========================================
// 3. LÓGICA DE CORTE TRANSVERSAL
// ==========================================
function ordenarPuntos(latA, lonA, latB, lonB) {
    let swapped = false;
    if (latA === latB) {
        if (lonA > lonB) { let temp = lonA; lonA = lonB; lonB = temp; swapped = true; }
    } else if (lonA === lonB) {
        if (latA > latB) { let temp = latA; latA = latB; latB = temp; swapped = true; }
    } else {
        if (lonA > lonB) {
            let tempLon = lonA; lonA = lonB; lonB = tempLon;
            let tempLat = latA; latA = latB; latB = tempLat;
            swapped = true;
        }
    }
    return { p1: L.latLng(latA, lonA), p2: L.latLng(latB, lonB), swapped };
}

map.on('click', (e) => {
    if (!state.isSelectingCrossSection) return;
    if (!limitesData.contains(e.latlng)) { alert("Punto fuera de dominio."); return; }

    let nuevoPunto = e.latlng;
    if (state.crossSectionPoints.length === 1) {
        if (Math.abs(nuevoPunto.lat - state.crossSectionPoints[0].lat) > Math.abs(nuevoPunto.lng - state.crossSectionPoints[0].lng)) nuevoPunto.lng = state.crossSectionPoints[0].lng;
        else nuevoPunto.lat = state.crossSectionPoints[0].lat;
    }
    state.crossSectionPoints.push(nuevoPunto);
    state.crossSectionMarkers.push(L.circleMarker(nuevoPunto, { radius: 5, color: '#9333ea', fillColor: '#a855f7', fillOpacity: 1 }).addTo(map));

    if (state.crossSectionPoints.length === 1) {
        document.getElementById('btn-cross-section').innerText = "📍 Clic en el Fin...";
    } else if (state.crossSectionPoints.length === 2) {
        let pts = ordenarPuntos(state.crossSectionPoints[0].lat, state.crossSectionPoints[0].lng, state.crossSectionPoints[1].lat, state.crossSectionPoints[1].lng);
        state.crossSectionPoints = [pts.p1, pts.p2];

        state.crossSectionLine = L.polyline(state.crossSectionPoints, { color: '#9333ea', weight: 4, dashArray: '8, 8' }).addTo(map);

        document.getElementById('input-lat-a').value = state.crossSectionPoints[0].lat.toFixed(2);
        document.getElementById('input-lon-a').value = state.crossSectionPoints[0].lng.toFixed(2);
        document.getElementById('input-lat-b').value = state.crossSectionPoints[1].lat.toFixed(2);
        document.getElementById('input-lon-b').value = state.crossSectionPoints[1].lng.toFixed(2);

        document.getElementById('modal-corte').classList.remove('hidden');
        procesarCorteTransversal(state.crossSectionPoints[0], state.crossSectionPoints[1], document.getElementById('time-slider').value);

        state.isSelectingCrossSection = false;
        document.getElementById('btn-cross-section').classList.replace('bg-purple-600', 'bg-purple-100');
        document.getElementById('btn-cross-section').classList.replace('text-white', 'text-purple-800');
        document.getElementById('btn-cross-section').innerText = "📐 Corte";
        document.getElementById('map').style.cursor = '';
    }
});

async function procesarCorteTransversal(p1, p2, forceTimeIdx = null) {
    const container = document.getElementById('corte-grafico-container');
    if (state.crossSectionAnimId) cancelAnimationFrame(state.crossSectionAnimId);
    state.crossSectionParticles = [];

    container.innerHTML = `<div class="text-center text-gray-500 flex flex-col items-center justify-center h-full w-full absolute z-[200]"><svg class="animate-spin h-12 w-12 mb-4 text-purple-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><p class="text-xl font-bold text-gray-700 mb-1">Calculando Perfil Atmosférico 3D...</p></div>`;

    const sliderInterno = document.getElementById('corte-time-slider');
    let timeIdx = forceTimeIdx !== null ? forceTimeIdx : sliderInterno.value;
    sliderInterno.value = timeIdx;
    let horasAgregadas = timeIdx * 3;

    if(document.getElementById('corte-time-display-date')) {
        document.getElementById('corte-time-display-date').innerText = formatForecastDate(state.fechaActual, horasAgregadas);
        document.getElementById('corte-time-display-offset').innerText = `+${horasAgregadas}h`;
    }

    const nivelesAll = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100];
    try {
        let promesas = [];
        for (let i = 0; i < nivelesAll.length; i++) {
            promesas.push(Promise.all([
                descargarCapa('r', timeIdx, i),
                descargarCapa('u', timeIdx, i),
                descargarCapa('v', timeIdx, i),
                descargarCapa('w', timeIdx, i)
            ]).catch(() => null));
        }
        let promesaGeopotencial = descargarCapa('z', timeIdx, null).catch(() => null);

        const [resultadosNivelesAll, dataZ] = await Promise.all([Promise.all(promesas), promesaGeopotencial]);

        let validNiveles = [], resultadosNiveles = [];
        for (let i = 0; i < nivelesAll.length; i++) {
            if (resultadosNivelesAll[i] !== null) {
                validNiveles.push(nivelesAll[i]);
                resultadosNiveles.push(resultadosNivelesAll[i]);
            }
        }

        const numPoints = 80;
        let lats = [], lons = [], ejeX = [];
        const isLonCut = p1.lat === p2.lat;
        const unitX = (p2.lng - p1.lng) / Math.sqrt((p2.lng - p1.lng)**2 + (p2.lat - p1.lat)**2);
        const unitY = (p2.lat - p1.lat) / Math.sqrt((p2.lng - p1.lng)**2 + (p2.lat - p1.lat)**2);

        for (let i = 0; i < numPoints; i++) {
            let f = i / (numPoints - 1);
            let curLat = p1.lat + (p2.lat - p1.lat) * f;
            let curLon = p1.lng + (p2.lng - p1.lng) * f;
            lats.push(curLat);
            lons.push(curLon);
            ejeX.push(isLonCut ? curLon : curLat);
        }

        let topoY = [];
        for (let i = 0; i < numPoints; i++) {
            let yIdx = Math.round((lats[i] - latInicio) / dy); let xIdx = Math.round((lons[i] - lonInicio) / dx);
            let topohPa = 1000;
            if (dataZ && yIdx >= 0 && yIdx < height && xIdx >= 0 && xIdx < width) topohPa = dataZ[yIdx * width + xIdx];
            topoY.push(topohPa);
        }

        let zMatrix = [], uProjMatrix = [], wMatrix = [];
        for (let lvl = 0; lvl < validNiveles.length; lvl++) {
            let filaR = [], filaU = [], filaW = [];
            for (let i = 0; i < numPoints; i++) {
                let yIdx = Math.round((lats[i] - latInicio) / dy); let xIdx = Math.round((lons[i] - lonInicio) / dx);
                let rVal = null, projU = 0, wVal = 0;
                if (yIdx >= 0 && yIdx < height && xIdx >= 0 && xIdx < width) {
                    let idx = yIdx * width + xIdx;
                    let rRaw = resultadosNiveles[lvl][0][idx];
                    if (!isNaN(rRaw) && isFinite(rRaw) && rRaw < 1e20) {
                        rVal = rRaw;
                        projU = (resultadosNiveles[lvl][1][idx] * unitX) + (resultadosNiveles[lvl][2][idx] * unitY);
                        wVal = resultadosNiveles[lvl][3][idx] * 15.0;
                    }
                }
                filaR.push(rVal); filaU.push(projU); filaW.push(wVal);
            }
            zMatrix.push(filaR); uProjMatrix.push(filaU); wMatrix.push(filaW);
        }

        container.innerHTML = `<div id="plot-container" class="w-full h-full absolute top-0 left-0 z-10 bg-[#000000]"></div><canvas id="wind-canvas" class="w-full h-full absolute top-0 left-0 z-20 pointer-events-none"></canvas><button id="btn-toggle-cross-wind" class="absolute top-4 right-4 z-30 px-3 py-1 bg-slate-800 border border-slate-600 text-white text-xs font-bold rounded shadow-lg opacity-80 hover:opacity-100 transition">⏸️ Ocultar Estelas</button>`;

        const traceR = {
            z: zMatrix,
            x: ejeX,
            y: validNiveles,
            type: 'contour',
            zmin: 0,
            zmax: 100,
            colorscale: [[0.0, 'black'], [0.7, 'yellow'], [0.85, 'green'], [1.0, 'blue']]
            colorbar: {
                title: 'Humedad Relativa (%)',
                tickfont: {color: 'white'},
                titlefont: {color: 'white'}
            },
            contours: {
                showlines: false,
                //coloring: 'heatmap' // <-- CRUCIAL: Fuerza el renderizado por bloques de color sin suavizar los bordes
            },
            connectgaps: false,
            hoverinfo: 'x+y+z'
        };
        const traceTopo = { x: [...ejeX, ejeX[numPoints-1], ejeX[0]], y: [...topoY, 1000, 1000], fill: 'toself', fillcolor: '#654321', mode: 'lines', showlegend: false, hoverinfo: 'none', line: { color: '#8b5a2b', width: 2 } };
        const layout = { title: { text: `Perfil Vertical Transversal (${isLonCut ? 'Longitudinal' : 'Latitudinal'})`, font: {color: 'white'} }, plot_bgcolor: '#000000', paper_bgcolor: '#000000', yaxis: { title: 'Presión (hPa)', type: 'linear', autorange: false, range: [1000, 100], gridcolor: '#333', color: 'white', fixedrange: true }, xaxis: { title: isLonCut ? 'Longitud (°W/°E)' : 'Latitud (°S/°N)', tickformat: '.2f', gridcolor: '#333', color: 'white', fixedrange: true }, margin: { t: 50, b: 50, l: 60, r: 20 }, font: { family: 'Inter, sans-serif' } };

        Plotly.newPlot('plot-container', [traceTopo, traceR], layout, {responsive: true, displayModeBar: false}).then(() => {
            const canvas = document.getElementById('wind-canvas'); const ctx = canvas.getContext('2d'); const gd = document.getElementById('plot-container');
            const pMin = 100, pMax = 1000; const xMin = Math.min(ejeX[0], ejeX[numPoints - 1]), xMax = Math.max(ejeX[0], ejeX[numPoints - 1]);
            function resizeCanvas() { canvas.width = gd.clientWidth; canvas.height = gd.clientHeight; }
            resizeCanvas(); window.addEventListener('resize', resizeCanvas);

            function getWindAt(xPos, pPos) {
                let xRatio = (xPos - ejeX[0]) / (ejeX[numPoints - 1] - ejeX[0]); let pRatio = (pMax - pPos) / (pMax - pMin);
                let ix = Math.floor(Math.max(0, Math.min(xRatio * (numPoints - 1), numPoints - 1.001))); let ip = Math.floor(Math.max(0, Math.min(pRatio * (validNiveles.length - 1), validNiveles.length - 1.001)));
                let fx = xRatio * (numPoints - 1) - ix, fp = pRatio * (validNiveles.length - 1) - ip;
                let uInterp = 0, wInterp = 0;
                if (uProjMatrix[ip] && uProjMatrix[ip+1]) {
                    uInterp = ((uProjMatrix[ip][ix]||0)*(1-fx) + (uProjMatrix[ip][ix+1]||0)*fx)*(1-fp) + ((uProjMatrix[ip+1][ix]||0)*(1-fx) + (uProjMatrix[ip+1][ix+1]||0)*fx)*fp;
                    wInterp = ((wMatrix[ip][ix]||0)*(1-fx) + (wMatrix[ip][ix+1]||0)*fx)*(1-fp) + ((wMatrix[ip+1][ix]||0)*(1-fx) + (wMatrix[ip+1][ix+1]||0)*fx)*fp;
                }
                return { u: uInterp, w: wInterp};
            }

            function resetParticle(p = {}) { p.x = xMin + Math.random() * (xMax - xMin); p.p = pMin + Math.random() * (pMax - pMin); p.age = 0; p.lifespan = 30 + Math.random() * 60; p.isNew = true; return p; }
            for (let i = 0; i < 1500; i++) state.crossSectionParticles.push(resetParticle());

            function animateTrails() {
                if (!state.isCrossSectionWindActive) return;
                ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = 'rgba(0, 0, 0, 0.90)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = 1.8; ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'; ctx.beginPath();
                for (let i = 0; i < state.crossSectionParticles.length; i++) {
                    let pt = state.crossSectionParticles[i];
                    let oldX_pix = gd._fullLayout.margin.l + gd._fullLayout.xaxis.c2p(pt.x); let oldY_pix = gd._fullLayout.margin.t + gd._fullLayout.yaxis.c2p(pt.p);
                    let wind = getWindAt(pt.x, pt.p); pt.x += wind.u * 0.003; pt.p += wind.w * 0.3; pt.age++;
                    let topoIdxFloat = (pt.x - xMin) / (xMax - xMin) * (numPoints - 1); let idxInt = Math.floor(Math.max(0, Math.min(topoIdxFloat, numPoints - 2)));
                    let topoAtX = topoY[idxInt] * (1 - (topoIdxFloat - idxInt)) + topoY[idxInt+1] * (topoIdxFloat - idxInt);
                    if (pt.p < pMin || pt.p > topoAtX || pt.x < xMin || pt.x > xMax || pt.age > pt.lifespan) { resetParticle(pt); continue; }
                    if (!pt.isNew) { ctx.moveTo(oldX_pix, oldY_pix); ctx.lineTo(gd._fullLayout.margin.l + gd._fullLayout.xaxis.c2p(pt.x), gd._fullLayout.margin.t + gd._fullLayout.yaxis.c2p(pt.p)); }
                    pt.isNew = false;
                }
                ctx.stroke(); state.crossSectionAnimId = requestAnimationFrame(animateTrails);
            }
            animateTrails();

            document.getElementById('btn-toggle-cross-wind').addEventListener('click', function() {
                state.isCrossSectionWindActive = !state.isCrossSectionWindActive;
                if (state.isCrossSectionWindActive) { this.innerText = "⏸️ Ocultar Estelas"; this.classList.replace('opacity-50', 'opacity-80'); animateTrails(); }
                else { this.innerText = "▶️ Mostrar Estelas"; this.classList.replace('opacity-80', 'opacity-50'); cancelAnimationFrame(state.crossSectionAnimId); ctx.clearRect(0, 0, canvas.width, canvas.height); }
            });
            });
            } catch (err) { console.error(err); container.innerHTML = `<div class="text-red-600 bg-red-100 p-4 rounded-lg font-bold">⚠️ Error: ${err.message}</div>`; }
            }

// ==========================================
// 4. EVENTOS DOM (UI)
// ==========================================
export function initUI() {
    // Controles de Tiempo Generales
    const sliderTiempo = document.getElementById('time-slider');
    if (sliderTiempo) {
        document.getElementById('btn-time-prev')?.addEventListener('click', () => {
            if (sliderTiempo.value > 0) { sliderTiempo.value--; sliderTiempo.dispatchEvent(new Event('input')); sliderTiempo.dispatchEvent(new Event('change')); }
        });
        document.getElementById('btn-time-next')?.addEventListener('click', () => {
            if (parseInt(sliderTiempo.value) < parseInt(sliderTiempo.max)) { sliderTiempo.value++; sliderTiempo.dispatchEvent(new Event('input')); sliderTiempo.dispatchEvent(new Event('change')); }
        });
        sliderTiempo.addEventListener('input', (e) => actualizarTextosFecha(e.target.value * 3));
        sliderTiempo.addEventListener('change', actualizarMapa);
    }

    // Modal Config y Paletas
    document.getElementById('colorbar-container')?.addEventListener('click', () => {
        document.getElementById('modal-config').classList.remove('hidden'); document.getElementById('config-colormap-r').focus();
    });
    document.getElementById('btn-config')?.addEventListener('click', () => document.getElementById('modal-config').classList.remove('hidden'));
    document.getElementById('btn-close-config')?.addEventListener('click', () => document.getElementById('modal-config').classList.add('hidden'));

    document.getElementById('config-basemap')?.addEventListener('change', (e) => cargarMapaBase(e.target.value));

    document.getElementById('config-colormap-r')?.addEventListener('change', (e) => {
        let customBuilder = document.getElementById('custom-palette-builder');
        if (e.target.value === 'custom') customBuilder.classList.remove('hidden'); else customBuilder.classList.add('hidden');
        if (state.currentBaseArray) renderizarCalor(state.currentBaseArray, document.getElementById('var-select').value);
    });

    document.getElementById('config-opacity-modal')?.addEventListener('input', (e) => {
        const opacityValue = parseFloat(e.target.value);
        if(document.getElementById('lbl-opacity-modal')) document.getElementById('lbl-opacity-modal').innerText = `${Math.round(opacityValue * 100)}%`;
        if (state.heatLayer) state.heatLayer.setOpacity(opacityValue);
    });

    document.getElementById('config-wind-speed-modal')?.addEventListener('input', (e) => {
        let speed = parseFloat(e.target.value);
        let lbl = speed < 0.01 ? 'Lenta' : (speed > 0.03 ? 'Rápida' : 'Normal');
        if(document.getElementById('lbl-wind-speed-modal')) document.getElementById('lbl-wind-speed-modal').innerText = lbl;
        if (state.isWindActive && state.currentUArray && state.currentVArray) renderizarViento(state.currentUArray, state.currentVArray);
    });

    // Controladores de Variables y Niveles
    document.getElementById('var-select')?.addEventListener('change', (e) => {
        const selectedVar = e.target.value;
        const cSel = document.getElementById('config-colormap-r');
        const dOpt = cSel ? cSel.querySelector('option[value="discrete"]') : null;
        const levelSelect = document.getElementById('level-select');
        const optgroupLevels = document.getElementById('optgroup-levels');
        const optgroupSfc = document.getElementById('optgroup-sfc');

        if(cSel && dOpt) {
            if (selectedVar === 'r' || selectedVar === 'r2m') { dOpt.style.display = 'block'; if (['continuous', 'discrete'].includes(cSel.value)) cSel.value = 'discrete'; }
            else { dOpt.style.display = 'none'; if (cSel.value === 'discrete') cSel.value = 'continuous'; }
        }

        const variablesSoloSuperficie = ['t2m', 'tp', 'msl'];
        const variablesSoloNiveles = ['vo', 'd'];

        if(levelSelect && optgroupLevels && optgroupSfc) {
            if (variablesSoloSuperficie.includes(selectedVar)) {
                optgroupLevels.style.display = 'none'; optgroupSfc.style.display = 'block';
                levelSelect.value = 'surface'; levelSelect.disabled = true; levelSelect.classList.add('opacity-50', 'cursor-not-allowed');
            } else if (variablesSoloNiveles.includes(selectedVar)) {
                optgroupLevels.style.display = 'block'; optgroupSfc.style.display = 'none';
                levelSelect.disabled = false; levelSelect.classList.remove('opacity-50', 'cursor-not-allowed');
                if (levelSelect.value === 'surface') levelSelect.value = '0';
            } else {
                optgroupLevels.style.display = 'block'; optgroupSfc.style.display = 'block';
                levelSelect.disabled = false; levelSelect.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }
        actualizarMapa();
    });

    document.getElementById('level-select')?.addEventListener('change', actualizarMapa);

    // Botones de interfaz y viento
    document.getElementById('btn-hide-ui')?.addEventListener('click', () => {
        document.getElementById('bottom-bar').classList.add('translate-y-full'); document.getElementById('btn-show-ui').classList.remove('hidden');
    });
    document.getElementById('btn-show-ui')?.addEventListener('click', () => {
        document.getElementById('bottom-bar').classList.remove('translate-y-full'); document.getElementById('btn-show-ui').classList.add('hidden');
    });

    const btnWind = document.getElementById('btn-wind-toggle');
    btnWind?.addEventListener('click', () => {
        state.isWindActive = !state.isWindActive;
        btnWind.innerText = state.isWindActive ? "🌬️ Viento: ON" : "🌬️ Viento: OFF";
        btnWind.className = state.isWindActive ? "px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded transition font-bold border border-blue-400" : "px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded transition font-bold border border-red-400";
        actualizarMapa();
    });

    // Eventos del Modal Transversal
    document.getElementById('btn-cross-section')?.addEventListener('click', function() {
        state.isSelectingCrossSection = !state.isSelectingCrossSection;
        state.crossSectionPoints = [];
        if (state.isSelectingCrossSection) {
            this.classList.replace('bg-purple-600', 'bg-red-600'); this.innerText = "📍 Cancelar"; document.getElementById('map').style.cursor = 'crosshair';
            if (state.crossSectionLine) map.removeLayer(state.crossSectionLine);
            state.crossSectionMarkers.forEach(m => map.removeLayer(m)); state.crossSectionMarkers = [];
        } else {
            this.classList.replace('bg-red-600', 'bg-purple-600'); this.innerText = "📐 Corte"; document.getElementById('map').style.cursor = '';
        }
    });

    document.getElementById('btn-update-coords')?.addEventListener('click', () => {
        let latA = parseFloat(document.getElementById('input-lat-a').value), lonA = parseFloat(document.getElementById('input-lon-a').value);
        let latB = parseFloat(document.getElementById('input-lat-b').value), lonB = parseFloat(document.getElementById('input-lon-b').value);
        if (isNaN(latA) || isNaN(lonA) || isNaN(latB) || isNaN(lonB)) return alert("Coordenadas inválidas.");

        let r = ordenarPuntos(latA, lonA, latB, lonB);
        if (r.swapped) { document.getElementById('input-lat-a').value = r.p1.lat.toFixed(2); document.getElementById('input-lon-a').value = r.p1.lng.toFixed(2); document.getElementById('input-lat-b').value = r.p2.lat.toFixed(2); document.getElementById('input-lon-b').value = r.p2.lng.toFixed(2); }
        if (!limitesData.contains(r.p1) || !limitesData.contains(r.p2)) return alert("Fuera de dominio.");

        state.crossSectionPoints = [r.p1, r.p2];
        if (state.crossSectionLine) map.removeLayer(state.crossSectionLine);
        state.crossSectionMarkers.forEach(m => map.removeLayer(m)); state.crossSectionMarkers = [];
        state.crossSectionMarkers.push(L.circleMarker(r.p1, { radius: 5, color: '#9333ea', fillColor: '#a855f7', fillOpacity: 1 }).addTo(map));
        state.crossSectionMarkers.push(L.circleMarker(r.p2, { radius: 5, color: '#9333ea', fillColor: '#a855f7', fillOpacity: 1 }).addTo(map));
        state.crossSectionLine = L.polyline(state.crossSectionPoints, { color: '#9333ea', weight: 4, dashArray: '8, 8' }).addTo(map);

        procesarCorteTransversal(r.p1, r.p2, document.getElementById('corte-time-slider').value);
    });

    document.getElementById('corte-time-slider')?.addEventListener('input', (e) => {
        let h = e.target.value * 3;
        if(document.getElementById('corte-time-display-date')) document.getElementById('corte-time-display-date').innerText = formatForecastDate(state.fechaActual, h);
        if(document.getElementById('corte-time-display-offset')) document.getElementById('corte-time-display-offset').innerText = `+${h}h`;
    });

    document.getElementById('corte-time-slider')?.addEventListener('change', (e) => {
        if (state.crossSectionPoints.length === 2) procesarCorteTransversal(state.crossSectionPoints[0], state.crossSectionPoints[1], e.target.value);
    });

    // Constructor Paletas
    document.getElementById('btn-add-stop')?.addEventListener('click', () => {
        let div = document.createElement('div'); div.className = 'flex gap-2 items-center stop-row';
        div.innerHTML = `<input type="number" value="50" class="stop-val w-16 bg-slate-900 border border-slate-600 rounded px-1 py-1 text-xs"><input type="color" value="#00ff00" class="stop-color w-full h-6 bg-transparent border-0 cursor-pointer"><button class="btn-remove-stop text-red-400 hover:text-red-300 font-bold">&times;</button>`;
        document.getElementById('custom-stops-container').appendChild(div);
        div.querySelector('.btn-remove-stop').addEventListener('click', function() { this.parentElement.remove(); });
    });

    document.querySelectorAll('.btn-remove-stop').forEach(btn => btn.addEventListener('click', function() { this.parentElement.remove(); }));

    document.getElementById('btn-apply-custom')?.addEventListener('click', () => {
        let minV = parseFloat(document.getElementById('custom-min').value), maxV = parseFloat(document.getElementById('custom-max').value);
        if (isNaN(minV) || isNaN(maxV) || minV >= maxV) return alert('Rango inválido.');

        let rawStops = [];
        document.querySelectorAll('.stop-row').forEach(row => {
            let val = parseFloat(row.querySelector('.stop-val').value), hex = row.querySelector('.stop-color').value;
            let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            let rgb = result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
            if (!isNaN(val) && rgb) { let t = Math.max(0, Math.min(1, (val - minV) / (maxV - minV))); rawStops.push({ val, t, r: rgb.r, g: rgb.g, b: rgb.b, hex }); }
        });
        if (rawStops.length < 2) return alert('Mínimo 2 paradas.');

        rawStops.sort((a, b) => a.val - b.val);
        state.customPaletteMin = minV; state.customPaletteMax = maxV; state.customPaletteStops = rawStops;

        let gStr = 'linear-gradient(to right'; rawStops.forEach(s => gStr += `, ${s.hex} ${Math.round(s.t * 100)}%`); gStr += ')';
        if(document.querySelector('#colorbar-container div')) document.querySelector('#colorbar-container div').style.background = gStr;
        if(document.getElementById('cb-min')) document.getElementById('cb-min').innerText = minV + '%';
        if(document.getElementById('cb-max')) document.getElementById('cb-max').innerText = maxV + '%';

        if (state.currentBaseArray) renderizarCalor(state.currentBaseArray, document.getElementById('var-select').value);
    });
}

// ==========================================
// 5. EXPOSICIÓN A GLOBAL (Para onclick HTML)
// ==========================================
window.cerrarCorte = function() {
    document.getElementById('modal-corte').classList.add('hidden');
    if (state.crossSectionAnimId) cancelAnimationFrame(state.crossSectionAnimId);
};
