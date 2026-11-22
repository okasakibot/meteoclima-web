// static/js/meteosaki/mapa.js

import { state, limitesData, GOES_PATHS } from './config.js';

// ==========================================
// 1. INICIALIZACIÓN DE LEAFLET Y PANES
// ==========================================
export const map = L.map('map', {
    maxBounds: limitesData,
    maxBoundsViscosity: 1.0,
    zoomSnap: 0,
    zoomDelta: 0.5,
    attributionControl: false
});

// Mapa de ID lógico -> nombre del pane en Leaflet
export const LAYER_PANES = {
    model:   'heatPane',    // Mantiene compatibilidad con ForecastRenderer
    goes:    'goesPane',
    wind:    'windPane',
    rivers:  'riversPane',
    glm:     'glmPane',
    borders: 'bordersPane',
    labels:  'labelsPane',
};

Object.values(LAYER_PANES).forEach((paneName) => {
    map.createPane(paneName);
    map.getPane(paneName).style.pointerEvents = 'none';
});

export function applyLayerStyles() {
    // Recorre layerOrder de arriba (índice 0) hacia abajo
    const total = state.layerOrder.length;
    state.layerOrder.forEach((layerId, idx) => {
        const pane = map.getPane(LAYER_PANES[layerId]);
        if (!pane) return;
        pane.style.zIndex = 250 + (total - idx) * 10;
        pane.style.opacity = String(state.layerOpacity[layerId] ?? 1.0);
    });
}

applyLayerStyles();
map.fitBounds(limitesData);

// ==========================================
// 2. ENCUADRE RESPONSIVO
// ==========================================
export function encuadrarModoCover() {
    const mapSize = map.getSize();
    if (mapSize.x === 0 || mapSize.y === 0) return;

    const nw = map.project(limitesData.getNorthWest(), 0);
    const se = map.project(limitesData.getSouthEast(), 0);
    const boundsSize = L.point(Math.abs(se.x - nw.x), Math.abs(se.y - nw.y));

    const scaleCover = Math.max(mapSize.x / boundsSize.x, mapSize.y / boundsSize.y);
    const minCoverZoom = Math.log(scaleCover) / Math.LN2;

    map.setMinZoom(minCoverZoom);
    if (map.getZoom() < minCoverZoom) {
        map.setView(limitesData.getCenter(), minCoverZoom);
    }
}

map.whenReady(() => encuadrarModoCover());
window.addEventListener('resize', () => setTimeout(encuadrarModoCover, 100));

// ==========================================
// 3. MAPAS BASE, FRONTERAS Y ETIQUETAS INDEPENDIENTES
// ==========================================
let bordersLayer = null;
const LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}';

export function initBordersLayer() {
    fetch(GOES_PATHS.BORDERS_GEOJSON)
        .then((r) => r.json())
        .then((geojson) => {
            bordersLayer = L.geoJSON(geojson, {
                pane: 'bordersPane',
                style: { color: '#ffffff', weight: 0.9, opacity: 1.0, fill: false },
            });
            if (state.showBorders) bordersLayer.addTo(map);
        })
        .catch((e) => console.warn("No se pudieron cargar fronteras:", e));
}

export function setBordersVisible(visible) {
    state.showBorders = visible;
    if (!bordersLayer) return;
    if (visible) bordersLayer.addTo(map);
    else map.removeLayer(bordersLayer);
}

export function setLabelsVisible(visible) {
    state.showLabels = visible;
    if (visible) {
        if (!state.currentLabelsLayer) {
            state.currentLabelsLayer = L.tileLayer(LABELS_URL, {
                maxZoom: 19,
                pane: 'labelsPane',
                className: 'bright-labels',
            });
        }
        state.currentLabelsLayer.addTo(map);
    } else if (state.currentLabelsLayer) {
        map.removeLayer(state.currentLabelsLayer);
    }
}

export function cargarMapaBase(tipo = 'satellite1') {
    if (state.currentBaseMapLayer) map.removeLayer(state.currentBaseMapLayer);

    let url = '';
    let mapOptions = { maxZoom: 19 };

    if (tipo === 'osm') {
        url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    } else if (tipo === 'dark') {
        url = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    } else if (tipo === 'satellite2') {
        url = 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'; // Solo satélite sin etiquetas
        mapOptions.subdomains = ['0', '1', '2', '3'];
        mapOptions.updateWhenIdle = true;
        mapOptions.keepBuffer = 4;
    } else if (tipo === 'terrain-stamen') {
        url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}';
    } else {
        // Por defecto: Esri Only Satellite
        url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    }

    state.currentBaseMapLayer = L.tileLayer(url, mapOptions).addTo(map);
}

initBordersLayer();
