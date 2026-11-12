// static/js/mapa.js

import { state, limitesData } from './config.js';

// ==========================================
// 1. INICIALIZACIÓN DE LEAFLET
// ==========================================
export const map = L.map('map', {
    maxBounds: limitesData,
    maxBoundsViscosity: 1.0,
    zoomSnap: 0,
    zoomDelta: 0.5,
    attributionControl: false
});

// Orden estricto de dibujado (z-index) para garantizar que las etiquetas 
// y los vientos no queden ocultos debajo del mapa de calor
map.createPane('heatPane');
map.getPane('heatPane').style.zIndex = 250;
map.createPane('windPane');
map.getPane('windPane').style.zIndex = 260;
map.createPane('labelsPane');
map.getPane('labelsPane').style.zIndex = 270;
map.getPane('labelsPane').style.pointerEvents = 'none'; // Evita que interfiera con los clics del mapa

map.fitBounds(limitesData);

// ==========================================
// 2. LÓGICA DE ENCUADRE RESPONSIVO
// ==========================================
export function encuadrarModoCover() {
    const mapSize = map.getSize();
    if (mapSize.x === 0 || mapSize.y === 0) return;
    
    const nw = map.project(limitesData.getNorthWest(), 0);
    const se = map.project(limitesData.getSouthEast(), 0);
    const boundsSize = L.point(Math.abs(se.x - nw.x), Math.abs(se.y - nw.y));
    
    // Calculamos el zoom mínimo para que el bounding box siempre cubra toda la pantalla
    const scaleCover = Math.max(mapSize.x / boundsSize.x, mapSize.y / boundsSize.y);
    const minCoverZoom = Math.log(scaleCover) / Math.LN2;
    
    map.setMinZoom(minCoverZoom);
    if (map.getZoom() < minCoverZoom) {
        map.setView(limitesData.getCenter(), minCoverZoom);
    }
}

// Ejecutamos el encuadre cuando el mapa carga y cada vez que cambia el tamaño de la ventana
map.whenReady(() => encuadrarModoCover());
window.addEventListener('resize', () => setTimeout(encuadrarModoCover, 100));

// ==========================================
// 3. GESTIÓN DE MAPAS BASE
// ==========================================
export function cargarMapaBase(tipo) {
    // Si ya existe una capa base, la removemos para no sobrecargar la memoria
    if (state.currentBaseMapLayer) map.removeLayer(state.currentBaseMapLayer);
    if (state.currentLabelsLayer) map.removeLayer(state.currentLabelsLayer);
    state.currentLabelsLayer = null;

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
        // Esta opción trae una capa adicional solo con textos de referencia política y ciudades
        let urlLabels = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}';
        state.currentLabelsLayer = L.tileLayer(urlLabels, { 
            maxZoom: 19, 
            pane: 'labelsPane', 
            className: 'bright-labels'
        }).addTo(map);
    } else if (tipo === 'terrain-stamen') {
        url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}';
    }

    // Guardamos la referencia de la nueva capa en el estado global
    state.currentBaseMapLayer = L.tileLayer(url, mapOptions).addTo(map);
}