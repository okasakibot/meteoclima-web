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
    model:   'heatPane',
    goes:    'goesPane',
    wind:    'windPane',
    rivers:  'riversPane',
    roads:   'roadsPane',
    glm:     'glmPane',
    borders: 'bordersPane',
    labels:  'labelsPane',
};

Object.entries(LAYER_PANES).forEach(([key, paneName]) => {
    map.createPane(paneName);
    // Permitir clics en roadsPane para ver el popup del tramo
    map.getPane(paneName).style.pointerEvents = (key === 'roads') ? 'auto' : 'none';
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


let roadsLayer = null;
const roadsCanvasRenderer = L.canvas({ pane: 'roadsPane', padding: 0.5 });

export async function setRoadsVisible(visible) {
    state.showRoads = visible;
    if (visible && !roadsLayer) {
        try {
            const res = await fetch(GOES_PATHS.ROADS_GEOJSON);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const geojson = await res.json();

            roadsLayer = L.geoJSON(geojson, {
                pane: 'roadsPane',
                renderer: roadsCanvasRenderer,
                interactive: false, // El clic lo maneja el evento unificado del mapa
                style: (f) => {
                    const lvl = f.properties?.nivel || 1;
                    return {
                        color: lvl === 3 ? '#ef4444' : (lvl === 2 ? '#f97316' : '#facc15'),
                        weight: lvl === 3 ? 3.0 : (lvl === 2 ? 2.2 : 1.5),
                        opacity: 0.95,
                    };
                },
            });
        } catch (err) {
            console.error("Error cargando carreteras críticas:", err);
            return;
        }
    }

    if (!roadsLayer) return;
    if (visible) roadsLayer.addTo(map);
    else {
        map.removeLayer(roadsLayer);
        map.closePopup();
    }
}


// Busca el tramo vial más cercano al punto dentro de un radio real en píxeles
function findNearestRoad(latlng, maxDistPx = 30) {
    if (!state.showRoads || !roadsLayer) return null;

    const clickPt = map.latLngToContainerPoint(latlng);
    // Caja de búsqueda real en píxeles convertida a lat/lng
    const sw = map.containerPointToLatLng([clickPt.x - maxDistPx, clickPt.y + maxDistPx]);
    const ne = map.containerPointToLatLng([clickPt.x + maxDistPx, clickPt.y - maxDistPx]);
    const searchBounds = L.latLngBounds(sw, ne);

    let bestFeature = null;
    let bestDist = maxDistPx;

    roadsLayer.eachLayer((layer) => {
        if (!layer.getBounds || !layer.getBounds().intersects(searchBounds)) return;

        const latlngs = layer.getLatLngs();
        const lines = Array.isArray(latlngs[0]) ? latlngs : [latlngs];

        for (const line of lines) {
            for (let i = 0; i < line.length - 1; i++) {
                const p1 = map.latLngToContainerPoint(line[i]);
                const p2 = map.latLngToContainerPoint(line[i + 1]);
                const d = L.LineUtil.pointToSegmentDistance(clickPt, p1, p2);
                if (d < bestDist) {
                    bestDist = d;
                    bestFeature = layer.feature;
                }
            }
        }
    });

    return bestFeature;
}

export function hasRoadNear(latlng, maxDistPx = 22) {
    return findNearestRoad(latlng, maxDistPx) !== null;
}

export function getRoadPopupHtml(latlng, maxDistPx = 30) {
    const bestFeature = findNearestRoad(latlng, maxDistPx);
    if (!bestFeature) return null;

    const p = bestFeature.properties || {};
    const lvlTxt = p.nivel === 3 ? '🔴 Muy Alto' : (p.nivel === 2 ? '🟠 Alto' : '🟡 Moderado');

    return `
        <div style="font-size:12px; line-height:1.4;">
            <b>🛣️ Ruta ${p.ruta || 'S/N'}</b> (${p.red || ''})<br>
            <b>Dpto:</b> ${p.dpto || '-'}<br>
            <b>Criticidad:</b> ${lvlTxt}<br>
            <b>Eventos INGEMMET:</b> ${p.n_ev ?? 0}${p.tipo ? ` (${p.tipo})` : ''}<br>
            <b>Zona Crítica:</b> ${p.zc ? 'Sí' : 'No'} | <b>ANA:</b> ${p.ana ? 'Sí' : 'No'}
        </div>
    `;
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
