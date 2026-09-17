/* ==========================================================
   waterlevel-map.js — แผนที่สถานการณ์ระดับน้ำ
   หน้าที่: init Leaflet, วาดจุดสถานีตามความจุลำน้ำ (%)
   ไม่ใช้เกณฑ์น้ำฝน / IDW จาก map.js
   ========================================================== */

console.log = function () { };

const DEBUG = false;
const log = DEBUG ? console.log.bind(console) : () => { };

const MAP_CENTER = [18.735, 97.998]; // อ.เมือง จ.แม่ฮ่องสอน
const MAP_ZOOM = 8;

let map;
let layerControl;
let stationLayer;
let districtLayer;
let subdistrictLayer;
let villageLayer;
let stationMarkersById = {}; // เก็บ marker ต่อสถานี (key = station id) ไว้ให้คลิกจากตารางแล้วเปิด popup บนแผนที่ได้

// ความจุลำน้ำ (%) — เทียบกับตลิ่งของแต่ละสถานี
const WATERLEVEL_THRESHOLDS = {
  criticalLow: 10,
  low: 30,
  normal: 70,
  high: 100,
};

function classifyWaterlevelStatus(percent) {
  if (percent === null || percent === undefined || isNaN(percent)) return null;
  if (percent > WATERLEVEL_THRESHOLDS.high) return 'overflow';
  if (percent > WATERLEVEL_THRESHOLDS.normal) return 'high';
  if (percent > WATERLEVEL_THRESHOLDS.low) return 'normal';
  if (percent > WATERLEVEL_THRESHOLDS.criticalLow) return 'low';
  return 'critical_low';
}

const STATUS_COLOR = {
  critical_low: '#C084FC',
  low: '#FBBF24',
  normal: '#34D399',
  high: '#38BDF8',
  overflow: '#F87171',
  unknown: '#5B6B84',
};

// แปลตาม getLang() (จาก i18n.js) — ใช้ getStatusLabel(status) แทนการอ้าง object ตรงๆ
function getStatusLabel(status) {
  const keys = {
    critical_low: 'status.water.criticalLow',
    low: 'status.water.low',
    normal: 'status.water.normal',
    high: 'status.water.high',
    overflow: 'status.water.overflow',
    unknown: 'status.unknown',
  };
  return t(keys[status] || 'status.unknown');
}

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: false })
    .setView(MAP_CENTER, MAP_ZOOM);

  function addGPSControl() {
    const GPSControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function (mapInstance) {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        const button = L.DomUtil.create('a', 'gps-control', container);
        button.href = '#';
        button.title = t('gps.title');
        button.innerHTML = '⌖';
        button.setAttribute('role', 'button');
        button.setAttribute('aria-label', t('gps.title'));
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(button, 'click', function (e) {
          L.DomEvent.preventDefault(e);
          getCurrentLocation(mapInstance);
        });
        return container;
      },
    });
    map.addControl(new GPSControl());
  }

  function getCurrentLocation(mapInstance) {
    if (!navigator.geolocation) {
      alert(t('gps.notSupported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;

        if (window.userLocationMarker) {
          mapInstance.removeLayer(window.userLocationMarker);
        }
        if (window.userLocationCircle) {
          mapInstance.removeLayer(window.userLocationCircle);
        }

        window.userLocationMarker = L.circleMarker(
          [latitude, longitude],
          {
            radius: 7,
            color: '#ffffff',
            weight: 3,
            fillColor: '#3B82F6',
            fillOpacity: 1,
            pane: 'stationPane',
          }
        ).addTo(mapInstance);

        window.userLocationCircle = L.circle(
          [latitude, longitude],
          {
            radius: accuracy,
            color: '#3B82F6',
            weight: 1,
            fillColor: '#3B82F6',
            fillOpacity: 0.12,
            interactive: false,
          }
        ).addTo(mapInstance);

        window.userLocationMarker.bindPopup(`
        <strong>📍 ${t('gps.title')}</strong><br>
        Latitude: ${latitude.toFixed(6)}<br>
        Longitude: ${longitude.toFixed(6)}<br>
        Accuracy: ±${Math.round(accuracy)} m
      `);

        mapInstance.setView([latitude, longitude], 15);
        window.userLocationMarker.openPopup();
      },
      (error) => {
        let message = t('gps.errorGeneric');
        switch (error.code) {
          case error.PERMISSION_DENIED:
            message = t('gps.errorDenied');
            break;
          case error.POSITION_UNAVAILABLE:
            message = t('gps.errorUnavailable');
            break;
          case error.TIMEOUT:
            message = t('gps.errorTimeout');
            break;
        }
        alert(message);
      },
      {
        enableHighAccuracy: false,
        timeout: 2000,
        maximumAge: 300000,
      }
    );
  }

  const FullscreenControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function (mapInstance) {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-fullscreen');
      const link = L.DomUtil.create('a', 'fullscreen-icon', container);
      link.href = '#';
      link.title = t('fullscreen.enter');
      link.innerHTML = '⛶';
      link.setAttribute('role', 'button');
      link.setAttribute('aria-label', t('fullscreen.toggle'));

      const togglePseudoFullscreen = () => {
        const mapEl = mapInstance.getContainer();
        mapEl.classList.toggle('pseudo-fullscreen');
        document.body.classList.toggle('pseudo-fullscreen-active');
        setTimeout(() => mapInstance.invalidateSize(), 100);
        const isActive = mapEl.classList.contains('pseudo-fullscreen');
        link.innerHTML = isActive ? '✕' : '⛶';
        link.title = isActive ? t('fullscreen.exit') : t('fullscreen.enter');

        toggleTableInFullscreen(isActive); // ย้ายตารางข้อมูล เข้า/ออกมุมขวาล่าง
        toggleLegendInFullscreen(isActive); // ย้าย legend (คำอธิบายเกณฑ์ความจุลำน้ำ) เข้า/ออกมุมซ้ายล่าง
      };

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(link, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        togglePseudoFullscreen();
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mapInstance.getContainer().classList.contains('pseudo-fullscreen')) {
          togglePseudoFullscreen();
        }
      });

      return container;
    },
  });
  map.addControl(new FullscreenControl());
  addGPSControl();
  createTableToggleControl(); // ปุ่มยุบ/แสดงตารางข้อมูล — โผล่เฉพาะตอนแผนที่เต็มจอ
  createLegendToggleControl(); // ปุ่มยุบ/แสดงคำอธิบายเกณฑ์ความจุลำน้ำ (Map Legend) — โผล่เฉพาะตอนแผนที่เต็มจอ

  // ปุ่ม "📈 ดูกราฟย้อนหลัง" ใน popup ของจุดสถานี — event delegation เพราะ popup ถูกสร้าง/ทำลายใหม่ทุกครั้งที่ renderStationMarkers() รัน
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.popup-chart-btn');
    if (!btn) return;
    if (typeof openStationChart === 'function' && typeof fetchStationWaterLevelChart === 'function') {
      openStationChart(btn.dataset.id, btn.dataset.name, fetchStationWaterLevelChart);
    }
  });

  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 25,
  });

  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 25
  }).addTo(map);

  const terrainLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 25,
  });

  const baseMaps = {
    [t('layer.roadmap')]: osmLayer,
    [t('layer.satellite')]: satelliteLayer,
    [t('layer.terrain')]: terrainLayer
  };

  layerControl = L.control.layers(baseMaps, {}, { collapsed: true }).addTo(map);

  const container = layerControl.getContainer();
  container.classList.add('click-only-layer-control');

  L.DomEvent.off(container, 'mouseenter', layerControl.expand, layerControl);
  L.DomEvent.off(container, 'mouseleave', layerControl.collapse, layerControl);

  const toggleBtn = container.querySelector('.leaflet-control-layers-toggle');
  L.DomEvent.on(toggleBtn, 'click', function (e) {
    L.DomEvent.stop(e);
    if (container.classList.contains('leaflet-control-layers-expanded')) {
      layerControl.collapse();
    } else {
      layerControl.expand();
    }
  });

  map.on('click', 'popupopen', function () {
    layerControl.collapse();
  });

  map.on('popupopen', function () {
    layerControl.collapse();
  });

  map.createPane('boundaryPane');
  map.getPane('boundaryPane').style.zIndex = 350;
  map.getPane('boundaryPane').style.pointerEvents = 'none';

  map.createPane('stationPane');
  map.getPane('stationPane').style.zIndex = 550;

  stationLayer = L.layerGroup().addTo(map);
  layerControl.addOverlay(stationLayer, t('layer.waterStations'));

  loadBoundaryLayers();
  renderMapLegend();
}

async function loadBoundaryLayers() {
  const districtStyle = { color: '#38BDF8', weight: 2, opacity: 0.85, fillColor: '#38BDF8', fillOpacity: 0.08 };
  const tambonStyle = { color: '#FBBF24', weight: 1.2, dashArray: '4, 4', opacity: 0.75, fillColor: '#FBBF24', fillOpacity: 0.04 };
  const villageStyle = { color: '#A855F7', weight: 0.8, dashArray: '2, 3', opacity: 0.6, fillColor: '#A855F7', fillOpacity: 0.02 };

  try {
    const resDistrict = await fetch('mhs_district.geojson');
    const dataDistrict = await resDistrict.json();

    districtLayer = L.geoJSON(dataDistrict, {
      pane: 'boundaryPane',
      style: districtStyle,
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        // ไฟล์นี้มีชื่ออังกฤษทางการอยู่แล้ว (ADM2_EN จากมาตรฐาน HDX) ใช้ตรงๆ แม่นยำกว่าทับศัพท์เอง
        const districtName = getLang() === 'en'
          ? (p.ADM2_EN || localizeName(p.ADM2_TH) || 'Unknown')
          : (p.ADM2_TH || 'ไม่ระบุ');
        const prefix = getLang() === 'en' ? '' : 'อำเภอ';

        layer.bindPopup(`
          <div style="font-family: var(--font-body); padding: 2px;">
            <div style="font-size: 1.05rem; font-weight: 600; color: #38BDF8; margin-bottom: 4px;">
              ${prefix}${districtName}
            </div>
          </div>
        `);
      }
    });
    layerControl.addOverlay(districtLayer, t('layer.district'));

    const resTambon = await fetch('mhs_tambon.geojson');
    const dataTambon = await resTambon.json();
    subdistrictLayer = L.geoJSON(dataTambon, {
      pane: 'boundaryPane',
      style: tambonStyle,
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        const tambonName = localizeName(p.TAM_NAM_T) || (getLang() === 'en' ? 'Unknown' : 'ไม่ระบุ');
        const amphoeName = localizeName(p.AMP_NAM_T) || (getLang() === 'en' ? 'Unknown' : 'ไม่ระบุ');
        const belongLabel = getLang() === 'en' ? 'District' : 'สังกัด';

        layer.bindPopup(`
          <div style="font-family: var(--font-body); padding: 2px;">
            <div style="font-size: 1rem; font-weight: 600; color: #FBBF24; margin-bottom: 4px;">
              ${tambonName}
            </div>
            <div style="font-size: 0.85rem; color: #E7ECF3;">
              ${belongLabel}: ${amphoeName}
            </div>
          </div>
        `);
      }
    });
    layerControl.addOverlay(subdistrictLayer, t('layer.tambon'));

    const resVillage = await fetch('mhs_village.geojson');
    const dataVillage = await resVillage.json();
    villageLayer = L.geoJSON(dataVillage, {
      pane: 'boundaryPane',
      style: villageStyle,
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        const villName = localizeName(p.Name) || (getLang() === 'en' ? 'Unknown' : 'ไม่ระบุ');
        const moo = p.MOO_1 ? (getLang() === 'en' ? `Moo ${p.MOO_1}` : `หมู่ที่ ${p.MOO_1}`) : '';
        const tambon = localizeName(p.TAMBON_T) || '';
        const amphoe = localizeName(p.AMPHOE_T) || '';

        layer.bindPopup(`
          <div style="font-family: var(--font-body); padding: 2px;">
            <div style="font-size: 0.95rem; font-weight: 600; color: #A855F7; margin-bottom: 4px;">
              ${villName} ${moo}
            </div>
            <div style="font-size: 0.85rem; color: #8A97AC;">
              ${tambon} ${amphoe}
            </div>
          </div>
        `);
      }
    });
    layerControl.addOverlay(villageLayer, t('layer.village'));

    districtLayer.addTo(map);
    if (stationLayer) stationLayer.bringToFront();
  } catch (error) {
    // โหลดขอบเขตไม่สำเร็จ — แผนที่สถานียังใช้ได้
  }
}

function formatNumber(value, digits = 1, suffix = '') {
  if (value === null || value === undefined || isNaN(value)) return 'ไม่มีข้อมูล';
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function renderStationMarkers(stations) {
  stationLayer.clearLayers();
  stationMarkersById = {}; // ล้าง registry เดิมทิ้งพร้อมกับ marker เก่า กันอ้างอิง marker ที่ถูกลบไปแล้ว

  stations.forEach((s) => {
    const status = classifyWaterlevelStatus(s.storagePercent) || 'unknown';
    const color = STATUS_COLOR[status];

    const marker = L.circleMarker([s.lat, s.lng], {
      pane: 'stationPane',
      radius: status === 'overflow' || status === 'critical_low' ? 10 : 9,
      weight: 3,
      color: '#0B1220',
      opacity: 1,
      fillColor: color,
      fillOpacity: 0.9,
      interactive: true
    });

    const levelText = formatNumber(s.waterlevel, 2, ` ${t('unit.msl')}`);
    const percentText = formatNumber(s.storagePercent, 1, ' %');
    const bankText = formatNumber(s.minBank, 2, ` ${t('unit.msl')}`);
    const riverLine = s.riverName && s.riverName !== '-' ? `${t('popup.river')}: ${localizeName(s.riverName)}<br>` : '';
    const bankDiffLine = s.diffBankText && s.diffBankText !== '-'
      ? `${s.diffBankText}: ${formatNumber(s.diffBank, 2, ` ${t('unit.meter')}`)}<br>`
      : '';

    marker.bindPopup(`
      <strong>${localizeName(s.name)}</strong><br>
      ${t('popup.tambon')} ${localizeName(s.subDistrict) || '-'}<br>
      ${t('popup.district')} ${localizeName(s.district) || '-'}<br>
      ${riverLine}
      ${t('popup.waterlevel')}: ${levelText}<br>
      ${t('popup.capacity')}: ${percentText}<br>
      ${t('chart.bankLevelMin')}: ${bankText}<br>
      ${bankDiffLine}
      ${t('popup.status')}: <span style="color:${color}; font-weight:600;">${getStatusLabel(status)}</span><br>
      <button type="button" class="popup-chart-btn" data-id="${s.id}" data-name="${s.name}">${t('popup.viewChart')}</button>
    `);

    const supportsHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;

    if (supportsHover) {
      let isPinnedByClick = false;
      marker.on('mouseover', () => marker.openPopup());
      marker.on('mouseout', () => {
        if (!isPinnedByClick) marker.closePopup();
      });
      marker.on('click', () => {
        isPinnedByClick = true;
        marker.openPopup();
      });
      marker.on('popupclose', () => {
        isPinnedByClick = false;
      });
    }

    stationMarkersById[s.id] = marker; // จำ marker ไว้ ให้คลิกแถวในตารางแล้วเปิด popup จุดนี้บนแผนที่ได้

    marker.addTo(stationLayer);
  });
}

// เรียกตอนคลิกแถวในตาราง (js/waterlevel-main.js) — เลื่อนแผนที่ไปหาสถานีนั้นแล้วเปิด popup ให้
function focusStationOnMap(id) {
  const marker = stationMarkersById[id];
  if (!marker || !map) return;

  map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 13), { duration: 0.8 });

  // เปิดผ่าน marker.fire('click') แทน openPopup() ตรงๆ เพื่อให้ trigger handler เดิมที่ปักหมุด
  // popup ค้างไว้บนอุปกรณ์ที่มีเมาส์ (isPinnedByClick) เหมือนคลิกจุดนั้นเอง — เช็คก่อนว่าเปิดอยู่แล้วหรือยัง
  // เพราะ Leaflet toggle เปิด/ปิดสลับกันทุกครั้งที่ fire('click') ถ้าเปิดอยู่แล้วจะกลายเป็นปิดแทน
  if (!marker.isPopupOpen()) {
    marker.fire('click');
  }

  const mapEl = document.getElementById('map');
  if (mapEl && !mapEl.classList.contains('pseudo-fullscreen')) {
    mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function renderMapLegend() {
  const items = [
    { label: `${t('status.water.criticalLow')} (≤${WATERLEVEL_THRESHOLDS.criticalLow}%)`, color: STATUS_COLOR.critical_low },
    { label: `${t('status.water.low')} (>${WATERLEVEL_THRESHOLDS.criticalLow}–${WATERLEVEL_THRESHOLDS.low}%)`, color: STATUS_COLOR.low },
    { label: `${t('status.water.normal')} (>${WATERLEVEL_THRESHOLDS.low}–${WATERLEVEL_THRESHOLDS.normal}%)`, color: STATUS_COLOR.normal },
    { label: `${t('status.water.high')} (>${WATERLEVEL_THRESHOLDS.normal}–${WATERLEVEL_THRESHOLDS.high}%)`, color: STATUS_COLOR.high },
    { label: `${t('status.water.overflow')} (>${WATERLEVEL_THRESHOLDS.high}%)`, color: STATUS_COLOR.overflow },
  ];

  document.getElementById('mapLegend').innerHTML = items
    .map(
      (it) => `
      <span class="legend-item">
        <span class="legend-dot" style="background:${it.color}"></span>
        ${it.label}
      </span>`
    )
    .join('');
}

// ==========================================
// ย้าย Map Legend (คำอธิบายเกณฑ์ความจุลำน้ำ) เข้าไปแสดงในแผนที่ตอนโหมดเต็มจอ (มุมซ้ายล่าง) — ยุบ/แสดงได้
// ==========================================
// สลับ #mapLegend (element ตัวเดิม ไม่ clone) ระหว่างตำแหน่งปกติใต้แผนที่ กับมุมซ้ายล่างของแผนที่ — เหมือนกับหน้าน้ำฝน (map.js)
// ห่อด้วยปุ่มยุบ/แสดงแยกต่างหาก เพราะ renderMapLegend() เขียนทับ #mapLegend.innerHTML ทุกครั้ง ใส่ปุ่มไว้ข้างในจะโดนล้างทิ้งไปด้วย
let legendOriginalParent = null;
let legendOriginalNextSibling = null;
let legendToggleControlEl = null;
let legendToggleContentEl = null;
let legendToggleBtn = null;
let legendCollapsed = false;

function setLegendCollapsed(collapsed) {
  legendCollapsed = collapsed;
  if (legendToggleContentEl) legendToggleContentEl.style.display = collapsed ? 'none' : 'block';
  if (legendToggleBtn) {
    legendToggleBtn.innerHTML = `${collapsed ? '▾' : '▴'} ${t('legend.label')}`;
    legendToggleBtn.title = collapsed ? t('legend.show') : t('legend.hide');
  }
}

function toggleLegendInFullscreen(isFullscreen) {
  const legendEl = document.getElementById('mapLegend');
  if (!legendEl || !legendToggleControlEl || !legendToggleContentEl) return;

  if (isFullscreen) {
    legendOriginalParent = legendEl.parentElement;
    legendOriginalNextSibling = legendEl.nextSibling;
    legendEl.classList.add('legend-floating');
    legendToggleContentEl.appendChild(legendEl);
    legendToggleControlEl.style.display = 'block';
    setLegendCollapsed(false); // เปิดแสดงไว้ก่อนทุกครั้งที่เข้าเต็มจอ ผู้ใช้กดยุบเองได้ทีหลัง
  } else {
    legendToggleControlEl.style.display = 'none';
    legendEl.classList.remove('legend-floating');
    if (legendOriginalParent) {
      legendOriginalParent.insertBefore(legendEl, legendOriginalNextSibling);
    }
  }
}

// สร้าง custom Leaflet control (ปุ่มยุบ/แสดง + กล่องใส่ #mapLegend) ซ่อนไว้ก่อน แสดงเมื่อเข้าเต็มจอเท่านั้น
function createLegendToggleControl() {
  const LegendToggleControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
      const container = L.DomUtil.create('div', 'legend-toggle-control leaflet-control');
      container.style.display = 'none';

      const btn = L.DomUtil.create('button', 'legend-toggle-btn', container);
      btn.type = 'button';
      btn.innerHTML = `▴ ${t('legend.label')}`;
      btn.title = t('legend.hide');
      btn.setAttribute('aria-label', t('legend.toggleAria'));

      const content = L.DomUtil.create('div', 'legend-toggle-content', container);

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      btn.addEventListener('click', () => setLegendCollapsed(!legendCollapsed));

      legendToggleControlEl = container;
      legendToggleContentEl = content;
      legendToggleBtn = btn;

      return container;
    },
  });

  map.addControl(new LegendToggleControl());
}

// ==========================================
// ย้ายตารางข้อมูล เข้าไปแสดงในแผนที่ตอนโหมดเต็มจอ (มุมขวาล่าง) — ยุบ/แสดงได้
// ==========================================
// สลับ .table-wrap (element ตัวเดิม ไม่ clone) เข้า/ออกมุมขวาล่างของแผนที่ — เหมือนกับที่ทำในหน้าน้ำฝน (map.js)
// ย้าย element ตัวจริงเพราะ header คอลัมน์ (sortable), แถวข้อมูล (คลิกเปิด popup/กราฟ) ผูก event ไว้กับ element เดิมอยู่แล้ว
let tableWrapOriginalParent = null;
let tableWrapOriginalNextSibling = null;
let tableControlEl = null;
let tablePanelEl = null;
let tableToggleBtn = null;
let tableCollapsed = false;

function setTableCollapsed(collapsed) {
  tableCollapsed = collapsed;
  if (tablePanelEl) tablePanelEl.style.display = collapsed ? 'none' : 'block';
  if (tableToggleBtn) {
    tableToggleBtn.innerHTML = `${collapsed ? '▾' : '▴'} ${t('tablePanel.label')}`;
    tableToggleBtn.title = collapsed ? t('tablePanel.show') : t('tablePanel.hide');
  }
}

function toggleTableInFullscreen(isFullscreen) {
  const wrapEl = document.querySelector('.table-wrap');
  if (!wrapEl || !tableControlEl || !tablePanelEl) return;

  if (isFullscreen) {
    tableWrapOriginalParent = wrapEl.parentElement;
    tableWrapOriginalNextSibling = wrapEl.nextSibling;
    tablePanelEl.appendChild(wrapEl);
    tableControlEl.style.display = 'block';
    setTableCollapsed(true); // ยุบไว้เป็นค่าเริ่มต้นทุกครั้งที่เข้าเต็มจอ ให้ผู้ใช้กดแสดงเอง (จอเล็กจะได้ไม่บังแผนที่ทันที)
  } else {
    tableControlEl.style.display = 'none';
    if (tableWrapOriginalParent) {
      tableWrapOriginalParent.insertBefore(wrapEl, tableWrapOriginalNextSibling);
    }
  }
}

// สร้าง custom Leaflet control (ปุ่มยุบ/แสดง + กล่องใส่ .table-wrap) ซ่อนไว้ก่อน แสดงเมื่อเข้าเต็มจอเท่านั้น
function createTableToggleControl() {
  const TableToggleControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function () {
      const container = L.DomUtil.create('div', 'table-toggle-control leaflet-control');
      container.style.display = 'none';

      const btn = L.DomUtil.create('button', 'table-toggle-btn', container);
      btn.type = 'button';
      btn.innerHTML = `▴ ${t('tablePanel.label')}`;
      btn.title = t('tablePanel.hide');
      btn.setAttribute('aria-label', t('tablePanel.toggleAria'));

      const panel = L.DomUtil.create('div', 'table-panel', container);

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      btn.addEventListener('click', () => setTableCollapsed(!tableCollapsed));

      tableControlEl = container;
      tablePanelEl = panel;
      tableToggleBtn = btn;

      return container;
    },
  });

  map.addControl(new TableToggleControl());
}

// ==========================================
// เรียกจาก window.onLanguageChange (waterlevel-main.js) ตอนสลับภาษาแบบไม่รีเฟรชหน้า
// อัปเดต label ใน Leaflet layer control + popup ขอบเขตอำเภอ/ตำบล/หมู่บ้าน โดยไม่ fetch/parse geojson ซ้ำ
// ==========================================
function refreshLayerControlLabels() {
  const baseLabels = [t('layer.roadmap'), t('layer.satellite'), t('layer.terrain')];
  const overlayLabels = [t('layer.waterStations'), t('layer.district'), t('layer.tambon'), t('layer.village')];
  document.querySelectorAll('.leaflet-control-layers-base label span span').forEach((span, i) => {
    if (baseLabels[i] !== undefined) span.textContent = ` ${baseLabels[i]}`;
  });
  document.querySelectorAll('.leaflet-control-layers-overlays label span span').forEach((span, i) => {
    if (overlayLabels[i] !== undefined) span.textContent = ` ${overlayLabels[i]}`;
  });
}

function refreshBoundaryPopups() {
  if (districtLayer) {
    districtLayer.eachLayer((layer) => {
      const p = layer.feature.properties;
      const districtName = getLang() === 'en'
        ? (p.ADM2_EN || localizeName(p.ADM2_TH) || 'Unknown')
        : (p.ADM2_TH || 'ไม่ระบุ');
      const prefix = getLang() === 'en' ? '' : 'อำเภอ';
      layer.setPopupContent(`
        <div style="font-family: var(--font-body); padding: 2px;">
          <div style="font-size: 1.05rem; font-weight: 600; color: #38BDF8; margin-bottom: 4px;">
            ${prefix}${districtName}
          </div>
        </div>
      `);
    });
  }
  if (subdistrictLayer) {
    subdistrictLayer.eachLayer((layer) => {
      const p = layer.feature.properties;
      const tambonName = localizeName(p.TAM_NAM_T) || (getLang() === 'en' ? 'Unknown' : 'ไม่ระบุ');
      const amphoeName = localizeName(p.AMP_NAM_T) || (getLang() === 'en' ? 'Unknown' : 'ไม่ระบุ');
      const belongLabel = getLang() === 'en' ? 'District' : 'สังกัด';
      layer.setPopupContent(`
        <div style="font-family: var(--font-body); padding: 2px;">
          <div style="font-size: 1rem; font-weight: 600; color: #FBBF24; margin-bottom: 4px;">
            ${tambonName}
          </div>
          <div style="font-size: 0.85rem; color: #E7ECF3;">
            ${belongLabel}: ${amphoeName}
          </div>
        </div>
      `);
    });
  }
  if (villageLayer) {
    villageLayer.eachLayer((layer) => {
      const p = layer.feature.properties;
      const villName = localizeName(p.Name) || (getLang() === 'en' ? 'Unknown' : 'ไม่ระบุ');
      const moo = p.MOO_1 ? (getLang() === 'en' ? `Moo ${p.MOO_1}` : `หมู่ที่ ${p.MOO_1}`) : '';
      const tambon = localizeName(p.TAMBON_T) || '';
      const amphoe = localizeName(p.AMPHOE_T) || '';
      layer.setPopupContent(`
        <div style="font-family: var(--font-body); padding: 2px;">
          <div style="font-size: 0.95rem; font-weight: 600; color: #A855F7; margin-bottom: 4px;">
            ${villName} ${moo}
          </div>
          <div style="font-size: 0.85rem; color: #8A97AC;">
            ${tambon} ${amphoe}
          </div>
        </div>
      `);
    });
  }
}

function refreshMapLanguage() {
  refreshLayerControlLabels();
  refreshBoundaryPopups();
  setLegendCollapsed(legendCollapsed);
  setTableCollapsed(tableCollapsed);
}
