// static/js/config.js

// ==========================================
// 1. INICIALIZACIÓN DE FIREBASE
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export const firebaseConfig = {
    apiKey: "AIzaSyCt-F47o7avnEJx6_WuBX0EO845FTiROWo",
    authDomain: "meteoclima-lab.firebaseapp.com",
    projectId: "meteoclima-lab"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const provider = new GoogleAuthProvider();

// ==========================================
// 2. CONSTANTES GEOGRÁFICAS Y DE RESOLUCIÓN
// ==========================================
export const latInicio = -57.0;
export const latFin = 13.0;
export const lonInicio = -110.0;
export const lonFin = -10.0;
export const dx = 0.25;
export const dy = 0.25;

export const width = Math.round((lonFin - lonInicio) / dx) + 1;
export const height = Math.round((latFin - latInicio) / dy) + 1;

export const latSurBorde = latInicio - (dy / 2.0);
export const latNorteBorde = latFin + (dy / 2.0);
export const lonOesteBorde = lonInicio - (dx / 2.0);
export const lonEsteBorde = lonFin + (dx / 2.0);

// Esta constante asume que Leaflet (L) se cargó globalmente en el HTML vía <script>
export const limitesData = L.latLngBounds([[latSurBorde, lonOesteBorde], [latNorteBorde, lonEsteBorde]]);

// ==========================================
// 3. DICCIONARIOS ESTÁTICOS
// ==========================================
export const escalas = {
    'r': { min: 0, max: 100, unit: '%', name: 'Humedad Relativa', repo: 'data1' },
    'w': { min: 0, max: 40, unit: ' m/s', name: 'Velocidad del Viento', repo: 'data1' },
    'q': { min: 0, max: 20, unit: ' g/kg', name: 'Humedad Específica', repo: 'data1' },
    't2m': { min: -10, max: 40, unit: '°C', name: 'Temp a 2m', repo: 'data2' },
    'tp': { min: 0, max: 20, unit: ' mm/3h', name: 'Precipitación Total', repo: 'data1' },
    'msl': { min: 970, max: 1020, unit: ' hPa', name: 'Presión al Nivel del Mar', repo: 'data1' },
    'vo': { min: -1, max: 1, unit: ' /3h', name: 'Vorticidad relativa', repo: 'data1' },
    'd': { min: -1, max: 1, unit: ' /3h', name: 'Divergencia', repo: 'data1' },
    'z': { min: 0, max: 6000, unit: ' hPa', name: 'Elevación', repo: 'data1' },
    'r2m': { min: 0, max: 100, unit: '%', name: 'HR a 2m', repo: 'data2' },
    'q2m': { min: 0, max: 20, unit: ' g/kg', name: 'Humedad Específica a 2m', repo: 'data2' },
    'conv_q': { min: -8, max: 8, unit: ' (g/kg)/3h', name: 'Conv. de Humedad', repo: 'data2' },
    'adv_q': { min: -8, max: 8, unit: ' (g/kg)/3h', name: 'Adv. de Humedad', repo: 'data2' },
    'adv_t': { min: -8, max: 8, unit: ' °C/3h', name: 'Adv. de Temperatura', repo: 'data2' },
    'conv_q2m': { min: -8, max: 8, unit: ' (g/kg)/3h', name: 'Conv. HR (Sup)', repo: 'data1' },
    'adv_q2m': { min: -8, max: 8, unit: ' (g/kg)/3h', name: 'Adv. HR (Sup)', repo: 'data2' },
    'adv_t2m': { min: -8, max: 8, unit: ' °C/3h', name: 'Adv. Temp (Sup)', repo: 'data2' }
};

export const traductorSuperficie = {
    'r': 'r2m', 'q': 'q2m', 'u': 'u10', 'v': 'v10',
    'conv_q': 'conv_q2m', 'adv_q': 'adv_q2m', 'adv_t': 'adv_t2m'
};

// ==========================================
// 4. ESTADO GLOBAL DINÁMICO (MUTEABLE)
// ==========================================
export const state = {
    // Autenticación y Criptografía
    cryptoKey: null,
    fechaActual: "",

    // Configuración y Capas del Mapa
    isWindActive: true,
    windLayer: null,
    heatLayer: null,
    currentBaseMapLayer: null,
    currentLabelsLayer: null,

    // Arrays de Datos Temporales
    currentBaseArray: null,
    currentUArray: null,
    currentVArray: null,

    // Interacción de Corte Transversal
    isSelectingCrossSection: false,
    crossSectionPoints: [],
    crossSectionLine: null,
    crossSectionMarkers: [],
    crossSectionAnimId: null,
    crossSectionParticles: [],
    isCrossSectionWindActive: true,
    crossSectionWindSpeed: 1.0,
    crossSectionHrOpacity: 1.0,

    // Variables de Paleta Personalizada
    customPaletteStops: null,
    customPaletteMin: 0,
    customPaletteMax: 100,

    // Capas GOES-19, Rayos, Ríos y Etiquetas
    goesVar: 'none',          // 'none' | 'ir' | 'wv'
    showGLM: false,
    showRivers: false,
    showRoads: false,
    showBorders: true,
    showLabels: false,
    activeFlashes: [],
    riversData: null,

    // Sincronización temporal (GOES <-> Modelo)
    goesTimeKeys: [],
    syncedFrames: [],         // [{ tKey, tMs, modelIdx }]
    lastModelIdx: null,

    // Gestor de capas (de arriba hacia abajo)
    layerOrder: ['labels', 'borders', 'glm', 'roads', 'rivers', 'wind', 'goes', 'model'],
    layerOpacity: {
        labels: 1.0,
        borders: 0.75,
        glm: 1.0,
        roads: 0.95,
        rivers: 1.0,
        wind: 1.0,
        goes: 0.94,
        model: 0.70,
    },
};

// ==========================================
// 5. CONFIGURACIÓN GOES-19 Y RÍOS
// ==========================================
const DATA3_BASE = "https://raw.githubusercontent.com/okasakibot/meteoclima-data3/main";

export const GOES_PATHS = {
    ZARR_SA: `${DATA3_BASE}/goes19_sa_8km_latest.zarr`,
    ZARR_PERU: `${DATA3_BASE}/goes19_peru_2km_latest.zarr`,
    GLM_JSON: `${DATA3_BASE}/goes19_glm_latest.json`,
    RIOS_GEOJSON: `${DATA3_BASE}/rios_ac_latest.geojson`,
    CUENCAS_GEOJSON: `${DATA3_BASE}/cuencas_ac_latest.geojson`,
    ROADS_GEOJSON: `${DATA3_BASE}/carreteras_criticas_peru.geojson`,
    ALERTS_JSON: `${DATA3_BASE}/alertas_latest.json`,
    BORDERS_GEOJSON: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
};

export const GOES_SETTINGS = {
    PERU_ZOOM_THRESHOLD: 6,
    MAX_CACHE_ENTRIES: 80,
    PREFETCH_AHEAD: 2,
};

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function buildGoesLUT(stops, vmin, vmax, size = 512) {
    const lut = new Uint8Array(size * 4);
    const normStops = stops.map(([val, hex]) => [
        Math.max(0, Math.min(1, (val - vmin) / (vmax - vmin))),
        hexToRgb(hex),
    ]);
    for (let i = 0; i < size; i++) {
        const t = i / (size - 1);
        let j = 0;
        while (j < normStops.length - 2 && t > normStops[j + 1][0]) j++;
        const [t0, c0] = normStops[j];
        const [t1, c1] = normStops[j + 1];
        const f = t1 === t0 ? 0 : Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
        lut[i * 4]     = Math.round(c0[0] + (c1[0] - c0[0]) * f);
        lut[i * 4 + 1] = Math.round(c0[1] + (c1[1] - c0[1]) * f);
        lut[i * 4 + 2] = Math.round(c0[2] + (c1[2] - c0[2]) * f);
        lut[i * 4 + 3] = 255;
    }
    return lut;
}

export const GOES_CHANNELS_CFG = {
    wv: {
        name: "WV Medios (C09)",
        vmin: -90,
        vmax: 15,
        ticks: ["-90°C", "-70°C", "-50°C", "-30°C", "-15°C", "0°C", "+15°C"],
        lut: buildGoesLUT([
            [-90, "#a855f7"], [-82, "#e879f9"], [-75, "#f9a8d4"],
            [-74.5, "#14532d"], [-67, "#16a34a"], [-60, "#86efac"],
            [-59.5, "#1e1b4b"], [-52, "#3b82f6"], [-45, "#ffffff"],
            [-32, "#8c8c8c"], [-18, "#3b3b3b"], [-17.5, "#451a03"],
            [-12, "#b45309"], [-7, "#f59e0b"], [-3, "#dc2626"],
            [5, "#7f1d1d"], [15, "#1c1917"],
        ], -90, 15),
    },
    ir: {
        name: "IR Limpio (C13)",
        vmin: -90,
        vmax: 50,
        ticks: ["-90°C", "-70°C", "-50°C", "-30°C", "-10°C", "+15°C", "+50°C"],
        lut: buildGoesLUT([
            [-90, "#6b21a8"], [-82, "#c084fc"], [-79.5, "#f43f5e"],
            [-70, "#ef4444"], [-69.5, "#1e3a8a"], [-62, "#0284c7"],
            [-55, "#38bdf8"], [-54.5, "#15803d"], [-47, "#22c55e"],
            [-40, "#facc15"], [-32, "#f97316"], [-20, "#dc2626"],
            [-10, "#451a03"], [-9.5, "#9ca3af"], [15, "#4b5563"],
            [50, "#0a0a0a"],
        ], -90, 50),
    },
};
