import * as zarr from "https://esm.sh/zarrita";
import { GOES_SETTINGS as SETTINGS } from "./config.js";

const sliceCache = new Map();
const inFlight = new Map();

function decodeZarrTimes(timeArr, units) {
  const m = /([a-z]+)\s+since\s+(.+)/i.exec(units || "seconds since 1970-01-01 00:00:00");
  const unit = m ? m[1].toLowerCase() : "seconds";
  const baseMs = Date.parse((m ? m[2] : "1970-01-01T00:00:00").replace(" ", "T") + "Z");
  const mult = unit.startsWith("nano") ? 1e-6
             : unit.startsWith("micro") ? 1e-3
             : unit.startsWith("milli") ? 1
             : unit.startsWith("min") ? 60000
             : unit.startsWith("hour") ? 3600000
             : 1000;

  return Array.from(timeArr).map((v) => new Date(baseMs + Number(v) * mult).toISOString().slice(0, 19));
}

export async function openZarrMeta(url, id) {
  const store = new zarr.FetchStore(url);
  const root = await zarr.open.v3(store, { kind: "group" });

  const [latArr, lonArr, timeArr] = await Promise.all([
    zarr.open.v3(root.resolve("lat"),  { kind: "array" }),
    zarr.open.v3(root.resolve("lon"),  { kind: "array" }),
    zarr.open.v3(root.resolve("time"), { kind: "array" }),
  ]);

  const [lats, lons, times] = await Promise.all([
    zarr.get(latArr),
    zarr.get(lonArr),
    zarr.get(timeArr),
  ]);

  const latData = lats.data;
  const lonData = lons.data;
  const timeKeys = decodeZarrTimes(times.data, timeArr.attrs.units);
  const timeIndexMap = new Map();
  timeKeys.forEach((k, idx) => timeIndexMap.set(k, idx));

  return {
    id,
    root,
    arrays: {},
    latData,
    lonData,
    ny: latData.length,
    nx: lonData.length,
    latMin: latData[0],
    latMax: latData[latData.length - 1],
    lonMin: lonData[0],
    lonMax: lonData[lonData.length - 1],
    bounds: L.latLngBounds([[latData[0], lonData[0]], [latData[latData.length - 1], lonData[lonData.length - 1]]]),
    timeKeys,
    timeIndexMap,
  };
}

export async function loadGlmJson(url) {
  try {
    const res = await fetch(`${url}?t=${Date.now()}`);
    return res.ok ? await res.json() : {};
  } catch (e) {
    console.warn("No se pudo cargar GLM JSON:", e);
    return {};
  }
}

/**
 * Calcula los índices [y0, y1, x0, x1] del Zarr que intersectan el viewport actual.
 * Agrega un margen de 3 píxeles para que la interpolación bicúbica no corte bordes.
 */
function computeViewportIndices(meta, viewBounds) {
  const pad = 3;
  const s = Math.max(meta.latMin, viewBounds.getSouth());
  const n = Math.min(meta.latMax, viewBounds.getNorth());
  const w = Math.max(meta.lonMin, viewBounds.getWest());
  const e = Math.min(meta.lonMax, viewBounds.getEast());

  if (s >= n || w >= e) return null;

  const latSpan = meta.latMax - meta.latMin;
  const lonSpan = meta.lonMax - meta.lonMin;

  // Cuantizamos a bloques de 64 px para maximizar aciertos de caché al hacer pan suave
  const q = 64;
  let y0 = Math.floor(((s - meta.latMin) / latSpan) * (meta.ny - 1)) - pad;
  let y1 = Math.ceil(((n - meta.latMin) / latSpan) * (meta.ny - 1)) + pad + 1;
  let x0 = Math.floor(((w - meta.lonMin) / lonSpan) * (meta.nx - 1)) - pad;
  let x1 = Math.ceil(((e - meta.lonMin) / lonSpan) * (meta.nx - 1)) + pad + 1;

  y0 = Math.max(0, Math.floor(y0 / q) * q);
  x0 = Math.max(0, Math.floor(x0 / q) * q);
  y1 = Math.min(meta.ny, Math.ceil(y1 / q) * q);
  x1 = Math.min(meta.nx, Math.ceil(x1 / q) * q);

  return { y0, y1, x0, x1 };
}

function setCache(key, value) {
  if (sliceCache.has(key)) sliceCache.delete(key);
  sliceCache.set(key, value);
  if (sliceCache.size > SETTINGS.MAX_CACHE_ENTRIES) {
    const oldestKey = sliceCache.keys().next().value;
    sliceCache.delete(oldestKey);
  }
}

/**
 * Descarga (o devuelve desde RAM) únicamente el recorte visible del Zarr.
 */
export async function getViewportSlice(meta, varName, timeIdx, viewBounds) {
  const idx = computeViewportIndices(meta, viewBounds);
  if (!idx) return null;

  const key = `${meta.id}_${varName}_${timeIdx}_${idx.y0}_${idx.y1}_${idx.x0}_${idx.x1}`;
  if (sliceCache.has(key)) {
    const cached = sliceCache.get(key);
    setCache(key, cached); // Refrescar LRU
    return cached;
  }

  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    if (!meta.arrays[varName]) {
          meta.arrays[varName] = await zarr.open.v3(meta.root.resolve(varName), { kind: "array" });
        }
    const res = await zarr.get(meta.arrays[varName], [
      timeIdx,
      zarr.slice(idx.y0, idx.y1),
      zarr.slice(idx.x0, idx.x1),
    ]);

    const payload = {
      data: res.data,
      ny: res.shape[0],
      nx: res.shape[1],
      latMin: meta.latData[idx.y0],
      latMax: meta.latData[idx.y1 - 1],
      lonMin: meta.lonData[idx.x0],
      lonMax: meta.lonData[idx.x1 - 1],
    };
    setCache(key, payload);
    return payload;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Precarga silenciosamente los próximos frames en RAM para el viewport actual.
 */
export function prefetchFrames(saZarr, peruZarr, varName, currentIdx, timeKeys, viewBounds, zoom) {
  const showPeru = peruZarr && zoom >= SETTINGS.PERU_ZOOM_THRESHOLD && viewBounds.intersects(peruZarr.bounds);
  const omitSa = showPeru && peruZarr.bounds.contains(viewBounds);

  for (let step = 1; step <= SETTINGS.PREFETCH_AHEAD; step++) {
    const nextIdx = (currentIdx + step) % timeKeys.length;
    const nextKey = timeKeys[nextIdx];

    if (!omitSa) {
      getViewportSlice(saZarr, varName, nextIdx, viewBounds).catch(() => {});
    }
    if (showPeru) {
      const peruIdx = peruZarr.timeIndexMap.get(nextKey);
      if (peruIdx !== undefined) {
        getViewportSlice(peruZarr, varName, peruIdx, viewBounds).catch(() => {});
      }
    }
  }
}
