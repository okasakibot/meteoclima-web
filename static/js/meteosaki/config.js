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
    't2m': { min: -10, max: 40, unit: '°C', name: 'Temp a 2m', repo: 'data1' },
    'tp': { min: 0, max: 50, unit: ' mm/3h', name: 'Precipitación Total', repo: 'data1' },
    'msl': { min: 970, max: 1020, unit: ' hPa', name: 'Presión al Nivel del Mar', repo: 'data1' },
    'vo': { min: -1, max: 1, unit: ' 1/3h', name: 'Vorticidad relativa', repo: 'data2' },
    'd': { min: -1, max: 1, unit: ' 1/3h', name: 'Divergencia', repo: 'data2' },
    'r2m': { min: 0, max: 100, unit: '%', name: 'HR a 2m', repo: 'data2' },
    'q2m': { min: 0, max: 20, unit: ' g/kg', name: 'Humedad Específica a 2m', repo: 'data2' },
    'conv_q': { min: -8, max: 8, unit: ' (g/kg)/3h', name: 'Conv. de Humedad', repo: 'data2' },
    'adv_q': { min: -8, max: 8, unit: ' (g/kg)/3h', name: 'Adv. de Humedad', repo: 'data2' },
    'adv_t': { min: -8, max: 8, unit: ' °C/3h', name: 'Adv. de Temperatura', repo: 'data2' },
    'conv_q2m': { min: -8, max: 8, unit: ' (g/kg)/3h', name: 'Conv. HR (Sup)', repo: 'data2' },
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

    // Variables de Paleta Personalizada
    customPaletteStops: null,
    customPaletteMin: 0,
    customPaletteMax: 100
};
