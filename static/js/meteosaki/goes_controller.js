// static/js/meteosaki/goes_controller.js
import { state, GOES_PATHS, GOES_SETTINGS, GOES_CHANNELS_CFG } from './config.js';
import { map, getRoadPopupHtml, hasRoadNear } from './mapa.js';
import { openZarrMeta, loadGlmJson, getViewportSlice, prefetchFrames } from './goes_datos.js';
import { SatelliteRenderer } from './goes_render.js';
import { createRiversLayer, loadRiversGeoJson, getAcColor } from './rios.js';

let goesRenderer = null;
let saZarr = null;
let peruZarr = null;
let glmData = {};
let lastSaSlice = null;
let lastPeruSlice = null;
let goesRenderToken = 0;
let isGoesInitialized = false;
let isRiversInitialized = false;

let riversLayer = null;
let basinsLayer = null;

// ==========================================
// 1. CAPAS LEAFLET (SATÉLITE Y RAYOS GLM)
// ==========================================
function createGoesSatelliteLayer(renderer) {
    const GoesCanvasLayer = L.Layer.extend({
        onAdd(m) {
            this._map = m;
            this._canvas = renderer.canvas;
            this._canvas.className = "leaflet-layer leaflet-zoom-animated";
            this._canvas.style.pointerEvents = "none";
            m.getPane("goesPane").appendChild(this._canvas);
            m.on("move zoom viewreset resize", this._syncPosition, this);
            m.on("zoomanim", this._animateZoom, this);
            this._syncPosition();
        },
        onRemove(m) {
            L.DomUtil.remove(this._canvas);
            m.off("move zoom viewreset resize", this._syncPosition, this);
            m.off("zoomanim", this._animateZoom, this);
        },
        _animateZoom(e) {
            const scale = this._map.getZoomScale(e.zoom);
            const offset = this._map._latLngBoundsToNewLayerBounds(this._map.getBounds(), e.zoom, e.center).min;
            L.DomUtil.setTransform(this._canvas, offset, scale);
        },
        _syncPosition() {
            const size = this._map.getSize();
            const topLeft = this._map.containerPointToLayerPoint([0, 0]);
            L.DomUtil.setPosition(this._canvas, topLeft);
            renderer.resize(size.x, size.y);
        },
    });
    return new GoesCanvasLayer();
}

function createLightningLayer() {
    const LightningLayer = L.Layer.extend({
        onAdd(m) {
            this._map = m;
            this._canvas = L.DomUtil.create("canvas", "leaflet-layer");
            this._canvas.style.pointerEvents = "none";
            m.getPane("glmPane").appendChild(this._canvas);
            m.on("move zoom viewreset resize", this._reset, this);
            this._reset();
            this._animate();
        },
        onRemove(m) {
            cancelAnimationFrame(this._raf);
            L.DomUtil.remove(this._canvas);
            m.off("move zoom viewreset resize", this._reset, this);
        },
        _reset() {
            const size = this._map.getSize();
            const topLeft = this._map.containerPointToLayerPoint([0, 0]);
            L.DomUtil.setPosition(this._canvas, topLeft);
            this._canvas.width = size.x;
            this._canvas.height = size.y;
        },
        _animate() {
            const ctx = this._canvas.getContext("2d");
            ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

            if (state.goesVar !== 'none' && state.showGLM && state.activeFlashes.length > 0) {
                const now = performance.now() / 1000;
                const zoomScale = Math.pow(1.75, this._map.getZoom() - 7);
                ctx.globalCompositeOperation = "lighter";

                for (const f of state.activeFlashes) {
                    const cycle = (now * f.speed + f.phase) % 1.0;
                    if (cycle > 0.22) continue;

                    const t = cycle / 0.22;
                    const intensity = t < 0.4
                        ? Math.sin((t / 0.4) * Math.PI)
                        : 0.65 * Math.sin(((t - 0.4) / 0.6) * Math.PI);

                    const pt = this._map.latLngToContainerPoint([f.lat, f.lon]);
                    const r = Math.max(2.5, f.size * zoomScale * (0.6 + 0.6 * intensity));

                    const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r * 1.2);
                    grad.addColorStop(0.0, `rgba(255, 255, 255, ${intensity})`);
                    grad.addColorStop(0.25, `rgba(255, 255, 210, ${0.85 * intensity})`);
                    grad.addColorStop(0.55, `rgba(167, 139, 250, ${0.45 * intensity})`);
                    grad.addColorStop(1.0, "rgba(124, 58, 237, 0)");

                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    for (let i = 0; i < f.verts.length; i++) {
                        const vx = pt.x + f.verts[i][0] * r;
                        const vy = pt.y + f.verts[i][1] * r;
                        if (i === 0) ctx.moveTo(vx, vy);
                        else ctx.lineTo(vx, vy);
                    }
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.globalCompositeOperation = "source-over";
            }
            this._raf = requestAnimationFrame(() => this._animate());
        },
    });
    return new LightningLayer();
}

function buildFlashes(pts) {
    return pts.map(([lon, lat]) => {
        const numVerts = 7 + Math.floor(Math.random() * 5);
        const stretchX = 0.65 + Math.random() * 0.75;
        const stretchY = 0.65 + Math.random() * 0.75;
        const angleOffset = Math.random() * Math.PI * 2;
        const verts = [];
        for (let i = 0; i < numVerts; i++) {
            const ang = angleOffset + (i / numVerts) * Math.PI * 2;
            const rad = 0.4 + Math.random() * 0.8;
            verts.push([Math.cos(ang) * rad * stretchX, Math.sin(ang) * rad * stretchY]);
        }
        return {
            lat, lon,
            phase: Math.random(),
            speed: 0.15 + Math.random() * 0.25,
            size: 10 + Math.random() * 7,
            verts,
        };
    });
}

// ==========================================
// 2. SINCRONIZACIÓN TEMPORAL (GOES <-> MODELO)
// ==========================================
function parseModelBaseMs(baseDateStr) {
    const str = String(baseDateStr || "").replace(/\D/g, "");
    if (str.length < 10) return null;
    const year = parseInt(str.substring(0, 4), 10);
    const month = parseInt(str.substring(4, 6), 10) - 1;
    const day = parseInt(str.substring(6, 8), 10);
    const hour = parseInt(str.substring(8, 10), 10);
    return Date.UTC(year, month, day, hour, 0, 0);
}

/**
 * Construye la línea de tiempo sincronizada:
 * - Inicio: max(inicio_GOES, inicio_Modelo)
 * - Fin: min(fin_GOES, fin_Modelo)
 * - Mapeo: Math.ceil((t_goes - t0_model) / 3h) -> estado medio de las 3h previas
 */
export function buildSyncedFrames(maxModelIdx = 40) {
    if (!saZarr || !saZarr.timeKeys.length) {
        state.syncedFrames = [];
        return [];
    }

    const t0Ms = parseModelBaseMs(state.fechaActual);
    const THREE_HOURS_MS = 3 * 3600 * 1000;
    const modelEndMs = t0Ms !== null ? t0Ms + maxModelIdx * THREE_HOURS_MS : Infinity;

    const synced = [];
    saZarr.timeKeys.forEach((tKey, goesIdx) => {
        const tMs = Date.parse(tKey.endsWith("Z") ? tKey : `${tKey}Z`);
        if (Number.isNaN(tMs)) return;

        if (t0Ms !== null) {
            // Filtrar estrictamente a la ventana común sincronizada
            if (tMs < t0Ms || tMs > modelEndMs) return;
            const modelIdx = Math.max(0, Math.min(maxModelIdx, Math.ceil((tMs - t0Ms) / THREE_HOURS_MS)));
            synced.push({ tKey, tMs, goesIdx, modelIdx });
        } else {
            synced.push({ tKey, tMs, goesIdx, modelIdx: 0 });
        }
    });

    state.syncedFrames = synced;
    return synced;
}

// ==========================================
// 3. INICIALIZACIÓN Y RENDERIZADO GOES-19
// ==========================================
function redrawGoesFromMemory() {
    if (!goesRenderer || state.goesVar === 'none' || (!lastSaSlice && !lastPeruSlice)) return;
    const viewBounds = map.getBounds();
    const zoom = map.getZoom();
    const showPeru = peruZarr && lastPeruSlice && zoom >= GOES_SETTINGS.PERU_ZOOM_THRESHOLD && viewBounds.intersects(peruZarr.bounds);

    goesRenderer.clear();
    if (lastSaSlice) {
        goesRenderer.drawSlice(lastSaSlice, state.goesVar, viewBounds, 1.0, null, 0.0);
    }
    if (showPeru) {
        const pBox = [peruZarr.lonMin, peruZarr.lonMax, peruZarr.latMin, peruZarr.latMax];
        goesRenderer.drawSlice(lastPeruSlice, state.goesVar, viewBounds, 1.0, pBox, 0.8);
    }
}

export async function initGoesSystem() {
    if (isGoesInitialized) return true;
    try {
        goesRenderer = new SatelliteRenderer();
        createGoesSatelliteLayer(goesRenderer).addTo(map);
        createLightningLayer().addTo(map);

        saZarr = await openZarrMeta(GOES_PATHS.ZARR_SA, "sa8km");
        state.goesTimeKeys = saZarr.timeKeys;

        try {
            peruZarr = await openZarrMeta(GOES_PATHS.ZARR_PERU, "peru2km");
        } catch (e) {
            console.warn("Perú 2 km no disponible, usando solo SA 8 km:", e);
        }

        glmData = await loadGlmJson(GOES_PATHS.GLM_JSON);

        map.on("move zoom", redrawGoesFromMemory);
        map.on("moveend zoomend", () => {
            if (state.goesVar !== 'none' && state.syncedFrames.length > 0) {
                const slider = document.getElementById('time-slider');
                const idx = slider ? Number(slider.value) : state.syncedFrames.length - 1;
                renderGoesFrame(idx).catch(console.error);
            }
        });

        isGoesInitialized = true;
        buildSyncedFrames();
        return true;
    } catch (err) {
        console.error("Error inicializando GOES-19:", err);
        return false;
    }
}

export async function renderGoesFrame(syncedIdx) {
    if (state.goesVar === 'none') {
        clearGoesCanvas();
        return;
    }
    if (!isGoesInitialized) await initGoesSystem();
    if (!state.syncedFrames.length) return;

    const frame = state.syncedFrames[Math.max(0, Math.min(syncedIdx, state.syncedFrames.length - 1))];
    if (!frame) return;

    const myToken = ++goesRenderToken;
    const viewBounds = map.getBounds();
    const zoom = map.getZoom();

    const peruIdx = peruZarr ? peruZarr.timeIndexMap.get(frame.tKey) : undefined;
    const showPeru = peruZarr && peruIdx !== undefined && zoom >= GOES_SETTINGS.PERU_ZOOM_THRESHOLD && viewBounds.intersects(peruZarr.bounds);
    const omitSa = showPeru && peruZarr.bounds.contains(viewBounds);

    const [saSlice, peruSlice] = await Promise.all([
        omitSa ? Promise.resolve(null) : getViewportSlice(saZarr, state.goesVar, frame.goesIdx, viewBounds),
        showPeru ? getViewportSlice(peruZarr, state.goesVar, peruIdx, viewBounds) : Promise.resolve(null),
    ]);

    if (myToken !== goesRenderToken || state.goesVar === 'none') return;

    if (!omitSa) lastSaSlice = saSlice;
    lastPeruSlice = peruSlice;
    redrawGoesFromMemory();

    state.activeFlashes = buildFlashes(glmData[frame.tKey] || []);

    prefetchFrames(saZarr, peruZarr, state.goesVar, frame.goesIdx, saZarr.timeKeys, viewBounds, zoom);
}

export function clearGoesCanvas() {
    if (goesRenderer) goesRenderer.clear();
    lastSaSlice = null;
    lastPeruSlice = null;
    state.activeFlashes = [];
}

// ==========================================
// 4. RÍOS AC, CUENCAS Y POPUP UNIFICADO (VÍAS + RÍOS)
// ==========================================
let basinsFeatures = [];
const MIN_POPUP_ZOOM = 4;

function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect = ((yi > lat) !== (yj > lat)) &&
            (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function pointInGeometry(lon, lat, geom) {
    if (!geom) return false;
    if (geom.type === 'Polygon') {
        if (!pointInRing(lon, lat, geom.coordinates[0])) return false;
        for (let i = 1; i < geom.coordinates.length; i++) {
            if (pointInRing(lon, lat, geom.coordinates[i])) return false;
        }
        return true;
    }
    if (geom.type === 'MultiPolygon') {
        return geom.coordinates.some((poly) => {
            if (!pointInRing(lon, lat, poly[0])) return false;
            for (let i = 1; i < poly.length; i++) {
                if (pointInRing(lon, lat, poly[i])) return false;
            }
            return true;
        });
    }
    return false;
}

function getBasinPopupHtml(latlng) {
    if (!state.showRivers || basinsFeatures.length === 0) return null;
    const { lng: lon, lat } = latlng;
    const feat = basinsFeatures.find((f) => pointInGeometry(lon, lat, f.geometry));
    if (!feat) return null;

    const { nombre, AC } = feat.properties;
    const color = getAcColor(Number(AC));
    const sign = Number(AC) > 0 ? "+" : "";
    return `
        <div style="font-size:12px; line-height:1.4;">
            <div style="font-weight:700; margin-bottom:3px;">🌊 ${nombre}</div>
            <div style="display:flex; align-items:center; gap:6px;">
                <span style="width:10px; height:10px; border-radius:50%; background:${color}; display:inline-block;"></span>
                <span>AC: <b>${sign}${AC}%</b></span>
            </div>
        </div>
    `;
}

// Listener único para Vías Críticas + Cuencas/Ríos (solo con zoom > 4)
map.on('click', (e) => {
    if (state.isSelectingCrossSection) return;
    if (map.getZoom() <= MIN_POPUP_ZOOM) return;
    if (!state.showRivers && !state.showRoads) return;

    const sections = [];
    const roadHtml = getRoadPopupHtml(e.latlng);
    if (roadHtml) sections.push(roadHtml);

    const basinHtml = getBasinPopupHtml(e.latlng);
    if (basinHtml) sections.push(basinHtml);

    if (sections.length === 0) return;

    L.popup({ closeButton: true, autoPan: false })
        .setLatLng(e.latlng)
        .setContent(sections.join('<hr style="margin:6px 0; border-color:#475569;">'))
        .openOn(map);
});

map.on('zoomend', () => {
    if (map.getZoom() <= MIN_POPUP_ZOOM) map.closePopup();
});

map.on('mousemove', (e) => {
    if (state.isSelectingCrossSection) return;
    const container = map.getContainer();

    if (map.getZoom() <= MIN_POPUP_ZOOM || (!state.showRivers && !state.showRoads)) {
        container.style.cursor = '';
        return;
    }

    const overRoad = state.showRoads && hasRoadNear(e.latlng, 22);
    const overBasin = !overRoad && state.showRivers && basinsFeatures.some((f) => pointInGeometry(e.latlng.lng, e.latlng.lat, f.geometry));

    container.style.cursor = (overRoad || overBasin) ? 'pointer' : '';
});

export async function initRiversSystem() {
    if (isRiversInitialized) return;
    state.riversData = await loadRiversGeoJson(GOES_PATHS.RIOS_GEOJSON);
    riversLayer = createRiversLayer(() => state).addTo(map);

    try {
        const res = await fetch(`${GOES_PATHS.CUENCAS_GEOJSON}?t=${Date.now()}`);
        if (res.ok) {
            const geojson = await res.json();
            basinsFeatures = geojson.features || [];
        }
    } catch (e) {
        console.warn("No se pudo cargar cuencas:", e);
    }
    isRiversInitialized = true;
}

export async function setRiversVisible(show) {
    state.showRivers = show;
    if (show && !isRiversInitialized) {
        await initRiversSystem();
    }
    if (riversLayer) riversLayer._rebuildPaths();
    if (!show) map.closePopup();
}

// ==========================================
// 5. COLORBAR GOES
// ==========================================
export function drawGoesColorbar(varName) {
    const wrap = document.getElementById("goes-colorbar-wrap");
    if (!wrap) return;
    if (!varName || varName === 'none') {
        wrap.classList.add("hidden");
        return;
    }
    const cfg = GOES_CHANNELS_CFG[varName];
    const canvas = document.getElementById("goes-colorbar-canvas");
    if (!cfg || !canvas) return;

    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(512, 8);
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 512; x++) {
            const dst = (y * 512 + x) * 4;
            const src = x * 4;
            img.data[dst]     = cfg.lut[src];
            img.data[dst + 1] = cfg.lut[src + 1];
            img.data[dst + 2] = cfg.lut[src + 2];
            img.data[dst + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    const minEl = document.getElementById("goes-cb-min");
    const maxEl = document.getElementById("goes-cb-max");
    if (minEl) minEl.innerText = cfg.ticks[0];
    if (maxEl) maxEl.innerText = cfg.ticks[cfg.ticks.length - 1];
    wrap.classList.remove("hidden");
}
