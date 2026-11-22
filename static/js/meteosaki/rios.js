/**
 * Paleta oficial de Anomalía de Caudal AC (%) — SENAMHI
 */
export function getAcColor(ac) {
  if (ac < -50) return "#ea580c"; // Muy por debajo (-100 a -50)
  if (ac < -25) return "#facc15"; // Debajo (-50 a -25)
  if (ac <= 25) return "#94a3b8"; // Normal (-25 a 25)
  if (ac <= 50) return "#84cc16"; // Sobre lo normal (25 a 50)
  if (ac <= 100) return "#06b6d4"; // Muy sobre lo normal (50 a 100)
  return "#16a34a";                // Alto (> 100)
}

/**
 * Carga el GeoJSON de ríos y precalcula el bounding box de cada segmento
 * para descartar rápidamente los que quedan fuera de pantalla.
 */
export async function loadRiversGeoJson(url) {
  try {
    const res = await fetch(`${url}?t=${Date.now()}`);
    if (!res.ok) return [];
    const geojson = await res.json();

    const segments = [];
    for (const feat of geojson.features || []) {
      const geom = feat.geometry;
      if (!geom || geom.type !== "LineString" || geom.coordinates.length < 2) continue;

      const coords = geom.coordinates;
      let minLon = Infinity, maxLon = -Infinity;
      let minLat = Infinity, maxLat = -Infinity;

      for (const [lon, lat] of coords) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }

      const ac = Number(feat.properties?.AC ?? 0);
      const order = Number(feat.properties?.order_ ?? 1);

      segments.push({
        coords,
        ac,
        order,
        color: getAcColor(ac),
        bbox: { minLon, maxLon, minLat, maxLat },
      });
    }
    return segments;
  } catch (e) {
    console.warn("No se pudo cargar GeoJSON de ríos:", e);
    return [];
  }
}

/**
 * Orden mínimo de Strahler visible según el nivel de zoom.
 */
function getMinOrderForZoom(zoom) {
  if (zoom < 6) return 4;
  if (zoom < 7) return 3;
  if (zoom < 8) return 2;
  return 1;
}

/**
 * Capa Leaflet Canvas 2D con animación de flujo aguas abajo.
 */
export function createRiversLayer(getState) {
  const RiversLayer = L.Layer.extend({
    onAdd(map) {
      this._map = map;
      this._canvas = L.DomUtil.create("canvas", "leaflet-layer leaflet-zoom-animated");
      this._canvas.style.pointerEvents = "none";
      map.getPane("riversPane").appendChild(this._canvas);

      this._buckets = [];
      map.on("move zoom viewreset resize", this._rebuildPaths, this);
      map.on("zoomanim", this._animateZoom, this);

      this._rebuildPaths();
      this._animate();
    },

    onRemove(map) {
      cancelAnimationFrame(this._raf);
      L.DomUtil.remove(this._canvas);
      map.off("move zoom viewreset resize", this._rebuildPaths, this);
      map.off("zoomanim", this._animateZoom, this);
    },

    _animateZoom(e) {
      const scale = this._map.getZoomScale(e.zoom);
      const offset = this._map._latLngBoundsToNewLayerBounds(
        this._map.getBounds(),
        e.zoom,
        e.center
      ).min;
      L.DomUtil.setTransform(this._canvas, offset, scale);
    },

    /**
     * Reproyecta solo los segmentos visibles y los agrupa en Path2D por (color, grosor).
     */
    _rebuildPaths() {
      const size = this._map.getSize();
      const topLeft = this._map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(this._canvas, topLeft);
      if (this._canvas.width !== size.x || this._canvas.height !== size.y) {
        this._canvas.width = size.x;
        this._canvas.height = size.y;
      }

      const { showRivers, riversData } = getState();
      if (!showRivers || !riversData || riversData.length === 0) {
        this._buckets = [];
        return;
      }

      const zoom = this._map.getZoom();
      const minOrder = getMinOrderForZoom(zoom);
      const b = this._map.getBounds();
      const vSouth = b.getSouth(), vNorth = b.getNorth();
      const vWest = b.getWest(), vEast = b.getEast();

      const bucketMap = new Map();

      for (const seg of riversData) {
        if (seg.order < minOrder) continue;

        // Culling rápido por bounding box
        const sb = seg.bbox;
        if (sb.maxLat < vSouth || sb.minLat > vNorth || sb.maxLon < vWest || sb.minLon > vEast) {
          continue;
        }

        // Grosor proporcional al orden de Strahler y al zoom
        const width = Math.min(4.5, 0.7 + (seg.order - minOrder) * 0.55 + Math.max(0, zoom - 6) * 0.25);
        const wKey = width.toFixed(1);
        const key = `${seg.color}_${wKey}`;

        let bucket = bucketMap.get(key);
        if (!bucket) {
          bucket = { color: seg.color, width: Number(wKey), path: new Path2D() };
          bucketMap.set(key, bucket);
        }

        const p = bucket.path;
        for (let i = 0; i < seg.coords.length; i++) {
          const [lon, lat] = seg.coords[i];
          const pt = this._map.latLngToContainerPoint([lat, lon]);
          if (i === 0) p.moveTo(pt.x, pt.y);
          else p.lineTo(pt.x, pt.y);
        }
      }

      this._buckets = Array.from(bucketMap.values());
    },

    _animate() {
      const ctx = this._canvas.getContext("2d");
      ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

      const { showRivers } = getState();
      if (showRivers && this._buckets.length > 0) {
        const now = performance.now() / 1000;
        const dashOffset = -(now * 26); // Velocidad de flujo aguas abajo (px/s)

        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // Pasada 1: Trazo base continuo con color de Anomalía de Caudal (AC %)
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.75;
        for (const b of this._buckets) {
          ctx.strokeStyle = b.color;
          ctx.lineWidth = b.width;
          ctx.stroke(b.path);
        }

        // Pasada 2: Pulsos brillantes animados en la dirección del flujo
        ctx.setLineDash([5, 14]);
        ctx.lineDashOffset = dashOffset;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
        ctx.globalAlpha = 0.9;
        for (const b of this._buckets) {
          ctx.lineWidth = Math.max(1.0, b.width * 0.55);
          ctx.stroke(b.path);
        }

        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;
      }

      this._raf = requestAnimationFrame(() => this._animate());
    },
  });

  return new RiversLayer();
}