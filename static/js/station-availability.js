// --- ESTADO GLOBAL ---
let map;
let baseMarkers = [];
let stationMarkers = [];
let userMarker = null;
let userPolygonLayer = null;
let userGeoJSON = null;
let estacionesData = [];

// 1. NUEVA RUTA DEL ARCHIVO OFUSCADO
const binUrl = '../data/dfg564df6g54dfg64df6g54dfg654dfgd.54dfgdfg4dfg5fhgf6fg4h4dfg';

// --- DICCIONARIO ESTRATÉGICO Y NORMATIVO ---
// --- DICCIONARIO ESTRATÉGICO Y NORMATIVO ---
const normativas = {
    'DTM': {
        titulo: 'Modelamiento de Dispersión (DTM)',
        tag: 'dtm',
        desc: 'Búsqueda en <strong>Radio estricto de 5 km</strong> desde la fuente de emisión. Requiere al menos <strong>3 años</strong> de datos <strong>horarios</strong> de Temperatura (máx, mín, prom), Precipitación, Humedad Relativa y Viento (velocidad y dirección).',
        alerta: 'El dashboard confirma que la estación cumple con la distancia (< 5km) y el periodo (>= 3 años). El especialista debe confirmar en campo que no existan montañas o edificios que perturben el flujo lineal del viento.',
        ctaData: 'Más información',
        ctaNoData: 'Simulación en WRF para DTM (D.S. N° 027-2021-MINAM)',
        waData: 'Hola Consultora Meteoclima. Mi proyecto cuenta con estaciones aptas para DTM. Deseo más información sobre su servicio de Gestión de Adquisición de Datos (trámites TUPA, certificados de calibración, fichas técnicas) y Control de Calidad.',
        waNoData: 'Hola Consultora Meteoclima. Deseo más información sobre su servicio de simulación en WRF para DTM dentro de mi área de estudio.'
    },
    'EIA': {
        titulo: 'Línea Base Climática (EIA/IGA)',
        tag: 'eia',
        desc: 'Búsqueda de estaciones hidrometeorológicas estrictamente <strong>dentro del polígono</strong> subido. Requiere al menos <strong>20 años</strong> de datos históricos <strong>diarios</strong> de Precipitación, Temperatura y Viento.',
        alerta: 'Para la variable de vientos, la normativa exige estrictamente utilizar una estación dentro del área de evaluación. Si la estación listada está fuera de su polígono, solo podrá usarla para temperatura y precipitación.',
        ctaData: 'Más información',
        ctaNoData: 'Regionalización o Interpolación Grillada (RM N.° 143-2025-MINAM)',
        waData: 'Hola Consultora Meteoclima. Mi proyecto cuenta con estaciones para Línea Base (EIA/IGA). Deseo más información sobre su servicio de Gestión de Adquisición de Datos (trámites TUPA, certificados de calibración, fichas técnicas) y Control de Calidad según RM N.° 143-2025-MINAM.',
        waNoData: 'Hola Consultora Meteoclima. Deseo más información sobre su servicio de regionalización o interpolación de productos grillados para Línea base climática para EIA/IGA.'
    },
    'HIDRO': {
        titulo: 'Tránsito de avenidas y Fajas Marginales',
        tag: 'hidro',
        desc: 'Búsqueda en un <strong>Buffer de 20 km</strong> alrededor del polígono subido. Requiere al menos <strong>20 años</strong> de datos históricos <strong>diarios</strong> de Precipitación y Caudal para determinar periodos de retorno.',
        alerta: 'Se muestran las estaciones cercanas al área de interés. El especialista debe validar mediante un Modelo de Elevación Digital (DEM) cuáles de estas estaciones hidrométricas se ubican aguas arriba de su punto de descarga o captación.',
        ctaData: 'Más información',
        ctaNoData: 'Simulaciones Históricas / Modelos (RJ N.° 332-2016-ANA)',
        waData: 'Hola Consultora Meteoclima. Mi proyecto cuenta con estaciones para Fajas Marginales. Deseo más información sobre su servicio de Gestión de Adquisición de Datos (trámites TUPA, certificados de calibración, fichas técnicas) y Control de Calidad según RJ N.° 332-2016-ANA.',
        waNoData: 'Hola Consultora Meteoclima. Deseo más información sobre su servicio de obtención de simulaciones históricas a partir de modelos hidrológicos para Tránsito de avenidas y delimitación de fajas marginales.'
    },
    'EVAR': {
        titulo: 'Análisis de Riesgo Climático (EVAR)',
        tag: 'evar',
        desc: 'Búsqueda de estaciones con data histórica extrema <strong>dentro del polígono</strong> subido. Requiere al menos <strong>20 años</strong> de datos <strong>diarios</strong> de Precipitación, Temperatura y Viento para calcular frecuencias de eventos extremos.',
        alerta: 'Las estaciones listadas cuentan con el historial necesario para evaluar la intensidad, magnitud y frecuencia (periodos de retorno) de peligros hidrometeorológicos en su área.',
        ctaData: 'Más información',
        ctaNoData: 'Series temporales vía Productos Grillados (RJ N° 112-2014-CENEPRED/J)',
        waData: 'Hola Consultora Meteoclima. Mi proyecto cuenta con estaciones para EVAR. Deseo más información sobre su servicio de Gestión de Adquisición de Datos (trámites TUPA, certificados de calibración, fichas técnicas) y Control de Calidad según RJ N° 112-2014-CENEPRED/J.',
        waNoData: 'Hola Consultora Meteoclima. Deseo más información sobre su servicio de obtención de series temporales consistentes a partir de productos grillados para Análisis de Riesgos Climáticos.'
    }
};

document.addEventListener("DOMContentLoaded", () => {
    map = L.map('map').setView([-9.19, -75.01], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);

    cargarDatosCSV();

    document.getElementById('btnAnalizar').addEventListener('click', analizarRepresentatividad);
    document.getElementById('studyType').addEventListener('change', actualizarInfoLegal);

    document.getElementById('fileShapefile').addEventListener('change', function(e){
        let file = e.target.files[0];
        if(!file) return;

        let reader = new FileReader();
        reader.onload = function(evt){
            shp(evt.target.result).then(function(geojson){
                if(userPolygonLayer) map.removeLayer(userPolygonLayer);

                userPolygonLayer = L.geoJSON(geojson, {
                    style: { color: "#ef4444", weight: 2, fillColor: "#fca5a5", fillOpacity: 0.3 },
                    interactive: false // <-- AÑADE ESTA LÍNEA (Quita la solidez al ratón)
                }).addTo(map);

                map.fitBounds(userPolygonLayer.getBounds());
                userGeoJSON = geojson;
            }).catch(err => {
                alert("Error leyendo el Shapefile. Asegúrese de que sea un archivo .zip válido.");
            });
        };
        reader.readAsArrayBuffer(file);
    });
});

function actualizarInfoLegal() {
    const tipo = document.getElementById('studyType').value;
    const norma = normativas[tipo];
    document.getElementById('legal-info-box').innerHTML = `
        <h3 style="margin-bottom:8px; font-size:0.95rem; color:var(--brand-dark);">${norma.titulo}</h3>
        <p style="margin:0; font-size:0.85rem; color:#334155; line-height:1.4;">${norma.desc}</p>
    `;

    if (tipo === 'DTM') {
        document.getElementById('coords-input-group').style.display = 'block';
        document.getElementById('shapefile-input-group').style.display = 'none';
    } else {
        document.getElementById('coords-input-group').style.display = 'none';
        document.getElementById('shapefile-input-group').style.display = 'block';
    }

    // 2. Limpiar visuales y limpiar el input del archivo para evitar "fantasmas"
    if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    if (userPolygonLayer) { map.removeLayer(userPolygonLayer); userPolygonLayer = null; userGeoJSON = null; }
    document.getElementById('fileShapefile').value = ""; // Resetea el nombre del archivo cargado

    const resultBox = document.getElementById('result-container');
    if (resultBox) { resultBox.style.display = 'none'; }

    dibujarEstacionesBase();
}

async function cargarDatosCSV() {
    try {
        const response = await fetch(binUrl);
        if (!response.ok) throw new Error("No se encontró la data ofuscada.");

        // 3. Decodificador en tiempo real
        const base64Data = await response.text();
        const csvText = atob(base64Data); // Decodifica de Base64 a Texto

        parseCSV(csvText);
        document.getElementById('map-loader').style.display = 'none';
        actualizarInfoLegal();
    } catch (error) {
        console.error("Error leyendo estaciones:", error);
        document.getElementById('map-loader').innerHTML = `<p style="color:red;">Error de sistema. Data inaccesible.</p>`;
    }
}

function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length === 0) return;
    const headers = lines[0].split(',').map(h => h.trim());
    const colIdx = {};
    headers.forEach((h, i) => colIdx[h] = i);

    for (let i = 1; i < lines.length; i++) {
        const rowStr = lines[i].trim();
        if (!rowStr) continue;
        const row = rowStr.split(',');
        if (row.length >= 4) {
            let st = {
                lat: parseFloat(row[colIdx['lat']]), lon: parseFloat(row[colIdx['lon']]),
                alt: parseFloat(row[colIdx['alt']]),
                objetivo: row[colIdx['objetivo']] ? row[colIdx['objetivo']].toLowerCase() : ""
            };
            if (!isNaN(st.lat) && !isNaN(st.lon)) estacionesData.push(st);
        }
    }
}

function dibujarEstacionesBase() {
    baseMarkers.forEach(m => map.removeLayer(m));
    baseMarkers = [];
    stationMarkers.forEach(layer => map.removeLayer(layer));
    stationMarkers = [];

    const tipo = document.getElementById('studyType').value;
    const tagBuscado = normativas[tipo].tag;

    estacionesData.forEach(st => {
        if (st.objetivo.includes(tagBuscado)) {
            let m = L.circleMarker([st.lat, st.lon], {
                radius: 4.5, fillColor: "#00BFFF", color: "#0055ff", weight: 1.5, opacity: 1.0, fillOpacity: 0.9
            }).addTo(map);

            m.bindTooltip(`<b>Altitud:</b> ${st.alt} msnm`, { direction: 'top', offset: [0, -5] });
            st.marker = m;
            baseMarkers.push(m);
        } else {
            st.marker = null;
        }
    });
}

function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function analizarRepresentatividad() {
    const tipo = document.getElementById('studyType').value;
    const norma = normativas[tipo];

    let uLat, uLon;

    if (tipo === 'DTM') {
        uLat = parseFloat(document.getElementById('inputLat').value);
        uLon = parseFloat(document.getElementById('inputLon').value);
        if (isNaN(uLat) || isNaN(uLon)) { alert("Para DTM debe ingresar Latitud y Longitud válidas."); return; }
    } else {
        if (!userGeoJSON) { alert("Para este estudio debe subir un archivo Shapefile (.zip)."); return; }
    }

    const btn = document.getElementById('btnAnalizar');
    const progContainer = document.getElementById('progress-container');
    const progBar = document.getElementById('progress-bar');
    const progText = document.getElementById('progress-text');

    btn.disabled = true;
    btn.style.backgroundColor = '#94a3b8';
    btn.style.cursor = 'not-allowed';
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando Área...';

    progContainer.style.display = 'block';
    progBar.style.width = '0%';
    progText.innerText = '0%';

    if (userMarker) map.removeLayer(userMarker);
    stationMarkers.forEach(layer => map.removeLayer(layer));
    stationMarkers = [];
    baseMarkers.forEach(m => m.setStyle({ radius: 4.5, fillColor: "#00BFFF", color: "#0055ff", weight: 1.5 }));

    let estacionesValidas = [];
    let areaBusqueda = userGeoJSON;

    // 4. FIX DEL BUFFER CONGELADO: Forzamos una pequeña pausa para que el navegador dibuje el botón gris
    await new Promise(resolve => setTimeout(resolve, 50));

    if (tipo === 'HIDRO' && userGeoJSON) {
        progText.innerText = 'Calculando Buffer 20km...';
        await new Promise(resolve => setTimeout(resolve, 50)); // Otra pausa antes del proceso pesado
        try { areaBusqueda = turf.buffer(userGeoJSON, 20, {units: 'kilometers'}); }
        catch(e) { console.error("Error creando buffer:", e); }
    }

    if (tipo === 'DTM') {
        const coverageCircle = L.circle([uLat, uLon], {
            color: '#10b981', fillColor: '#34d399', fillOpacity: 0.2, radius: 5000, interactive: false
        }).addTo(map);
        stationMarkers.push(coverageCircle);
    }

    const totalEstaciones = estacionesData.length;
    const tamanoLote = 25;

    for (let i = 0; i < totalEstaciones; i += tamanoLote) {
        const lote = estacionesData.slice(i, i + tamanoLote);

        lote.forEach(st => {
            if (!st.marker) return;

            let inside = false;
            let distFormat = "";

            if (tipo === 'DTM') {
                let dist = calcularDistancia(uLat, uLon, st.lat, st.lon);
                if (dist <= 5) inside = true;
                distFormat = `<br><b>Distancia al pto:</b> ${dist.toFixed(1)} km`;
            } else {
                let pt = turf.point([st.lon, st.lat]);
                turf.featureEach(areaBusqueda, function (currentFeature) {
                    if (inside) return;
                    if (currentFeature.geometry && (currentFeature.geometry.type === 'Polygon' || currentFeature.geometry.type === 'MultiPolygon')) {
                        if (turf.booleanPointInPolygon(pt, currentFeature)) inside = true;
                    }
                });
            }

            let tagsFormat = st.objetivo.replace(/-/g, ', ').toUpperCase();
            st.marker.setTooltipContent(`
                <div style="font-size:0.85rem; line-height:1.3;">
                    <b>Clasificación:</b> ${tagsFormat}<br>
                    <b>Altitud:</b> ${st.alt} msnm ${distFormat}
                </div>
            `);

            if (inside) {
                estacionesValidas.push(st);
                st.marker.setStyle({ radius: 6.5, fillColor: "#fbbf24", color: "#9a3412", weight: 2, fillOpacity: 1.0 });
                st.marker.bringToFront(); // <-- AÑADE ESTA LÍNEA (Fuerza al punto a estar encima de todo)
            }
        });

        let porcentaje = Math.min(100, Math.round(((i + tamanoLote) / totalEstaciones) * 100));
        progBar.style.width = porcentaje + '%';
        progText.innerText = porcentaje + '%';
        await new Promise(resolve => setTimeout(resolve, 1));
    }

    if (tipo === 'DTM') {
        const redPin = L.divIcon({ className: 'custom-user-pin', html: "<div style='background-color:#ef4444; width:18px; height:18px; border-radius:50%; border:3px solid white;'></div>" });
        userMarker = L.marker([uLat, uLon], {icon: redPin}).addTo(map);
        map.flyTo([uLat, uLon], 12);
    }

    btn.disabled = false;
    btn.style.backgroundColor = '';
    btn.style.cursor = 'pointer';
    btn.innerHTML = '<i class="fas fa-search-location"></i> Evaluar Cumplimiento Normativo';

    setTimeout(() => { progContainer.style.display = 'none'; }, 1000);
    mostrarResultados(estacionesValidas.length, norma);
}

function mostrarResultados(conteo, norma) {
    const container = document.getElementById('result-container');
    container.className = 'result-container';
    container.style.display = 'block';

    if (conteo > 0) {
        container.classList.add('result-success');
        const urlWa = `https://wa.me/51944014115?text=${encodeURIComponent(norma.waData)}`;
        container.innerHTML = `
            <div class="result-title"><i class="fas fa-check-circle"></i> Estaciones Encontradas (${conteo})</div>
            <div class="result-text" style="text-align: justify; margin-bottom: 10px;">
                <p style="background-color: #e0f2fe; padding: 10px; border-radius: 5px; color: #0284c7; font-size: 0.85rem; border-left: 3px solid #0284c7;">
                    <i class="fas fa-info-circle"></i> <b>Alerta Normativa:</b><br>${norma.alerta}
                </p>
            </div>
            <a href="${urlWa}" target="_blank" class="btn-whatsapp-result">
                <i class="fab fa-whatsapp"></i> ${norma.ctaData}
            </a>
        `;
    } else {
        container.classList.add('result-warning');
        const urlWa = `https://wa.me/51944014115?text=${encodeURIComponent(norma.waNoData)}`;
        container.innerHTML = `
            <div class="result-title"><i class="fas fa-exclamation-triangle"></i> Sin Estaciones Cercanas</div>
            <div class="result-text" style="margin-bottom: 10px;">
                No se detectaron estaciones que cumplan los requisitos en su área de estudio.<br>
                Requiere alternativa de ingeniería aprobada por el Estado.
            </div>
            <a href="${urlWa}" target="_blank" class="btn-whatsapp-result" style="background-color: var(--brand-dark);">
                <i class="fab fa-whatsapp"></i> ${norma.ctaNoData}
            </a>
        `;
    }
}
