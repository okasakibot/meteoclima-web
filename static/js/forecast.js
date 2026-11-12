// static/js/forecast.js

// ==========================================
// 0. CONFIGURACIÓN FIREBASE Y ESTADO GLOBAL
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCt-F47o7avnEJx6_WuBX0EO845FTiROWo",
    authDomain: "meteoclima-lab.firebaseapp.com",
    projectId: "meteoclima-lab"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// Variables Globales Dinámicas
let cryptoKey = null;
let fechaActual = ""; // Se llenará con formato YYYYMMDDHH desde Firebase

// Estado del mapa y variables de datos
let isWindActive = true;
let windLayer = null;
let heatLayer = null;
let currentBaseMapLayer = null;
let currentLabelsLayer = null;

let currentBaseArray = null;
let currentUArray = null;
let currentVArray = null;

// Escalas y configuración de variables
const escalas = {
    'r': { min: 0, max: 100, unit: '%', name: 'Humedad Relativa', repo: 'data1' },
    'w': { min: 0, max: 40, unit: ' m/s', name: 'Velocidad del Viento', repo: 'data1' },
    'q': { min: 0, max: 20, unit: ' g/kg', name: 'Humedad Específica', repo: 'data1' },
    't2m': { min: -10, max: 40, unit: '°C', name: 'Temp a 2m', repo: 'data1' },
    'tp': { min: 0, max: 50, unit: ' mm', name: 'Precipitación Total', repo: 'data1' },
    'msl': { min: 950, max: 1050, unit: ' hPa', name: 'Presión al Nivel del Mar', repo: 'data1' },
    'vo': { min: -0.0001, max: 0.0001, unit: ' /s', name: 'Vorticidad relativa', repo: 'data2' },
    'd': { min: -0.0001, max: 0.0001, unit: ' /s', name: 'Divergencia', repo: 'data2' },
    'r2m': { min: 0, max: 100, unit: '%', name: 'HR a 2m', repo: 'data2' },
    'q2m': { min: 0, max: 20, unit: ' g/kg', name: 'Humedad Específica a 2m', repo: 'data2' },
    'conv_q': { min: -0.001, max: 0.001, unit: ' (g/kg)/s', name: 'Conv. de Humedad', repo: 'data2' },
    'adv_q': { min: -0.001, max: 0.001, unit: ' (g/kg)/s', name: 'Adv. de Humedad', repo: 'data2' },
    'adv_t': { min: -0.001, max: 0.001, unit: ' °C/s', name: 'Adv. de Temperatura', repo: 'data2' },
    'conv_q2m': { min: -0.001, max: 0.001, unit: ' (g/kg)/s', name: 'Conv. HR (Sup)', repo: 'data2' },
    'adv_q2m': { min: -0.001, max: 0.001, unit: ' (g/kg)/s', name: 'Adv. HR (Sup)', repo: 'data2' },
    'adv_t2m': { min: -0.001, max: 0.001, unit: ' °C/s', name: 'Adv. Temp (Sup)', repo: 'data2' }
};

const traductorSuperficie = {
    'r': 'r2m', 'q': 'q2m', 'u': 'u10', 'v': 'v10',
    'conv_q': 'conv_q2m', 'adv_q': 'adv_q2m', 'adv_t': 'adv_t2m'
};

// Dominio Geográfico y Resolución
const latInicio = -57.0;
const latFin = 13.0;
const lonInicio = -110.0;
const lonFin = -10.0;
const dx = 0.25;
const dy = 0.25;
const width = Math.round((lonFin - lonInicio) / dx) + 1;
const height = Math.round((latFin - latInicio) / dy) + 1;

// Límites ajustados para que las coordenadas de los bordes del grid encajen en el overlay
const latSurBorde = latInicio - (dy / 2.0);
const latNorteBorde = latFin + (dy / 2.0);
const lonOesteBorde = lonInicio - (dx / 2.0);
const lonEsteBorde = lonFin + (dx / 2.0);
const limitesData = L.latLngBounds([[latSurBorde, lonOesteBorde], [latNorteBorde, lonEsteBorde]]);

let isSelectingCrossSection = false;
let crossSectionPoints = [];
let crossSectionLine = null;
let crossSectionMarkers = [];
let crossSectionAnimId = null;
let crossSectionParticles = [];
let isCrossSectionWindActive = true;

window.customPaletteStops = null;
window.customPaletteMin = 0;
window.customPaletteMax = 100;

// ==========================================
// 1. AUTENTICACIÓN Y EXTRACCIÓN DE METADATOS
// ==========================================
const btnLogin = document.getElementById('btn-login');
let sesionIniciada = false;

function restaurarBotonLogin() {
    if (btnLogin) {
        btnLogin.innerHTML = "Iniciar sesión con Google";
        btnLogin.disabled = false;
        btnLogin.className = "px-6 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition shadow-lg cursor-pointer flex items-center gap-3";
    }
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (sesionIniciada) return;

        if (btnLogin) btnLogin.innerText = "Conectando al servidor...";
        try {
            const docRef = doc(db, "metadatos_modelo", "estado_actual");
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();

                // Asegurar que fechaActual se lee completa (ej. 2026110312)
                fechaActual = data.fecha_disponible;

                if (!fechaActual || fechaActual.length < 10) {
                    throw new Error("El formato de fecha_disponible en Firestore es incorrecto. Debe incluir hora (%Y%m%d%H).");
                }

                const rawKey = Uint8Array.from(atob(data.llave_aes), c => c.charCodeAt(0));
                cryptoKey = await crypto.subtle.importKey(
                    "raw", rawKey, { name: "AES-GCM", length: 256 }, true, ["decrypt"]
                );

                document.getElementById('auth-overlay').style.display = 'none';
                document.getElementById('bottom-bar').classList.remove('translate-y-full');
                document.getElementById('right-panel').classList.remove('opacity-0', 'pointer-events-none');

                const btnCrono = document.getElementById('btn-cronograma');
                if(btnCrono) btnCrono.classList.remove('hidden');

                const profileUI = document.getElementById('user-profile');
                const profileName = document.getElementById('profile-name');
                const profileImg = document.getElementById('profile-img');

                if (profileName) profileName.innerText = user.displayName || user.email.split('@')[0];
                if (user.photoURL && profileImg) {
                    profileImg.src = user.photoURL;
                    profileImg.classList.remove('hidden');
                }
                if (profileUI) profileUI.classList.remove('hidden');

                sesionIniciada = true;
                actualizarTextosFecha(0);
                cargarMapaBase(document.getElementById('config-basemap')?.value || 'terrain-esri');
                await actualizarMapa();

            } else {
                throw new Error("No hay documento de estado_actual en BD.");
            }
        } catch (error) {
            console.error("Error validando metadatos Auth:", error);
            document.getElementById('auth-error').innerText = "Error: " + error.message;
            document.getElementById('auth-error').classList.remove('hidden');
            restaurarBotonLogin();
        }
    } else {
        restaurarBotonLogin();
        document.getElementById('auth-overlay').style.display = 'flex';
        document.getElementById('user-profile').classList.add('hidden');
        sesionIniciada = false;
    }
});

document.getElementById('btn-logout')?.addEventListener('click', () => {
    auth.signOut().then(() => window.location.reload());
});

btnLogin?.addEventListener('click', () => {
    btnLogin.innerText = "Abriendo Google...";
    signInWithPopup(auth, provider).catch(err => {
        console.error("Fallo popup Auth:", err);
        restaurarBotonLogin();
    });
});

// ==========================================
// 2. INICIALIZACIÓN DE LEAFLET Y PANELES
// ==========================================
const map = L.map('map', {
    maxBounds: limitesData,
    maxBoundsViscosity: 1.0,
    zoomSnap: 0,
    zoomDelta: 0.5,
    attributionControl: false
});

// Orden estricto de dibujado (z-index)
map.createPane('heatPane');
map.getPane('heatPane').style.zIndex = 250;
map.createPane('windPane');
map.getPane('windPane').style.zIndex = 260;
map.createPane('labelsPane');
map.getPane('labelsPane').style.zIndex = 270;
map.getPane('labelsPane').style.pointerEvents = 'none';

map.fitBounds(limitesData);

function encuadrarModoCover() {
    const mapSize = map.getSize();
    if (mapSize.x === 0 || mapSize.y === 0) return;
    const nw = map.project(limitesData.getNorthWest(), 0);
    const se = map.project(limitesData.getSouthEast(), 0);
    const boundsSize = L.point(Math.abs(se.x - nw.x), Math.abs(se.y - nw.y));
    const scaleCover = Math.max(mapSize.x / boundsSize.x, mapSize.y / boundsSize.y);
    const minCoverZoom = Math.log(scaleCover) / Math.LN2;
    map.setMinZoom(minCoverZoom);
    if (map.getZoom() < minCoverZoom) map.setView(limitesData.getCenter(), minCoverZoom);
}
map.whenReady(() => encuadrarModoCover());
window.addEventListener('resize', () => setTimeout(encuadrarModoCover, 100));

// ==========================================
// 3. GESTIÓN DE MAPAS BASE
// ==========================================
function cargarMapaBase(tipo) {
    if (currentBaseMapLayer) map.removeLayer(currentBaseMapLayer);
    if (currentLabelsLayer) map.removeLayer(currentLabelsLayer);
    currentLabelsLayer = null;

    let url = '';
    let mapOptions = { maxZoom: 19 };

    if (tipo === 'osm') {
        url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    } else if (tipo === 'dark') {
        url = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    } else if (tipo === 'satellite1') {
        url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    } else if (tipo === 'satellite2') {
        url = 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
        mapOptions.subdomains = ['0', '1', '2', '3'];
        mapOptions.updateWhenIdle = true;
        mapOptions.keepBuffer = 4;
    } else if (tipo === 'terrain-esri') {
        url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
        let urlLabels = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}';
        currentLabelsLayer = L.tileLayer(urlLabels, { maxZoom: 19, pane: 'labelsPane', className: 'bright-labels'}).addTo(map);
    } else if (tipo === 'terrain-stamen') {
        url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}';
    }

    currentBaseMapLayer = L.tileLayer(url, mapOptions).addTo(map);
}

// ==========================================
// 4. DESCARGA Y PROCESAMIENTO DE ZARR
// ==========================================
async function descargarCapa(variableBase, timeIdx, levelIdx = null) {
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
                cryptoKey,
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

async function actualizarMapa() {
    const loadingUI = document.getElementById('loading-indicator');
    loadingUI.classList.remove('hidden');

    const variable = document.getElementById('var-select').value;
    const timeIdx = document.getElementById('time-slider').value;
    const levelIdx = document.getElementById('level-select').value;

    try {
        let uArray = null, vArray = null, baseArray = null;
        const requiereViento = isWindActive || variable === 'w';
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

        currentBaseArray = baseArray;
        if (requiereViento) { currentUArray = uArray; currentVArray = vArray; }
        else { currentUArray = null; currentVArray = null; }

        if (baseArray) renderizarCalor(baseArray, variable);

        if (isWindActive && uArray && vArray) renderizarViento(uArray, vArray);
        else if (windLayer) { map.removeLayer(windLayer); windLayer = null; }

    } catch (error) {
        console.error("Error al actualizar el mapa:", error);
    } finally {
        loadingUI.classList.add('hidden');
        actualizarTextosFecha(document.getElementById('time-slider').value * 3);
    }
}

// ==========================================
// 5. EVENTOS E INTERFAZ UI
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

function actualizarTextosFecha(horasAgregadas) {
    document.getElementById('top-date-text').innerText = formatForecastDate(fechaActual, horasAgregadas);
    if(document.getElementById('time-display')) {
        document.getElementById('time-display').innerText = `+${horasAgregadas}h`;
    }
}

document.getElementById('time-slider')?.addEventListener('input', (e) => actualizarTextosFecha(e.target.value * 3));
document.getElementById('time-slider')?.addEventListener('change', actualizarMapa);
document.getElementById('var-select')?.addEventListener('change', actualizarMapa);
document.getElementById('level-select')?.addEventListener('change', actualizarMapa);

document.getElementById('btn-hide-ui')?.addEventListener('click', () => {
    document.getElementById('bottom-bar').classList.add('translate-y-full');
    document.getElementById('btn-show-ui').classList.remove('hidden');
});
document.getElementById('btn-show-ui')?.addEventListener('click', () => {
    document.getElementById('bottom-bar').classList.remove('translate-y-full');
    document.getElementById('btn-show-ui').classList.add('hidden');
});

// Lectura de Mouse (Hover)
map.on('mousemove', (e) => {
    const hoverText = document.getElementById('hover-text');
    if (!limitesData.contains(e.latlng) || !currentBaseArray) { hoverText.innerText = `📍 Fuera de dominio`; return; }

    let lat = e.latlng.lat; let lon = e.latlng.lng;

    // Cálculo directo de índices.
    let y = Math.round((lat - latInicio) / dy);
    let x = Math.round((lon - lonInicio) / dx);

    if (y >= 0 && y < height && x >= 0 && x < width) {
        let idx = y * width + x;
        let val = currentBaseArray[idx];
        let varName = document.getElementById('var-select').value;
        let unit = escalas[varName] ? escalas[varName].unit : '';
        let txtLat = lat > 0 ? `${lat.toFixed(2)}°N` : `${Math.abs(lat).toFixed(2)}°S`;
        let txtLon = lon > 0 ? `${lon.toFixed(2)}°E` : `${Math.abs(lon).toFixed(2)}°W`;
        let strFinal = `📍 ${txtLat}, ${txtLon} | `;

        if (val !== null && !isNaN(val) && val < 1e20) {
            if (varName !== 'w') strFinal += `${val.toFixed(1)}${unit}`;
            if (currentUArray && currentVArray) {
                let u = currentUArray[idx]; let v = currentVArray[idx];
                if (!isNaN(u) && !isNaN(v)) {
                    let dir = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
                    if (varName === 'w') strFinal += `${val.toFixed(1)}${unit}, ${dir.toFixed(0)}°`;
                    else {
                        let speed = Math.sqrt(u*u + v*v);
                        strFinal += ` (🌬️ ${speed.toFixed(1)} m/s, ${dir.toFixed(0)}°)`;
                    }
                }
            }
        } else strFinal += `Sin datos`;
        hoverText.innerText = strFinal;
    }
});

const btnWind = document.getElementById('btn-wind-toggle');
btnWind?.addEventListener('click', () => {
    isWindActive = !isWindActive;
    btnWind.innerText = isWindActive ? "🌬️ Viento: ON" : "🌬️ Viento: OFF";
    btnWind.className = isWindActive
        ? "px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded transition font-bold border border-blue-400"
        : "px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded transition font-bold border border-red-400";
    actualizarMapa();
});

// ==========================================
// 6. RENDERIZADORES 2D MAPA BASE
// ==========================================

function renderizarViento(uArray, vArray) {
    let uClean = []; let vClean = [];

    // Leaflet-Velocity asume orden estricto de Norte a Sur.
    // Extraemos los datos comenzando por el borde superior (Norte) leyendo hacia atrás el eje y.
    for (let y = height - 1; y >= 0; y--) {
        for (let x = 0; x < width; x++) {
            let idx = y * width + x;
            uClean.push(isNaN(uArray[idx]) || Math.abs(uArray[idx]) > 1e20 ? null : uArray[idx]);
            vClean.push(isNaN(vArray[idx]) || Math.abs(vArray[idx]) > 1e20 ? null : vArray[idx]);
        }
    }

    const velocityData = [
        {
            // la1 DEBE ser el borde superior (Norte).
            header: { parameterCategory: 2, parameterNumber: 2, lo1: lonInicio, la1: latFin, dx: dx, dy: dy, nx: width, ny: height, refTime: "2026" },
            data: uClean
        },
        {
            header: { parameterCategory: 2, parameterNumber: 3, lo1: lonInicio, la1: latFin, dx: dx, dy: dy, nx: width, ny: height, refTime: "2026" },
            data: vClean
        }
    ];

    if (windLayer) map.removeLayer(windLayer);

    let speedCfg = document.getElementById('config-wind-speed-modal') ? parseFloat(document.getElementById('config-wind-speed-modal').value) : 0.015;

    windLayer = L.velocityLayer({
        displayValues: false,
        data: velocityData,
        maxVelocity: 25,
        velocityScale: speedCfg,
        particleMultiplier: 1/500,
        colorScale: ["#ffffff"],
        pane: 'windPane'
    });

    windLayer.addTo(map);
}

function renderizarCalor(dataArray, variable) {
    // 1. Fórmulas de proyección a Web Mercator
    function latToMercY(lat) { return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 180 / 2)); }
    function mercYToLat(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI); }
    let mercN = latToMercY(latNorteBorde);
    let mercS = latToMercY(latSurBorde);

    // 2. Definición del tamaño del Canvas (Aumentado para mayor resolución)
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
        else if (tipoColorR === 'custom' && window.customPaletteStops) { /* Procesado por UI */ }
        else cbGradient.style.background = 'linear-gradient(to right, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)';
    }

    // 3. Función de interpolación Bilineal para suavizar datos
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

    // 4. Bucle principal de Renderizado (Usando proyecciones)
    let pixelIndex = 0;
    for(let cy = 0; cy < ch; cy++) {
        let currentMercY = mercN - (cy / (ch - 1)) * (mercN - mercS);
        let zarrYFloat = (mercYToLat(currentMercY) - latInicio) / dy;

        for(let cx = 0; cx < cw; cx++) {
            let zarrXFloat = ((lonOesteBorde + (cx / (cw - 1)) * (lonEsteBorde - lonOesteBorde)) - lonInicio) / dx;
            let cIdx = pixelIndex * 4;

            // Usar getBilinear en lugar de indexación directa
            let val = getBilinear(dataArray, zarrYFloat, zarrXFloat, width, height);

            if (val === null) {
                imgData.data[cIdx+3] = 0; // Transparente si es NaN
            } else {
                let norm = Math.max(0, Math.min(1, (val - min) / (max - min)));

                // Lógica de coloreado
                if (tipoColorR === 'custom' && window.customPaletteStops && window.customPaletteStops.length >= 2) {
                    let cNorm = Math.max(0, Math.min(1, (val - window.customPaletteMin) / (window.customPaletteMax - window.customPaletteMin)));
                    let stops = window.customPaletteStops;
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
    if(heatLayer) map.removeLayer(heatLayer);

    heatLayer = L.imageOverlay(canvas.toDataURL(), limitesData, { opacity: opacidadGlobal, className: 'smooth-layer', pane: 'heatPane' }).addTo(map);
}

// ==========================================
// 7. CORTE TRANSVERSAL Y ESTELAS
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
    if (!isSelectingCrossSection) return;
    if (!limitesData.contains(e.latlng)) { alert("Punto fuera de dominio."); return; }

    let nuevoPunto = e.latlng;
    if (crossSectionPoints.length === 1) {
        if (Math.abs(nuevoPunto.lat - crossSectionPoints[0].lat) > Math.abs(nuevoPunto.lng - crossSectionPoints[0].lng)) nuevoPunto.lng = crossSectionPoints[0].lng;
        else nuevoPunto.lat = crossSectionPoints[0].lat;
    }
    crossSectionPoints.push(nuevoPunto);
    crossSectionMarkers.push(L.circleMarker(nuevoPunto, { radius: 5, color: '#9333ea', fillColor: '#a855f7', fillOpacity: 1 }).addTo(map));

    if (crossSectionPoints.length === 1) {
        document.getElementById('btn-cross-section').innerText = "📍 Clic en el Fin...";
    } else if (crossSectionPoints.length === 2) {
        let pts = ordenarPuntos(crossSectionPoints[0].lat, crossSectionPoints[0].lng, crossSectionPoints[1].lat, crossSectionPoints[1].lng);
        crossSectionPoints = [pts.p1, pts.p2];

        crossSectionLine = L.polyline(crossSectionPoints, { color: '#9333ea', weight: 4, dashArray: '8, 8' }).addTo(map);

        document.getElementById('input-lat-a').value = crossSectionPoints[0].lat.toFixed(2);
        document.getElementById('input-lon-a').value = crossSectionPoints[0].lng.toFixed(2);
        document.getElementById('input-lat-b').value = crossSectionPoints[1].lat.toFixed(2);
        document.getElementById('input-lon-b').value = crossSectionPoints[1].lng.toFixed(2);

        document.getElementById('modal-corte').classList.remove('hidden');
        procesarCorteTransversal(crossSectionPoints[0], crossSectionPoints[1], document.getElementById('time-slider').value);

        isSelectingCrossSection = false;
        document.getElementById('btn-cross-section').classList.replace('bg-purple-600', 'bg-purple-100');
        document.getElementById('btn-cross-section').classList.replace('text-white', 'text-purple-800');
        document.getElementById('btn-cross-section').innerText = "📐 Corte";
        document.getElementById('map').style.cursor = '';
    }
});

async function procesarCorteTransversal(p1, p2, forceTimeIdx = null) {
    const container = document.getElementById('corte-grafico-container');
    if (crossSectionAnimId) cancelAnimationFrame(crossSectionAnimId);
    crossSectionParticles = [];

    container.innerHTML = `<div class="text-center text-gray-500 flex flex-col items-center justify-center h-full w-full absolute z-[200]"><svg class="animate-spin h-12 w-12 mb-4 text-purple-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><p class="text-xl font-bold text-gray-700 mb-1">Calculando Perfil Atmosférico 3D...</p></div>`;

    const sliderInterno = document.getElementById('corte-time-slider');
    let timeIdx = forceTimeIdx !== null ? forceTimeIdx : sliderInterno.value;
    sliderInterno.value = timeIdx;
    let horasAgregadas = timeIdx * 3;

    if(document.getElementById('corte-time-display-date')) {
        document.getElementById('corte-time-display-date').innerText = formatForecastDate(fechaActual, horasAgregadas);
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
            // Mapeo riguroso de Sur a Norte (Coincide con Leaflet y el array Zarr 1D)
            let yIdx = Math.round((lats[i] - latInicio) / dy);
            let xIdx = Math.round((lons[i] - lonInicio) / dx);
            let topohPa = 1000;
            if (dataZ && yIdx >= 0 && yIdx < height && xIdx >= 0 && xIdx < width) topohPa = dataZ[yIdx * width + xIdx];
            topoY.push(topohPa);
        }

        let zMatrix = [], uProjMatrix = [], wMatrix = [];
        for (let lvl = 0; lvl < validNiveles.length; lvl++) {
            let filaR = [], filaU = [], filaW = [];
            let currentNivel = validNiveles[lvl];

            for (let i = 0; i < numPoints; i++) {
                let yIdx = Math.round((lats[i] - latInicio) / dy);
                let xIdx = Math.round((lons[i] - lonInicio) / dx);
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
                filaR.push(rVal);
                filaU.push(projU);
                filaW.push(wVal);
            }
            zMatrix.push(filaR);
            uProjMatrix.push(filaU);
            wMatrix.push(filaW);
        }

        container.innerHTML = `
            <div id="plot-container" class="w-full h-full absolute top-0 left-0 z-10 bg-[#000000]"></div>
            <canvas id="wind-canvas" class="w-full h-full absolute top-0 left-0 z-20 pointer-events-none"></canvas>
            <button id="btn-toggle-cross-wind" class="absolute top-4 right-4 z-30 px-3 py-1 bg-slate-800 border border-slate-600 text-white text-xs font-bold rounded shadow-lg opacity-80 hover:opacity-100 transition">
                ⏸️ Ocultar Estelas
            </button>
        `;

        //const rhColorscale = [
        //    [0.0, 'rgb(0,0,0)'], [0.6, 'rgb(0,0,0)'], [0.601, 'rgb(250,204,21)'], [0.8, 'rgb(34,197,94)'], [1.0, 'rgb(59,130,246)']
        //];

        const traceR = { z: zMatrix, x: ejeX, y: validNiveles, type: 'contour', zmin: 0, zmax: 100, colorscale: [[0.0, 'black'], [0.6, 'black'], [0.6, 'yellow'], [0.8, 'green'], [1.0, 'blue']], colorbar: { title: 'Humedad Relativa (%)', tickfont: {color: 'white'}, titlefont: {color: 'white'} }, contours: { showlines: false }, connectgaps: false, hoverinfo: 'x+y+z' };

        const traceTopo = { x: [...ejeX, ejeX[numPoints-1], ejeX[0]], y: [...topoY, 1000, 1000], fill: 'toself', fillcolor: '#654321', mode: 'lines', showlegend: false, hoverinfo: 'none', line: { color: '#8b5a2b', width: 2 } };

        const layout = { title: { text: `Perfil Vertical Transversal (${isLonCut ? 'Longitudinal' : 'Latitudinal'})`, font: {color: 'white'} }, plot_bgcolor: '#000000', paper_bgcolor: '#000000', yaxis: { title: 'Presión (hPa)', type: 'linear', autorange: false, range: [1000, 100], gridcolor: '#333', color: 'white', fixedrange: true }, xaxis: { title: isLonCut ? 'Longitud (°W/°E)' : 'Latitud (°S/°N)', tickformat: '.2f', gridcolor: '#333', color: 'white', fixedrange: true }, margin: { t: 50, b: 50, l: 60, r: 20 }, font: { family: 'Inter, sans-serif' } };

        Plotly.newPlot('plot-container', [traceTopo, traceR], layout, {responsive: true, displayModeBar: false}).then(() => {
            const canvas = document.getElementById('wind-canvas');
            const ctx = canvas.getContext('2d');
            const gd = document.getElementById('plot-container');

            const pMin = 100, pMax = 1000;
            const xMin = Math.min(ejeX[0], ejeX[numPoints - 1]), xMax = Math.max(ejeX[0], ejeX[numPoints - 1]);

            function resizeCanvas() { canvas.width = gd.clientWidth; canvas.height = gd.clientHeight; }
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);

            function getWindAt(xPos, pPos) {
                let xRatio = (xPos - ejeX[0]) / (ejeX[numPoints - 1] - ejeX[0]);
                let pRatio = (pMax - pPos) / (pMax - pMin);
                let ix = Math.floor(Math.max(0, Math.min(xRatio * (numPoints - 1), numPoints - 1.001)));
                let ip = Math.floor(Math.max(0, Math.min(pRatio * (validNiveles.length - 1), validNiveles.length - 1.001)));
                let fx = xRatio * (numPoints - 1) - ix, fp = pRatio * (validNiveles.length - 1) - ip;

                let uInterp = 0, wInterp = 0;
                if (uProjMatrix[ip] && uProjMatrix[ip+1]) {
                    uInterp = ((uProjMatrix[ip][ix]||0)*(1-fx) + (uProjMatrix[ip][ix+1]||0)*fx)*(1-fp) + ((uProjMatrix[ip+1][ix]||0)*(1-fx) + (uProjMatrix[ip+1][ix+1]||0)*fx)*fp;
                    wInterp = ((wMatrix[ip][ix]||0)*(1-fx) + (wMatrix[ip][ix+1]||0)*fx)*(1-fp) + ((wMatrix[ip+1][ix]||0)*(1-fx) + (wMatrix[ip+1][ix+1]||0)*fx)*fp;
                }
                return { u: uInterp, w: wInterp};
            }

            function getTopo(xPos) {
                let idxFloat = (xPos - xMin) / (xMax - xMin) * (numPoints - 1);
                let i = Math.floor(idxFloat);
                if (i < 0) i = 0; if (i >= numPoints - 1) i = numPoints - 2;
                let f = idxFloat - i;
                return topoY[i] * (1 - f) + topoY[i+1] * f;
            }

            function resetParticle(p = {}) {
                p.x = xMin + Math.random() * (xMax - xMin);
                p.p = pMin + Math.random() * (pMax - pMin);
                p.age = 0;
                p.lifespan = 30 + Math.random() * 60;
                p.isNew = true;
                return p;
            }

            for (let i = 0; i < 1500; i++) crossSectionParticles.push(resetParticle());

            function animateTrails() {
                if (!isCrossSectionWindActive) return;
                ctx.globalCompositeOperation = 'destination-in';
                ctx.fillStyle = 'rgba(0, 0, 0, 0.90)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                ctx.globalCompositeOperation = 'source-over';
                ctx.lineWidth = 1.8;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
                ctx.beginPath();

                const dt_x = 0.003;
                const dt_p = 0.3;

                for (let i = 0; i < crossSectionParticles.length; i++) {
                    let pt = crossSectionParticles[i];
                    let oldX_pix = gd._fullLayout.margin.l + gd._fullLayout.xaxis.c2p(pt.x);
                    let oldY_pix = gd._fullLayout.margin.t + gd._fullLayout.yaxis.c2p(pt.p);

                    let wind = getWindAt(pt.x, pt.p);
                    pt.x += wind.u * dt_x;
                    pt.p += wind.w * dt_p;
                    pt.age++;

                    let topoAtX = getTopo(pt.x);

                    if (pt.p < pMin || pt.p > topoAtX || pt.x < xMin || pt.x > xMax || pt.age > pt.lifespan) {
                        resetParticle(pt);
                        continue;
                    }

                    if (!pt.isNew) {
                        ctx.moveTo(oldX_pix, oldY_pix);
                        ctx.lineTo(gd._fullLayout.margin.l + gd._fullLayout.xaxis.c2p(pt.x), gd._fullLayout.margin.t + gd._fullLayout.yaxis.c2p(pt.p));
                    }
                    pt.isNew = false;
                }
                ctx.stroke();
                crossSectionAnimId = requestAnimationFrame(animateTrails);
            }
            animateTrails();

            document.getElementById('btn-toggle-cross-wind')?.addEventListener('click', function() {
                isCrossSectionWindActive = !isCrossSectionWindActive;
                if (isCrossSectionWindActive) {
                    this.innerText = "⏸️ Ocultar Estelas";
                    this.classList.replace('opacity-50', 'opacity-80');
                    animateTrails();
                }
                else {
                    this.innerText = "▶️ Mostrar Estelas";
                    this.classList.replace('opacity-80', 'opacity-50');
                    cancelAnimationFrame(crossSectionAnimId);
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }
            });
        });
    } catch (err) {
        console.error(err);
        container.innerHTML = `<div class="text-red-600 bg-red-100 p-4 rounded-lg font-bold">⚠️ Error: ${err.message}</div>`;
    }
}

// ==========================================
// 8. ASIGNACIÓN DE EVENTOS DE INTERFAZ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {

    // Controles de Tiempo Generales
    const sliderTiempo = document.getElementById('time-slider');
    if (sliderTiempo) {
        document.getElementById('btn-time-prev')?.addEventListener('click', () => {
            if (sliderTiempo.value > 0) {
                sliderTiempo.value--;
                sliderTiempo.dispatchEvent(new Event('input'));
                sliderTiempo.dispatchEvent(new Event('change'));
            }
        });
        document.getElementById('btn-time-next')?.addEventListener('click', () => {
            if (parseInt(sliderTiempo.value) < parseInt(sliderTiempo.max)) {
                sliderTiempo.value++;
                sliderTiempo.dispatchEvent(new Event('input'));
                sliderTiempo.dispatchEvent(new Event('change'));
            }
        });
    }

    // Modal Config y Paletas
    document.getElementById('colorbar-container')?.addEventListener('click', () => {
        document.getElementById('modal-config').classList.remove('hidden');
        document.getElementById('config-colormap-r').focus();
    });
    document.getElementById('btn-config')?.addEventListener('click', () => document.getElementById('modal-config').classList.remove('hidden'));
    document.getElementById('btn-close-config')?.addEventListener('click', () => document.getElementById('modal-config').classList.add('hidden'));

    document.getElementById('config-basemap')?.addEventListener('change', (e) => cargarMapaBase(e.target.value));

    document.getElementById('config-colormap-r')?.addEventListener('change', (e) => {
        let customBuilder = document.getElementById('custom-palette-builder');
        if (e.target.value === 'custom') customBuilder.classList.remove('hidden'); else customBuilder.classList.add('hidden');
        if (currentBaseArray) renderizarCalor(currentBaseArray, document.getElementById('var-select').value);
    });

    // Evento de Opacidad (Apuntando al Modal)
    const configOpacity = document.getElementById('config-opacity-modal');
    if (configOpacity) {
        configOpacity.addEventListener('input', (e) => {
            const opacityValue = parseFloat(e.target.value);
            if(document.getElementById('lbl-opacity-modal')) {
                document.getElementById('lbl-opacity-modal').innerText = `${Math.round(opacityValue * 100)}%`;
            }
            if (heatLayer) heatLayer.setOpacity(opacityValue);
        });
    }

    // Evento de Velocidad del Viento (Apuntando al Modal)
    const configWindSpeed = document.getElementById('config-wind-speed-modal');
    if (configWindSpeed) {
        configWindSpeed.addEventListener('input', (e) => {
            let speed = parseFloat(e.target.value);
            let lbl = speed < 0.01 ? 'Lenta' : (speed > 0.03 ? 'Rápida' : 'Normal');
            if(document.getElementById('lbl-wind-speed-modal')) {
                document.getElementById('lbl-wind-speed-modal').innerText = lbl;
            }

            if (isWindActive && currentUArray && currentVArray) {
                if (windLayer) map.removeLayer(windLayer);

                let uClean = []; let vClean = [];
                for (let y = height - 1; y >= 0; y--) {
                    for (let x = 0; x < width; x++) {
                        let idx = y * width + x;
                        uClean.push(isNaN(currentUArray[idx]) || Math.abs(currentUArray[idx]) > 1e20 ? null : currentUArray[idx]);
                        vClean.push(isNaN(currentVArray[idx]) || Math.abs(currentVArray[idx]) > 1e20 ? null : currentVArray[idx]);
                    }
                }
                const velocityData = [
                    { header: { parameterCategory: 2, parameterNumber: 2, lo1: lonInicio, la1: latFin, dx: dx, dy: dy, nx: width, ny: height, refTime: "2026" }, data: uClean },
                    { header: { parameterCategory: 2, parameterNumber: 3, lo1: lonInicio, la1: latFin, dx: dx, dy: dy, nx: width, ny: height, refTime: "2026" }, data: vClean }
                ];

                windLayer = L.velocityLayer({
                    displayValues: false, data: velocityData, maxVelocity: 25,
                    velocityScale: speed, particleMultiplier: 1/500, colorScale: ["#ffffff"],
                    pane: 'windPane'
                });
                windLayer.addTo(map);
            }
        });
    }


    // Controladores de Variables y Niveles
    document.getElementById('var-select')?.addEventListener('change', (e) => {
        const selectedVar = e.target.value;
        const cSel = document.getElementById('config-colormap-r');
        const dOpt = cSel ? cSel.querySelector('option[value="discrete"]') : null;
        const levelSelect = document.getElementById('level-select');
        const optgroupLevels = document.getElementById('optgroup-levels');
        const optgroupSfc = document.getElementById('optgroup-sfc');

        // Controles Modal Transversal
        document.getElementById('btn-cross-section')?.addEventListener('click', function() {
            isSelectingCrossSection = !isSelectingCrossSection;
            crossSectionPoints = [];
            if (isSelectingCrossSection) {
                this.classList.replace('bg-purple-600', 'bg-red-600');
                this.innerText = "📍 Cancelar";
                document.getElementById('map').style.cursor = 'crosshair';

                if (crossSectionLine) map.removeLayer(crossSectionLine);
                crossSectionMarkers.forEach(m => map.removeLayer(m));
                crossSectionMarkers = [];
            } else {
                this.classList.replace('bg-red-600', 'bg-purple-600');
                this.innerText = "📐 Corte";
                document.getElementById('map').style.cursor = '';
            }
        });

        if(cSel && dOpt) {
            if (selectedVar === 'r' || selectedVar === 'r2m') {
                dOpt.style.display = 'block';
                if (['continuous', 'discrete'].includes(cSel.value)) cSel.value = 'discrete';
            } else {
                dOpt.style.display = 'none';
                if (cSel.value === 'discrete') cSel.value = 'continuous';
            }
        }

        const variablesSoloSuperficie = ['t2m', 'tp', 'msl'];
        const variablesSoloNiveles = ['vo', 'd'];

        if(levelSelect && optgroupLevels && optgroupSfc) {
            if (variablesSoloSuperficie.includes(selectedVar)) {
                optgroupLevels.style.display = 'none';
                optgroupSfc.style.display = 'block';
                levelSelect.value = 'surface';
                levelSelect.disabled = true;
                levelSelect.classList.add('opacity-50', 'cursor-not-allowed');
            }
            else if (variablesSoloNiveles.includes(selectedVar)) {
                optgroupLevels.style.display = 'block';
                optgroupSfc.style.display = 'none';
                levelSelect.disabled = false;
                levelSelect.classList.remove('opacity-50', 'cursor-not-allowed');
                if (levelSelect.value === 'surface') levelSelect.value = '0';
            }
            else {
                optgroupLevels.style.display = 'block';
                optgroupSfc.style.display = 'block';
                levelSelect.disabled = false;
                levelSelect.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }
    });

    // Actualización manual de coordenadas desde el Modal de Corte
    document.getElementById('btn-update-coords')?.addEventListener('click', () => {
        let rawLatA = parseFloat(document.getElementById('input-lat-a').value);
        let rawLonA = parseFloat(document.getElementById('input-lon-a').value);
        let rawLatB = parseFloat(document.getElementById('input-lat-b').value);
        let rawLonB = parseFloat(document.getElementById('input-lon-b').value);

        if (isNaN(rawLatA) || isNaN(rawLonA) || isNaN(rawLatB) || isNaN(rawLonB)) {
            alert("Por favor, ingresa coordenadas numéricas válidas.");
            return;
        }

        let result = ordenarPuntos(rawLatA, rawLonA, rawLatB, rawLonB);
        let p1 = result.p1;
        let p2 = result.p2;

        if (result.swapped) {
            document.getElementById('input-lat-a').value = p1.lat.toFixed(2);
            document.getElementById('input-lon-a').value = p1.lng.toFixed(2);
            document.getElementById('input-lat-b').value = p2.lat.toFixed(2);
            document.getElementById('input-lon-b').value = p2.lng.toFixed(2);
        }

        if (!limitesData.contains(p1) || !limitesData.contains(p2)) {
            alert("Las coordenadas ingresadas están fuera del dominio meteorológico.");
            return;
        }

        crossSectionPoints = [p1, p2];

        if (crossSectionLine) map.removeLayer(crossSectionLine);
        crossSectionMarkers.forEach(m => map.removeLayer(m));
        crossSectionMarkers = [];

        crossSectionMarkers.push(L.circleMarker(p1, { radius: 5, color: '#9333ea', fillColor: '#a855f7', fillOpacity: 1 }).addTo(map));
        crossSectionMarkers.push(L.circleMarker(p2, { radius: 5, color: '#9333ea', fillColor: '#a855f7', fillOpacity: 1 }).addTo(map));
        crossSectionLine = L.polyline(crossSectionPoints, { color: '#9333ea', weight: 4, dashArray: '8, 8' }).addTo(map);

        let tiempoActualModal = document.getElementById('corte-time-slider').value;
        procesarCorteTransversal(p1, p2, tiempoActualModal);
    });

    // Slider interno del Corte
    document.getElementById('corte-time-slider')?.addEventListener('input', (e) => {
        let horasAgregadas = e.target.value * 3;
        if(document.getElementById('corte-time-display-date')) {
            document.getElementById('corte-time-display-date').innerText = formatForecastDate(fechaActual, horasAgregadas);
            document.getElementById('corte-time-display-offset').innerText = `+${horasAgregadas}h`;
        }
    });

    document.getElementById('corte-time-slider')?.addEventListener('change', (e) => {
        if (crossSectionPoints.length === 2) {
            procesarCorteTransversal(crossSectionPoints[0], crossSectionPoints[1], e.target.value);
        }
    });

    // Constructor Paletas (Si existe en UI)
    document.getElementById('btn-add-stop')?.addEventListener('click', () => {
        let div = document.createElement('div');
        div.className = 'flex gap-2 items-center stop-row';
        div.innerHTML = `<input type="number" value="50" class="stop-val w-16 bg-slate-900 border border-slate-600 rounded px-1 py-1 text-xs"><input type="color" value="#00ff00" class="stop-color w-full h-6 bg-transparent border-0 cursor-pointer"><button class="btn-remove-stop text-red-400 hover:text-red-300 font-bold">&times;</button>`;
        document.getElementById('custom-stops-container').appendChild(div);
        div.querySelector('.btn-remove-stop').addEventListener('click', function() { this.parentElement.remove(); });
    });
    document.querySelectorAll('.btn-remove-stop').forEach(btn => btn.addEventListener('click', function() { this.parentElement.remove(); }));

    document.getElementById('btn-apply-custom')?.addEventListener('click', () => {
        let minV = parseFloat(document.getElementById('custom-min').value);
        let maxV = parseFloat(document.getElementById('custom-max').value);
        if (isNaN(minV) || isNaN(maxV) || minV >= maxV) return alert('Rango inválido.');

        let rawStops = [];
        document.querySelectorAll('.stop-row').forEach(row => {
            let val = parseFloat(row.querySelector('.stop-val').value);
            let hex = row.querySelector('.stop-color').value;
            let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            let rgb = result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
            if (!isNaN(val) && rgb) {
                let t = Math.max(0, Math.min(1, (val - minV) / (maxV - minV)));
                rawStops.push({ val, t, r: rgb.r, g: rgb.g, b: rgb.b, hex });
            }
        });

        if (rawStops.length < 2) return alert('Mínimo 2 paradas.');
        rawStops.sort((a, b) => a.val - b.val);

        window.customPaletteMin = minV;
        window.customPaletteMax = maxV;
        window.customPaletteStops = rawStops;

        let gStr = 'linear-gradient(to right';
        rawStops.forEach(s => gStr += `, ${s.hex} ${Math.round(s.t * 100)}%`);
        gStr += ')';

        if(document.querySelector('#colorbar-container div')) {
            document.querySelector('#colorbar-container div').style.background = gStr;
        }
        if(document.getElementById('cb-min')) document.getElementById('cb-min').innerText = minV + '%';
        if(document.getElementById('cb-max')) document.getElementById('cb-max').innerText = maxV + '%';

        if (currentBaseArray) {
            let variableName = document.getElementById('var-select').value;
            renderizarCalor(currentBaseArray, variableName);
        }
    });

});

// Exponer funciones globales necesarias para onclick en HTML
window.cerrarCorte = function() {
    document.getElementById('modal-corte').classList.add('hidden');
    if (crossSectionAnimId) cancelAnimationFrame(crossSectionAnimId);
};
window.abrirModalNiveles = function() {
    let m = document.getElementById('modal-niveles');
    if(m) m.classList.remove('hidden');
};
window.cerrarModalNiveles = function() {
    let m = document.getElementById('modal-niveles');
    if(m) m.classList.add('hidden');
};
