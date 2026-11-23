// static/js/meteosaki/alertas.js
import { state, GOES_PATHS } from './config.js';
import { map, setRoadsVisible } from './mapa.js';
import { setRiversVisible } from './goes_controller.js';

let alertsData = null;
let currentTab = 'quebradas';
let focusMarker = null;

const BADGE_STYLE = {
    rojo:     'bg-red-600/90 text-white border-red-400',
    naranja:  'bg-orange-600/90 text-white border-orange-400',
    amarillo: 'bg-amber-500/90 text-slate-950 border-amber-300',
};

const HORIZON_LABEL = {
    nowcast:    '⚡ Nowcast (0-3h)',
    pronostico: '🌧️ Pronóstico (3-72h)',
    ambos:      '🔥 Nowcast + Pronóstico',
};

async function loadAlerts() {
    const res = await fetch(`${GOES_PATHS.ALERTS_JSON}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    alertsData = await res.json();
    return alertsData;
}

function renderSummary() {
    const el = document.getElementById('alerts-summary');
    if (!el || !alertsData?.resumen) return;
    const r = alertsData.resumen[currentTab] || { rojo: 0, naranja: 0, amarillo: 0 };
    el.innerHTML = `
        <span class="text-slate-400">Resumen:</span>
        <span class="px-2 py-0.5 rounded bg-red-900/60 border border-red-500/60 text-red-200 font-bold">🔴 ${r.rojo}</span>
        <span class="px-2 py-0.5 rounded bg-orange-900/60 border border-orange-500/60 text-orange-200 font-bold">🟠 ${r.naranja}</span>
        <span class="px-2 py-0.5 rounded bg-amber-900/50 border border-amber-500/60 text-amber-200 font-bold">🟡 ${r.amarillo}</span>
    `;
}

function renderList() {
    const listEl = document.getElementById('alerts-list');
    if (!listEl || !alertsData) return;

    const lvlFilter = document.getElementById('filter-alert-level')?.value || 'all';
    const horFilter = document.getElementById('filter-alert-horizon')?.value || 'all';

    const items = (alertsData[currentTab] || []).filter((it) => {
        if (lvlFilter !== 'all' && it.nivel !== lvlFilter) return false;
        if (horFilter !== 'all' && it.horizonte !== horFilter) return false;
        return true;
    });

    if (items.length === 0) {
        listEl.innerHTML = `<p class="text-slate-400 text-center py-8">Sin alertas para los filtros seleccionados.</p>`;
        return;
    }

    listEl.innerHTML = '';
    items.forEach((it) => {
        const card = document.createElement('div');
        card.className = 'bg-slate-900/80 hover:bg-slate-700/70 border border-slate-700 rounded-lg p-3 cursor-pointer transition flex flex-col gap-1';

        const badge = `<span class="px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase ${BADGE_STYLE[it.nivel] || ''}">${it.nivel}</span>`;
        const horTag = `<span class="text-[10px] text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-600">${HORIZON_LABEL[it.horizonte] || it.horizonte}</span>`;

        if (currentTab === 'quebradas') {
            card.innerHTML = `
                <div class="flex items-center justify-between gap-2">
                    <div class="font-bold text-slate-100 text-xs">🌊 Cuenca ${it.cuenca}</div>
                    <div class="flex items-center gap-1.5">${horTag} ${badge}</div>
                </div>
                <div class="text-[11px] text-slate-300">${it.motivo || ''}</div>
                <div class="text-[10px] text-slate-400 flex flex-wrap gap-3 mt-0.5">
                    <span>Pico 3h: <b>${it.tp_3h_max_mm} mm</b></span>
                    <span>24h: <b>${it.tp_24h_mm} mm</b></span>
                    <span>48h: <b>${it.tp_48h_mm} mm</b></span>
                    <span>Ventana: <b>${it.ventana_utc}</b></span>
                </div>
            `;
        } else {
            card.innerHTML = `
                <div class="flex items-center justify-between gap-2">
                    <div class="font-bold text-slate-100 text-xs">🛣️ Ruta ${it.ruta} (${it.red}) — ${it.dpto}</div>
                    <div class="flex items-center gap-1.5">${horTag} ${badge}</div>
                </div>
                <div class="text-[11px] text-slate-300 truncate">${it.trayecto || it.peligro_dom}</div>
                <div class="text-[10px] text-slate-400 flex flex-wrap gap-3 mt-0.5">
                    <span>Tramos: <b>${it.tramos_expuestos}</b></span>
                    <span>24h: <b>${it.tp_24h_mm} mm</b></span>
                    <span>48h: <b>${it.tp_48h_mm} mm</b></span>
                    <span>Peligro: <b>${it.peligro_dom}</b></span>
                    <span>Ventana: <b>${it.ventana_utc}</b></span>
                </div>
            `;
        }

        // Al hacer clic: cerrar modal, activar la capa y volar al punto crítico
        card.addEventListener('click', async () => {
            document.getElementById('modal-alerts')?.classList.add('hidden');

            if (currentTab === 'quebradas' && !state.showRivers) {
                document.getElementById('btn-rivers-toggle')?.click();
                await setRiversVisible(true);
            } else if (currentTab === 'carreteras' && !state.showRoads) {
                document.getElementById('btn-roads-toggle')?.click();
                await setRoadsVisible(true);
            }

            if (it.lat && it.lon) {
                map.flyTo([it.lat, it.lon], 9, { duration: 1.0 });
                if (focusMarker) map.removeLayer(focusMarker);
                focusMarker = L.circleMarker([it.lat, it.lon], {
                    radius: 9,
                    color: it.nivel === 'rojo' ? '#ef4444' : (it.nivel === 'naranja' ? '#f97316' : '#facc15'),
                    weight: 3,
                    fillOpacity: 0.25,
                }).addTo(map);
                setTimeout(() => { if (focusMarker) { map.removeLayer(focusMarker); focusMarker = null; } }, 8000);
            }
        });

        listEl.appendChild(card);
    });
}

function setActiveTab(tab) {
    currentTab = tab;
    const btnQ = document.getElementById('tab-alerts-quebradas');
    const btnC = document.getElementById('tab-alerts-carreteras');
    if (btnQ && btnC) {
        btnQ.className = tab === 'quebradas'
            ? 'px-3 py-1 rounded font-bold bg-cyan-600 text-white border border-cyan-400'
            : 'px-3 py-1 rounded font-bold bg-slate-700 text-slate-300 border border-slate-600 hover:bg-slate-600';
        btnC.className = tab === 'carreteras'
            ? 'px-3 py-1 rounded font-bold bg-amber-600 text-white border border-amber-400'
            : 'px-3 py-1 rounded font-bold bg-slate-700 text-slate-300 border border-slate-600 hover:bg-slate-600';
    }
    renderSummary();
    renderList();
}

export function initAlertsUI() {
    const modal = document.getElementById('modal-alerts');
    const btnOpen = document.getElementById('btn-alerts');
    const btnClose = document.getElementById('btn-close-alerts');

    btnOpen?.addEventListener('click', async () => {
        modal?.classList.remove('hidden');
        try {
            const data = await loadAlerts();
            const metaEl = document.getElementById('alerts-meta');
            if (metaEl) {
                metaEl.innerText = `Actualizado: ${data.updated_utc || '-'} | Modelo: ${data.modelo_base || '-'} | GOES: ${data.goes_latest_utc || '-'}`;
            }
            setActiveTab(currentTab);
        } catch (err) {
            const listEl = document.getElementById('alerts-list');
            if (listEl) listEl.innerHTML = `<p class="text-red-400 text-center py-6">⚠️ Error cargando alertas: ${err.message}</p>`;
        }
    });

    btnClose?.addEventListener('click', () => modal?.classList.add('hidden'));
    document.getElementById('tab-alerts-quebradas')?.addEventListener('click', () => setActiveTab('quebradas'));
    document.getElementById('tab-alerts-carreteras')?.addEventListener('click', () => setActiveTab('carreteras'));
    document.getElementById('filter-alert-level')?.addEventListener('change', renderList);
    document.getElementById('filter-alert-horizon')?.addEventListener('change', renderList);
}