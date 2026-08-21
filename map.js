/* ==========================================================
   map.js — แผนที่สถานการณ์ฝน (โหมด monitoring ล้วนๆ)
   หน้าที่: init Leaflet แบบ dark basemap, วาดจุดสถานีตามสถานะ
   ========================================================== */
const DEBUG = false;
const log = DEBUG ? console.log.bind(console) : () => { };

const MAP_CENTER = [18.735, 97.998]; // อ.เมือง จ.แม่ฮ่องสอน
const MAP_ZOOM = 8;

// ----------------------------------------------------
// 1. ประกาศ LayerGroup แยกตามระดับขอบเขตการปกครอง
// ----------------------------------------------------
let map;
let layerControl; // ตัวแปรสำหรับเก็บ Layer Control ตัวหลักตัวเดียว
let stationLayer; // ชั้นข้อมูลสถานีวัดน้ำฝน
let districtLayer; // ชั้นข้อมูลขอบเขตอำเภอ
let subdistrictLayer; // ชั้นข้อมูลขอบเขตตำบล
let villageLayer; // ชั้นข้อมูลขอบเขตหมู่บ้าน
let idwLayer; // ชั้นข้อมูล IDW raster (คำนวณเองฝั่ง client จากจุดสถานี)
let idwImageOverlay = null; // reference รูป raster ล่าสุดที่วาดไว้ ให้ slider ปรับ opacity สดได้โดยไม่ต้องคำนวณใหม่
let idwOpacity = 0.75; // ค่าเริ่มต้นความโปร่งใสของ IDW raster (0–1) ปรับได้จากแถบเลื่อนบนแผนที่
let radarLayer; // ชั้นข้อมูลเรดาร์ฝน (RainViewer tile layer)
let stationMarkersById = {}; // เก็บ marker ต่อสถานี (key = station id) ไว้ให้คลิกจากตารางแล้วเปิด popup บนแผนที่ได้
let mhsGeoJSON = null; // [NEW] ตัวแปรเก็บข้อมูลรูปร่างขอบเขตอำเภอเพื่อทำ Mask IDW
let cachedInsideMask = null; // cache ผลเช็ค point-in-polygon ต่อพิกเซล (คำนวณครั้งเดียว ใช้ซ้ำได้เพราะรูปทรงอำเภอไม่เปลี่ยน)
let cachedMaskCols = 0, cachedMaskRows = 0;


// ----------------------------------------------------
// 2. เกณฑ์สถานะปริมาณฝน (มม.) — ใช้ร่วมกับ main.js (ต้องตรงกันทั้งสองไฟล์)
// ----------------------------------------------------
const RAIN_THRESHOLDS = { watch: 10, warning: 35, critical: 90 };

function classifyRainStatus(mm) {
  if (mm === null || mm === undefined || isNaN(mm)) return null;
  if (mm >= RAIN_THRESHOLDS.critical) return 'critical';
  if (mm >= RAIN_THRESHOLDS.warning) return 'warning';
  if (mm >= RAIN_THRESHOLDS.watch) return 'watch';
  return 'normal';
}

const STATUS_COLOR = {
  normal: '#34D399',
  watch: '#FBBF24',
  warning: '#FB923C',
  critical: '#F87171',
  unknown: '#5B6B84',
};

const STATUS_LABEL = {
  normal: 'เล็กน้อย',
  watch: 'ปานกลาง',
  warning: 'หนัก',
  critical: 'หนักมาก',
  unknown: 'ไม่มีข้อมูล',
};

// สี+ป้ายสำหรับข้อมูลสะสมหลายวัน (3d/5d/7d/15d) — เกณฑ์ตัวเลขเดียวกับ 24h (10/35/90)
// แต่ใช้สีคนละชุดจากพาเลตต์ที่ผู้ใช้กำหนด (สีบ่งชี้ปริมาณฝนสะสมแบบมาตรฐานอุตุฯ)
// 24h ไม่แตะต้องเลย ยังใช้ STATUS_COLOR/STATUS_LABEL เดิมด้านบนตามปกติ
const ACCUM_STATUS_COLOR = {
  normal: '#8FC3F5',   // ฟ้า — ฝนตกเล็กน้อย
  watch: '#5CC217',    // เขียว — ฝนตกปานกลาง
  warning: '#CC7A00',  // ส้ม/น้ำตาล — ฝนตกหนัก
  critical: '#E8241E', // แดง — ฝนตกหนักมาก
  unknown: '#5B6B84',
};
 
const ACCUM_STATUS_LABEL = {
  normal: 'เล็กน้อย',
  watch: 'ปานกลาง',
  warning: 'หนัก',
  critical: 'หนักมาก',
  unknown: 'ไม่มีข้อมูล',
};
 
// เช็คว่าช่วงเวลาปัจจุบันเป็นข้อมูลสะสมหลายวันไหม (ไม่ใช่ 24h) — currentPeriod มาจาก main.js
// (script แบบ classic ทั้งสองไฟล์อยู่ scope โกลบอลเดียวกัน จึงอ่านค่ากันได้โดยตรง)
function isAccumPeriod() {
  return typeof currentPeriod !== 'undefined' && currentPeriod !== 'rain_24h';
}

// สเกลสีแบบละเอียด 12 ช่วง สำหรับข้อมูลสะสมหลายวัน (3d/5d/7d/15d) — ตาม breakpoint
// 1/5/10/20/35/50/70/90/150/200/300 มม. จากพาเลตต์อ้างอิงมาตรฐาน จัดกลุ่มเป็น 4 หมวดใหญ่:
// เล็กน้อย(0-10) / ปานกลาง(10-35) / หนัก(35-90) / หนักมาก(>90) — ตรงกับ RAIN_THRESHOLDS เดิมเป๊ะ
const ACCUM_SCALE = [
  { max: 1, color: '#F0F0F0' },
  { max: 5, color: '#CDE3FA' },
  { max: 10, color: '#8FC3F5' },
  { max: 20, color: '#93E8B5' },
  { max: 35, color: '#5CC217' },
  { max: 50, color: '#E8D400' },
  { max: 70, color: '#FF9100' },
  { max: 90, color: '#CC7A00' },
  { max: 150, color: '#E8241E' },
  { max: 200, color: '#B33430' },
  { max: 300, color: '#7A1F1F' },
  { max: Infinity, color: '#9B4FC4' },
];
 
// หมวดใหญ่ 4 กลุ่ม พร้อมจำนวนช่วงย่อยที่แต่ละกลุ่มครอบคลุม (ใช้ตอนวาด legend แบบ proportional width)
const ACCUM_GROUPS = [
  { label: 'ฝนเล็กน้อย', segments: 3 },  // 0–10 มม. (<1, 1–5, 5–10)
  { label: 'ฝนปานกลาง', segments: 2 },   // 10–35 มม. (10–20, 20–35)
  { label: 'ฝนหนัก', segments: 3 },      // 35–90 มม. (35–50, 50–70, 70–90)
  { label: 'ฝนหนักมาก', segments: 4 },   // >90 มม. (90–150, 150–200, 200–300, >300)
];
 
function accumRainColor(mm) {
  if (mm === null || mm === undefined || isNaN(mm)) return '#5B6B84';
  const clamped = Math.max(0, mm);
  for (const step of ACCUM_SCALE) {
    if (clamped <= step.max) return step.color;
  }
  return ACCUM_SCALE[ACCUM_SCALE.length - 1].color;
}

// ----------------------------------------------------
// 3. เกณฑ์สีละเอียดสำหรับ "ฝนสะสมรายเดือน" และ "ฝนสะสมรายปี" (ตามตารางเกณฑ์อ้างอิง)
//    ใช้เฉพาะ 2 ช่วงเวลานี้เท่านั้น (rain_monthly / rain_yearly)
//    ช่วงเวลาอื่น (24h/3d/5d/7d/15d) ยังใช้เกณฑ์ 4 ระดับเดิมทุกอย่าง ไม่แตะต้อง
//    max = ขอบบนของช่วง (รวมค่านั้น), label = ข้อความช่วงตามตารางต้นฉบับ
// ----------------------------------------------------
const MONTHLY_RAIN_SCALE = [
  { max: 10, label: '0-10', color: '#FFFFFF' },
  { max: 20, label: '>10-20', color: '#FFFFCC' },
  { max: 40, label: '>20-40', color: '#FFFF99' },
  { max: 80, label: '>40-80', color: '#FFFF00' },
  { max: 100, label: '>80-100', color: '#CCFF00' },
  { max: 120, label: '>100-120', color: '#99FF00' },
  { max: 140, label: '>120-140', color: '#66FF00' },
  { max: 150, label: '>140-150', color: '#33FF00' },
  { max: 160, label: '>150-160', color: '#00FF00' },
  { max: 170, label: '>160-170', color: '#00FF66' },
  { max: 180, label: '>170-180', color: '#00FF99' },
  { max: 190, label: '>180-190', color: '#00FFCC' },
  { max: 200, label: '>190-200', color: '#00FFFF' },
  { max: 210, label: '>200-210', color: '#00CCFF' },
  { max: 220, label: '>210-220', color: '#0099FF' },
  { max: 230, label: '>220-230', color: '#0066FF' },
  { max: 240, label: '>230-240', color: '#0033FF' },
  { max: 250, label: '>240-250', color: '#0000FF' },
  { max: 260, label: '>250-260', color: '#3300CC' },
  { max: 270, label: '>260-270', color: '#6600CC' },
  { max: 280, label: '>270-280', color: '#9900E6' },
  { max: 300, label: '>280-300', color: '#CC00FF' },
  { max: 500, label: '>300-500', color: '#FF00CC' },
  { max: 700, label: '>500-700', color: '#FF0033' },
  { max: Infinity, label: '>700-3,000', color: '#CC0000' },
];

// หมายเหตุ: ตารางต้นฉบับรายปีข้ามช่วง 1,900–2,000 ไป (จาก >1,800-1,900 ไป >2,000-2,100)
// ที่นี่จึงให้ค่า 1,900–2,000 ตกเข้าช่วง '>2,000-2,100' เพื่อไม่ให้มีค่าที่ไม่มีสี
const YEARLY_RAIN_SCALE = [
  { max: 200, label: '0-200', color: '#FFFFFF' },
  { max: 400, label: '>200-400', color: '#FFFFCC' },
  { max: 600, label: '>400-600', color: '#FFFFB3' },
  { max: 800, label: '>600-800', color: '#FFFF99' },
  { max: 1000, label: '>800-1,000', color: '#FFFF66' },
  { max: 1040, label: '>1,000-1,040', color: '#FFFF33' },
  { max: 1080, label: '>1,040-1,080', color: '#FFFF00' },
  { max: 1120, label: '>1,080-1,120', color: '#CCFF00' },
  { max: 1160, label: '>1,120-1,160', color: '#99FF00' },
  { max: 1200, label: '>1,160-1,200', color: '#66FF00' },
  { max: 1260, label: '>1,200-1,260', color: '#33FF00' },
  { max: 1320, label: '>1,260-1,320', color: '#00FF00' },
  { max: 1380, label: '>1,320-1,380', color: '#00FF33' },
  { max: 1440, label: '>1,380-1,440', color: '#00FF66' },
  { max: 1500, label: '>1,440-1,500', color: '#00FF99' },
  { max: 1600, label: '>1,500-1,600', color: '#00FFCC' },
  { max: 1700, label: '>1,600-1,700', color: '#00FFFF' },
  { max: 1800, label: '>1,700-1,800', color: '#00CCFF' },
  { max: 1900, label: '>1,800-1,900', color: '#0099FF' },
  { max: 2100, label: '>2,000-2,100', color: '#0000FF' },
  { max: 2200, label: '>2,100-2,200', color: '#3300CC' },
  { max: 2300, label: '>2,200-2,300', color: '#6600CC' },
  { max: 2400, label: '>2,300-2,400', color: '#9900E6' },
  { max: 2500, label: '>2,400-2,500', color: '#CC00FF' },
  { max: 3000, label: '>2,500-3,000', color: '#FF00CC' },
  { max: 3500, label: '>3,000-3,500', color: '#FF0066' },
  { max: 4000, label: '>3,500-4,000', color: '#E60000' },
  { max: 5000, label: '>4,000-5,000', color: '#CC0000' },
  { max: Infinity, label: '>5,000-8,000', color: '#990000' },
];

// คืนสเกลละเอียดของช่วงเวลาที่กำลังดูอยู่ — ถ้าไม่ใช่รายเดือน/รายปี คืน null (= ใช้เกณฑ์เดิม)
function getFineRainScale(period) {
  if (period === 'rain_monthly') return MONTHLY_RAIN_SCALE;
  if (period === 'rain_yearly') return YEARLY_RAIN_SCALE;
  return null;
}

// currentPeriod ประกาศไว้ที่ main.js (script แบบ classic อยู่ scope โกลบอลเดียวกัน)
function currentFineRainScale() {
  return getFineRainScale(typeof currentPeriod !== 'undefined' ? currentPeriod : null);
}

// หาช่วงของค่าฝน (มม.) ในสเกลละเอียด → คืน { max, label, color } หรือ null ถ้าไม่มีข้อมูล
function classifyFineRain(mm, scale) {
  if (!scale) return null;
  if (mm === null || mm === undefined || isNaN(mm)) return null;
  const clamped = Math.max(0, mm);
  for (const step of scale) {
    if (clamped <= step.max) return step;
  }
  return scale[scale.length - 1];
}

// เลือกสีตัวอักษรดำ/ขาวให้อ่านออกบนพื้นสีที่ให้มา (สเกลนี้มีทั้งขาวและน้ำเงินเข้ม)
function contrastTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0B1220' : '#FFFFFF';
}

//==========================================================
// 4. ฟังก์ชันเริ่มต้นสร้างแผนที่ (initMap)
//==========================================================
function initMap() {
  // --- 2.1 สร้าง Base Maps (แผนที่ฐาน) ---
  map = L.map('map', { zoomControl: true, attributionControl: false })
    .setView(MAP_CENTER, MAP_ZOOM);

  // ==========================================================
  // GPS Control — แสดงตำแหน่งปัจจุบันของผู้ใช้
  // ==========================================================
  function addGPSControl() {
    const GPSControl = L.Control.extend({
      options: {
        position: 'topleft',
      },

      onAdd: function (mapInstance) {
        const container = L.DomUtil.create(
          'div',
          'leaflet-bar leaflet-control'
        );

        const button = L.DomUtil.create(
          'a',
          'gps-control',
          container
        );

        button.href = '#';
        button.title = 'ตำแหน่งปัจจุบัน';
        button.innerHTML = '⌖';
        button.setAttribute('role', 'button');
        button.setAttribute('aria-label', 'ตำแหน่งปัจจุบัน');

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

  // ==========================================================
  // Get Current Location
  // ==========================================================
  function getCurrentLocation(mapInstance) {
    if (!navigator.geolocation) {
      alert('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;

        // ลบตำแหน่งเดิม
        if (window.userLocationMarker) {
          mapInstance.removeLayer(window.userLocationMarker);
        }

        if (window.userLocationCircle) {
          mapInstance.removeLayer(window.userLocationCircle);
        }

        // จุดตำแหน่งปัจจุบัน
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

        // วงกลม Accuracy
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

        // Popup
        window.userLocationMarker.bindPopup(`
        <strong>📍 ตำแหน่งปัจจุบัน</strong><br>
        Latitude: ${latitude.toFixed(6)}<br>
        Longitude: ${longitude.toFixed(6)}<br>
        Accuracy: ±${Math.round(accuracy)} m
      `);

        // Zoom ไปตำแหน่งปัจจุบัน
        mapInstance.setView(
          [latitude, longitude],
          15
        );

        window.userLocationMarker.openPopup();
      },

      (error) => {
        let message = 'ไม่สามารถระบุตำแหน่งได้';

        switch (error.code) {
          case error.PERMISSION_DENIED:
            message = 'ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง';
            break;

          case error.POSITION_UNAVAILABLE:
            message = 'ไม่สามารถระบุตำแหน่งปัจจุบันได้';
            break;

          case error.TIMEOUT:
            message = 'หมดเวลาในการค้นหาตำแหน่ง';
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

  // ปุ่มขยายแผนที่เต็มจอ — ใช้ pseudo-fullscreen ด้วย CSS (position:fixed) แทน Fullscreen API
  // ของเบราว์เซอร์ล้วนๆ เพราะ Fullscreen API มีปัญหาไม่สม่ำเสมอข้ามอุปกรณ์:
  //   - iOS Safari ไม่รองรับ requestFullscreen() กับ element ทั่วไปเลย (รองรับแค่ <video>)
  //   - PWA แบบ Add to Home Screen (standalone) บางเครื่อง report ว่ารองรับ API แต่ใช้งานจริงไม่ได้
  //   - พอเป็น fullscreen จริงของ OS แล้ว swipe down (ปัดเรียก notification/address bar) จะ exit
  //     fullscreen ให้เองโดยเราคุมไม่ได้ ทำให้ผู้ใช้หลุดจากโหมดเต็มจอโดยไม่ได้ตั้งใจ
  // ใช้ CSS ล้วนๆ ทำงานเหมือนกันทุกอุปกรณ์แน่นอน ไม่มี OS เข้ามาแทรกแซง
  const FullscreenControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function (mapInstance) {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-fullscreen');
      const link = L.DomUtil.create('a', 'fullscreen-icon', container);
      link.href = '#';
      link.title = 'ขยายแผนที่เต็มจอ';
      link.innerHTML = '⛶';
      link.setAttribute('role', 'button');
      link.setAttribute('aria-label', 'สลับโหมดเต็มจอ');

      const togglePseudoFullscreen = () => {
        const mapEl = mapInstance.getContainer();
        mapEl.classList.toggle('pseudo-fullscreen');
        document.body.classList.toggle('pseudo-fullscreen-active');
        setTimeout(() => mapInstance.invalidateSize(), 100);

        const isActive = mapEl.classList.contains('pseudo-fullscreen');
        link.innerHTML = isActive ? '✕' : '⛶';
        link.title = isActive ? 'ออกจากเต็มจอ' : 'ขยายแผนที่เต็มจอ';

        toggleLegendInFullscreen(isActive); // ย้าย legend เข้า/ออกมุมซ้ายล่าง (มุมเดียวกับปุ่ม play เรดาร์)
        toggleFiltersInFullscreen(isActive); // ย้ายแถบตัวกรอง (ช่วงเวลา/อำเภอ/ตำบล/หน่วยงาน) เข้า/ออกมุมขวาบน
        toggleTableInFullscreen(isActive); // ย้ายตารางข้อมูล เข้า/ออกมุมขวาล่าง
      };

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(link, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        togglePseudoFullscreen();
      });

      // กด Esc บนคีย์บอร์ด (เดสก์ท็อป) ก็ออกจากโหมดเต็มจอได้ด้วย — สะดวกเพิ่มจากปุ่ม X
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

  // ปุ่ม "📈 ดูกราฟย้อนหลัง" ใน popup ของจุดสถานี — ใช้ event delegation เพราะ popup ถูกสร้าง/ทำลายใหม่
  // ทุกครั้งที่ renderStationMarkers() รัน (ทุก 5 นาที/เปลี่ยน filter) ผูก listener ตรงๆ ทีละปุ่มจะหลุดหมด
  // openStationChart/fetchStationRainChart มาจาก station-chart.js/main.js (โหลดหลัง map.js แต่เรียกตอน
  // คลิกจริงซึ่งทุกไฟล์โหลดเสร็จแล้วแน่นอน จึงอ้างอิงข้ามไฟล์แบบนี้ได้ปลอดภัย)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.popup-chart-btn');
    if (!btn) return;
    if (typeof openStationChart === 'function' && typeof fetchStationRainChart === 'function') {
      openStationChart(btn.dataset.id, btn.dataset.name, fetchStationRainChart);
    }
  });

  // Basemap มืด (CartoDB Dark Matter) ให้เข้ากับธีมหน้าเว็บ
  const CartoDB_DarkMatter = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    // attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 25,
    subdomains: 'abcd',
  }).addTo(map);

  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    // attribution: '© OpenStreetMap contributors',
    maxZoom: 25,
  });

  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    // attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 25
  });

  const terrainLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    // attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    maxZoom: 25,
  });

  const baseMaps = {
    'แผนที่โทนมืด': CartoDB_DarkMatter,
    'แผนที่ถนน': osmLayer,
    'ภาพถ่ายดาวเทียม': satelliteLayer,
    'แผนที่ภูมิประเทศ': terrainLayer
  };

  layerControl = L.control.layers(baseMaps, {}, { collapsed: true }).addTo(map);

  // 2. ดึง Element ของกล่อง Layer Control
  const container = layerControl.getContainer();

  container.classList.add('click-only-layer-control');

  // 3. ปิดระบบ Hover (เอาเมาส์ชี้แล้วกาง/เอาเมาส์ออกแล้วปิด) เดิมของ Leaflet
  L.DomEvent.off(container, 'mouseenter', layerControl.expand, layerControl);
  L.DomEvent.off(container, 'mouseleave', layerControl.collapse, layerControl);

  // 4. เพิ่มระบบ Click Toggle บนไอคอนปุ่ม (กดครั้งแรกเปิด - กดอีกครั้งปิด)
  const toggleBtn = container.querySelector('.leaflet-control-layers-toggle');
  L.DomEvent.on(toggleBtn, 'click', function (e) {
    L.DomEvent.stop(e); // ป้องกันไม่ให้การคลิกทะลุไปโดนแผนที่

    // เช็กว่ากล่องเปิดอยู่หรือไม่
    if (container.classList.contains('leaflet-control-layers-expanded')) {
      layerControl.collapse(); // ถ้าเปิดอยู่ให้ยุบปิด
    } else {
      layerControl.expand();   // ถ้าปิดอยู่ให้กางเปิด
    }
  });

  // 5. เมื่อคลิกที่พื้นที่ว่างบนแผนที่ ให้ยุบกล่องกลับเป็นปุ่มโดยอัตโนมัติ
  map.on('click', 'popupopen', function () {
    layerControl.collapse();
  });

  map.on('popupopen', function () {
    layerControl.collapse();
  });

  // [NEW] สร้าง Map Panes เพื่อจัดการ Z-Index
  // z-index 200 = Base Maps (ค่า Default)
  // z-index 300 = Boundary (ให้อยู่เหนือ Basemap แต่ต่ำกว่าจุดสถานี)
  // z-index 500 = Station (ให้อยู่บนสุดเหนือชั้นอื่นๆ)

  map.createPane('boundaryPane');
  map.getPane('boundaryPane').style.zIndex = 350;
  map.getPane('boundaryPane').style.pointerEvents = 'none';

  map.createPane('stationPane');
  map.getPane('stationPane').style.zIndex = 550;

  // IDW raster ต้องอยู่ล่างสุดของชั้นทั้งหมด (เหนือแค่ basemap) ไม่งั้นจะไปบังเส้นขอบเขตอำเภอ/ตำบล/หมู่บ้าน
  // และจุดสถานีที่ต้องอยู่บนสุดเสมอ — เดิม zIndex 400 สูงกว่า boundaryPane (350) จึงไปทับเส้นขอบเขต
  map.createPane('idwPane');
  map.getPane('idwPane').style.zIndex = 300;
  map.getPane('idwPane').style.pointerEvents = 'none'; // ไม่บังการคลิกจุดสถานี/ขอบเขตที่อยู่ข้างบน

  idwLayer = L.layerGroup(); // ยังไม่ addTo(map) — ปิดไว้ก่อนโดย default เหมือน layer ตำบล/หมู่บ้าน
  layerControl.addOverlay(idwLayer, 'IDW ปริมาณฝน (Interpolation)');

  // เรดาร์ฝน (RainViewer) — เป็น raster เหมือน IDW แต่อยู่คนละ pane กัน (สลับดูทีละชั้นได้)
  map.createPane('radarPane');
  map.getPane('radarPane').style.zIndex = 380;
  map.getPane('radarPane').style.pointerEvents = 'none';

  // RainViewer เก็บ tile เรดาร์จริงถึงแค่ zoom 7 (ทั้งขนาด 256/512px) — ซูมเกินนี้เซิร์ฟเวอร์คืนภาพ
  // "Zoom Level Not Supported" แทน ต้องล็อก maxNativeZoom ไว้ที่ 7 แล้วปล่อยให้ Leaflet
  // ขยาย (stretch) tile zoom 7 เดิมเองตอนซูมเข้าเกินนั้น (maxZoom ให้ตรงกับ basemap อื่นๆ)
  radarLayer = L.tileLayer('', {
    pane: 'radarPane',
    opacity: 0.65,
    attribution: '',
    maxNativeZoom: 7,
    maxZoom: 25,
  });
  layerControl.addOverlay(radarLayer, 'เรดาร์ฝน (RainViewer)');
  createRadarControl();
  createIdwOpacityControl(); // แถบเลื่อนความโปร่งใสของ IDW raster — โผล่เฉพาะตอนเปิด layer IDW
  createFilterControl(); // ปุ่มยุบ/แสดงตัวกรอง (ช่วงเวลา/อำเภอ/ตำบล/หน่วยงาน) — โผล่เฉพาะตอนแผนที่เต็มจอ
  createLegendToggleControl(); // ปุ่มยุบ/แสดงคำอธิบายสัญลักษณ์ (Map Legend) — โผล่เฉพาะตอนแผนที่เต็มจอ
  createTableToggleControl(); // ปุ่มยุบ/แสดงตารางข้อมูล — โผล่เฉพาะตอนแผนที่เต็มจอ

  // สร้าง Group ของจุดสถานีและเพิ่มเข้าไปใน Layer Control
  stationLayer = L.layerGroup().addTo(map);
  layerControl.addOverlay(stationLayer, 'สถานีตรวจวัดน้ำฝน');

  // เปิด layer IDW เมื่อไหร่ ให้คำนวณทันที (ไม่ต้องรอรอบ auto-refresh ถัดไป)
  map.on('overlayadd', function (e) {
    if (e.layer === idwLayer) {
      renderIdwLayer(allStations);
      showIdwOpacityControl();
    }
    if (e.layer === radarLayer) startRadar();
  });
  map.on('overlayremove', function (e) {
    if (e.layer === idwLayer) hideIdwOpacityControl();
    if (e.layer === radarLayer) stopRadar();
  });

  loadBoundaryLayers(); // วาดขอบเขตจังหวัด/อำเภอ
  renderMapLegend();     // วาด legend ใต้แผนที่
}

// ==========================================
// 5. ฟังก์ชันดึงไฟล์ GeoJSON และสร้าง Pop-up แบบ Identify (เพิ่มใหม่)
// ==========================================
/* ---------------- 2. โหลดขอบเขตการปกครอง GeoJSON ---------------- */
async function loadBoundaryLayers() {
  const districtStyle = { color: '#38BDF8', weight: 2, opacity: 0.85, fillColor: '#38BDF8', fillOpacity: 0.08 };
  const tambonStyle = { color: '#FBBF24', weight: 1.2, dashArray: '4, 4', opacity: 0.75, fillColor: '#FBBF24', fillOpacity: 0.04 };
  const villageStyle = { color: '#A855F7', weight: 0.8, dashArray: '2, 3', opacity: 0.6, fillColor: '#A855F7', fillOpacity: 0.02 };

  try {
    // --- 2.1 โหลดขอบเขตอำเภอ (mhs_district.geojson) ---
    const resDistrict = await fetch('mhs_district.geojson');
    const dataDistrict = await resDistrict.json();

    mhsGeoJSON = dataDistrict; // บันทึก GeoJSON ไว้ตอนสร้าง IDW

    districtLayer = L.geoJSON(dataDistrict, {
      pane: 'boundaryPane', //บังคับให้อยู่ใน Layer ชั้นล่าง
      style: districtStyle,
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        const districtName = p.ADM2_TH || 'ไม่ระบุ';
        const pcode = p.ADM2_PCODE || '-';

        layer.bindPopup(`
          <div style="font-family: var(--font-body); padding: 2px;">
            <div style="font-size: 1.05rem; font-weight: 600; color: #38BDF8; margin-bottom: 4px;">
              อำเภอ${districtName}
            </div>
          </div>
        `);
        // layer.bindTooltip(`อ.${districtName}`, { sticky: true, direction: 'center' });
      }
    });
    layerControl.addOverlay(districtLayer, 'ขอบเขตอำเภอ')

    // --- 2.2 โหลดขอบเขตตำบล (mhs_tambon.geojson) ---
    const resTambon = await fetch('mhs_tambon.geojson');
    const dataTambon = await resTambon.json();
    subdistrictLayer = L.geoJSON(dataTambon, {
      pane: 'boundaryPane', //บังคับให้อยู่ใน Layer ชั้นล่าง
      style: tambonStyle,
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        const tambonName = p.TAM_NAM_T || 'ไม่ระบุ';
        const amphoeName = p.AMP_NAM_T || 'ไม่ระบุ';

        layer.bindPopup(`
          <div style="font-family: var(--font-body); padding: 2px;">
            <div style="font-size: 1rem; font-weight: 600; color: #FBBF24; margin-bottom: 4px;">
              ${tambonName}
            </div>
            <div style="font-size: 0.85rem; color: #E7ECF3;">
              สังกัด: ${amphoeName}
            </div>
          </div>
        `);
      }
    });
    layerControl.addOverlay(subdistrictLayer, 'ขอบเขตตำบล')

    // --- 2.3 โหลดขอบเขตหมู่บ้าน (mhs_village.geojson) ---
    const resVillage = await fetch('mhs_village.geojson');
    const dataVillage = await resVillage.json();
    villageLayer = L.geoJSON(dataVillage, {
      pane: 'boundaryPane', //บังคับให้อยู่ใน Layer ชั้นล่าง
      style: villageStyle,
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        const villName = p.Name || 'ไม่ระบุ';
        const moo = p.MOO_1 ? `หมู่ที่ ${p.MOO_1}` : '';
        const tambon = p.TAMBON_T || '';
        const amphoe = p.AMPHOE_T || '';

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
    layerControl.addOverlay(villageLayer, 'ขอบเขตหมู่บ้าน')

    // เปิดแสดงขอบเขตอำเภอไว้เป็นค่าเริ่มต้น
    districtLayer.addTo(map);

    // ดึงหมุดสถานีน้ำฝนขึ้นมาไว้ชั้นบนสุด
    if (stationLayer) stationLayer.bringToFront();

    // สร้าง Map Control เปิด-ปิด Layer (มุมขวาบน)
    const overlayLayers = {
      'ขอบเขตอำเภอ': districtLayer,
      'ขอบเขตตำบล': subdistrictLayer,
      'ขอบเขตหมู่บ้าน': villageLayer,
      'สถานีตรวจวัดน้ำฝน': stationLayer
    };

  } catch (error) {
    // console.error('เกิดข้อผิดพลาดในการโหลดไฟล์ GeoJSON:', error);
  }
}

// ==========================================
// 6. วาดจุดสถานีวัดน้ำฝนบนแผนที่
// ==========================================
// วาดจุดสถานีตามสถานะ (สี + ขนาดใหญ่ขึ้นตามความรุนแรง)
// stations: [{ id, name, district, lat, lng, rainfall }]
function renderStationMarkers(stations, isFiltered = false) {
  stationLayer.clearLayers();
  stationMarkersById = {}; // ล้าง registry เดิมทิ้งพร้อมกับ marker เก่า กันอ้างอิง marker ที่ถูกลบไปแล้ว

  // รายเดือน/รายปี ใช้สเกลสีละเอียดตามตารางเกณฑ์ ช่วงเวลาอื่นใช้สถานะ 4 ระดับเดิม
  const fineScale = currentFineRainScale();

  stations.forEach((s) => {
    const status = classifyRainStatus(s.rainfall) || 'unknown';
    const band = classifyFineRain(s.rainfall, fineScale);
    const color = band ? band.color : STATUS_COLOR[status];
    const statusText = band ? `${band.label} มม.` : STATUS_LABEL[status];
    const radius = status === 'critical' ? 9 : status === 'warning' ? 8 : 7;

    const marker = L.circleMarker([s.lat, s.lng], {
      pane: 'stationPane',
      radius: 9,
      weight: 3,
      color: '#0B1220',
      opacity: 1,
      fillColor: color,
      fillOpacity: 0.9,
      interactive: true
    });

    const rainText = s.rainfall !== null && !isNaN(s.rainfall) ? `${s.rainfall.toFixed(1)} มม.` : 'ไม่มีข้อมูล';

    marker.bindPopup(`
      <strong>${s.name}</strong><br>
      ตำบล${s.subDistrict || '-'}<br>
      อำเภอ${s.district || '-'}<br>
      ปริมาณฝน: ${rainText}<br>
      ${band ? 'ช่วงเกณฑ์' : 'สถานะ'}: <span style="color:${color}; font-weight:600;">${statusText}</span><br>
      <button type="button" class="popup-chart-btn" data-id="${s.id}" data-name="${s.name}">📈 ดูกราฟย้อนหลัง</button>
    `);

    // Hover เปิด popup อัตโนมัติ — เฉพาะอุปกรณ์ที่รองรับ hover จริง (มีเมาส์) เท่านั้น
    // บนมือถือ/ทัชสกรีน บาง browser จำลอง mouseover→mouseout ให้ตอนแตะหน้าจอ "ก่อน" event
    // click จริงจะยิง ถ้าผูก mouseout ไว้ด้วยจะสั่งปิด popup ก่อน click จะทันปักหมุด ทำให้
    // popup เด้งแล้วหายทันที — เช็ค (hover: hover) กันไว้ ตัดปัญหานี้ทิ้งไปทั้งหมด
    const supportsHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;

    if (supportsHover) {
      let isPinnedByClick = false; // ประกาศด้วย let ในนี้ ให้แยกคนละตัวต่อ marker ไม่ปนกัน
      marker.on('mouseover', () => marker.openPopup());
      marker.on('mouseout', () => {
        if (!isPinnedByClick) marker.closePopup();
      });
      marker.on('click', () => {
        isPinnedByClick = true;
        marker.openPopup();
      });
      marker.on('popupclose', () => {
        isPinnedByClick = false; // popup ปิดแล้ว (คลิกที่อื่น/คลิกซ้ำ) รีเซ็ตกลับเป็นโหมด hover ปกติ
      });
    }
    // อุปกรณ์ทัชสกรีน: ไม่ผูก listener เพิ่ม ปล่อยให้ใช้ click-to-toggle ของ Leaflet (bindPopup) ตามปกติ

    stationMarkersById[s.id] = marker; // จำ marker ไว้ ให้คลิกแถวในตารางแล้วเปิด popup จุดนี้บนแผนที่ได้

    marker.addTo(stationLayer);
  });
}

// เรียกตอนคลิกแถวในตาราง (js/main.js) — เลื่อนแผนที่ไปหาสถานีนั้นแล้วเปิด popup ให้
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

  // เลื่อนหน้าจอขึ้นไปให้เห็นแผนที่ด้วย เผื่อผู้ใช้กำลังดูตารางที่อยู่ใต้แผนที่ (โดยเฉพาะจอมือถือ)
  const mapEl = document.getElementById('map');
  if (mapEl && !mapEl.classList.contains('pseudo-fullscreen')) {
    mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ==========================================
// 7. IDW Interpolation Raster + Mask ตามขอบเขตอำเภอ
// ==========================================

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

// สีต่อเนื่องตามปริมาณฝน
function rainfallToRGB(mm) {
  // รายเดือน/รายปี: ใช้สีเป็น "ช่วงเกณฑ์" (class) เดียวกับ legend ด้านล่างแผนที่ (MONTHLY/YEARLY_RAIN_SCALE)
  // ไม่ใช้ไล่เฉดต่อเนื่องแบบ 24h เพราะสเกลค่าต่างกันมาก (24h เพดาน 90 มม. vs รายปีหลักพันมม.)
  const fineScale = currentFineRainScale();
  if (fineScale) {
    const band = classifyFineRain(mm, fineScale);
    return hexToRgb(band ? band.color : '#5B6B84');
  }

  const stops = [
    { v: 0, c: [52, 211, 153] },
    { v: RAIN_THRESHOLDS.watch, c: [251, 191, 36] },
    { v: RAIN_THRESHOLDS.warning, c: [251, 146, 60] },
    { v: RAIN_THRESHOLDS.critical, c: [248, 113, 113] }
  ];

  const clamped = Math.max(0, Math.min(mm, stops[stops.length - 1].v));
  let lo = stops[0], hi = stops[stops.length - 1];

  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i].v && clamped <= stops[i + 1].v) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }

  const t = hi.v === lo.v ? 0 : (clamped - lo.v) / (hi.v - lo.v);
  return [0, 1, 2].map(i => Math.round(lo.c[i] + (hi.c[i] - lo.c[i]) * t));
}


// IDW: ประมาณค่าฝน ณ จุด (lat, lng)
function idwInterpolate(lat, lng, stations, power = 2) {
  let sumW = 0, sumWV = 0;

  for (const s of stations) {
    const d = Math.hypot(s.lat - lat, s.lng - lng);
    if (d < 1e-6) return s.rainfall;

    const w = 1 / Math.pow(d, power);
    sumW += w;
    sumWV += w * s.rainfall;
  }

  return sumW === 0 ? 0 : sumWV / sumW;
}


// ตรวจว่า Point อยู่ใน Polygon หรือไม่
function pointInPolygon(point, polygon) {
  const x = point[0], y = point[1];
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];

    const intersect =
      ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);

    if (intersect) inside = !inside;
  }

  return inside;
}


// ตรวจ Point ว่าอยู่ใน GeoJSON หรือไม่
// รองรับ Polygon + MultiPolygon
function pointInGeoJSON(lat, lng, geojson) {
  if (!geojson || !geojson.features) return true;

  const point = [lng, lat]; // GeoJSON ใช้ [lng, lat]

  for (const feature of geojson.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;

    // Polygon
    if (geometry.type === 'Polygon') {
      const rings = geometry.coordinates;

      if (pointInPolygon(point, rings[0])) {
        let insideHole = false;

        for (let i = 1; i < rings.length; i++) {
          if (pointInPolygon(point, rings[i])) {
            insideHole = true;
            break;
          }
        }

        if (!insideHole) return true;
      }
    }

    // MultiPolygon
    else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) {
        if (pointInPolygon(point, polygon[0])) {
          let insideHole = false;

          for (let i = 1; i < polygon.length; i++) {
            if (pointInPolygon(point, polygon[i])) {
              insideHole = true;
              break;
            }
          }

          if (!insideHole) return true;
        }
      }
    }
  }

  return false;
}


// หา Bounds ของ GeoJSON
function getGeoJSONBounds(geojson) {
  const bounds = L.geoJSON(geojson).getBounds();

  return {
    minLat: bounds.getSouth(),
    maxLat: bounds.getNorth(),
    minLng: bounds.getWest(),
    maxLng: bounds.getEast()
  };
}


// วาด IDW Raster + Mask ตามขอบเขตอำเภอ
function renderIdwLayer(stations) {
  if (!idwLayer || !map.hasLayer(idwLayer)) return;

  idwLayer.clearLayers();

  const valid = (stations || []).filter(
    s => s.rainfall !== null &&
      !isNaN(s.rainfall) &&
      !isNaN(s.lat) &&
      !isNaN(s.lng)
  );

  if (valid.length < 3) {
    console.warn('IDW: สถานีไม่เพียงพอสำหรับการคำนวณ');
    return;
  }

  if (!mhsGeoJSON) {
    console.warn('IDW: ยังไม่มี mhsGeoJSON');
    return;
  }

  // ใช้ขอบเขตอำเภอเป็น Extent ของ Raster
  const { minLat, maxLat, minLng, maxLng } = getGeoJSONBounds(mhsGeoJSON);

  // ความละเอียด Raster
  const cols = 160, rows = 160;

  // คำนวณ mask (พิกเซลไหนอยู่ในขอบเขตอำเภอบ้าง) แค่ครั้งแรก แล้ว cache ไว้ใช้ซ้ำ
  // เพราะรูปทรงอำเภอไม่เคยเปลี่ยนระหว่างที่หน้าเว็บเปิดอยู่ — เปลี่ยนแค่ค่าฝนเท่านั้น
  // point-in-polygon เป็นส่วนที่หนักที่สุด ตัดออกจากทุกครั้งที่ข้อมูลรีเฟรช เหลือคำนวณครั้งเดียว
  if (!cachedInsideMask || cachedMaskCols !== cols || cachedMaskRows !== rows) {
    cachedInsideMask = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const lat = maxLat - (r / (rows - 1)) * (maxLat - minLat);
      for (let c = 0; c < cols; c++) {
        const lng = minLng + (c / (cols - 1)) * (maxLng - minLng);
        cachedInsideMask[r * cols + c] = pointInGeoJSON(lat, lng, mhsGeoJSON) ? 1 : 0;
      }
    }
    cachedMaskCols = cols;
    cachedMaskRows = rows;
  }

  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;

  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(cols, rows);

  // คำนวณ IDW ทีละ Pixel (เช็คขอบเขตจาก cache แทน point-in-polygon สด — เร็วขึ้นมาก)
  for (let r = 0; r < rows; r++) {
    const lat = maxLat - (r / (rows - 1)) * (maxLat - minLat);

    for (let c = 0; c < cols; c++) {
      const lng = minLng + (c / (cols - 1)) * (maxLng - minLng);
      const idx = (r * cols + c) * 4;

      // ตรวจว่า Pixel อยู่ในขอบเขตหรือไม่ (จาก cache)
      if (!cachedInsideMask[r * cols + c]) {
        imgData.data[idx] = 0;
        imgData.data[idx + 1] = 0;
        imgData.data[idx + 2] = 0;
        imgData.data[idx + 3] = 0;
        continue;
      }

      // คำนวณ IDW
      const val = idwInterpolate(lat, lng, valid);
      const [red, green, blue] = rainfallToRGB(val);

      imgData.data[idx] = red;
      imgData.data[idx + 1] = green;
      imgData.data[idx + 2] = blue;
      imgData.data[idx + 3] = 165;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  const bounds = [[minLat, minLng], [maxLat, maxLng]];

  // opacity ใช้ค่าจากแถบเลื่อน (idwOpacity) แทนค่าคงที่ — เก็บ reference ไว้ให้ slider ปรับสดได้ทันที
  // โดยไม่ต้องคำนวณ raster ใหม่ (setOpacity ปรับแค่ CSS opacity ของรูป ไม่แตะข้อมูล pixel)
  idwImageOverlay = L.imageOverlay(canvas.toDataURL(), bounds, {
    opacity: idwOpacity,
    pane: 'idwPane',
    interactive: false
  }).addTo(idwLayer);
}

// ==========================================
// 8. วาด Map Legend ใต้แผนที่
// ==========================================
function renderMapLegend() {
  const legendEl = document.getElementById('mapLegend');

  // รายเดือน/รายปี: วาด legend เป็นตารางเกณฑ์ละเอียดตามสเกลสี (แทน 4 ระดับเดิม)
  const fineScale = currentFineRainScale();
  if (fineScale) {
    const title = currentPeriod === 'rain_yearly' ? 'เกณฑ์ฝนสะสมรายปี (มม.)' : 'เกณฑ์ฝนสะสมรายเดือน (มม.)';
    legendEl.classList.add('legend-scale');
    legendEl.innerHTML =
      `<span class="legend-scale-title">${title}</span>` +
      fineScale
        .map(
          (step) => `
      <span class="legend-item">
        <span class="legend-swatch" style="background:${step.color}"></span>
        ${step.label}
      </span>`
        )
        .join('');
    return;
  }

  legendEl.classList.remove('legend-scale');

  const useAccum = isAccumPeriod();
  const colorSet = useAccum ? ACCUM_STATUS_COLOR : STATUS_COLOR;
  const labelPrefix = useAccum
    ? { normal: 'ฝนตกเล็กน้อย', watch: 'ฝนตกปานกลาง', warning: 'ฝนตกหนัก', critical: 'ฝนตกหนักมาก' }
    : { normal: 'ฝนตกเล็กน้อย', watch: 'ฝนตกปานกลาง', warning: 'ฝนตกหนัก', critical: 'ฝนตกหนักมาก' };
 
  const items = [
    { label: `${labelPrefix.normal} (<${RAIN_THRESHOLDS.watch} มม.)`, color: colorSet.normal },
    { label: `${labelPrefix.watch} (${RAIN_THRESHOLDS.watch}–${RAIN_THRESHOLDS.warning} มม.)`, color: colorSet.watch },
    { label: `${labelPrefix.warning} (${RAIN_THRESHOLDS.warning}–${RAIN_THRESHOLDS.critical} มม.)`, color: colorSet.warning },
    { label: `${labelPrefix.critical} (>${RAIN_THRESHOLDS.critical} มม.)`, color: colorSet.critical },
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
// 9. เรดาร์ฝน (RainViewer) — overlay + play/pause + timeline slider
// ==========================================
// ใช้ proxy ของโปรเจกต์ flashflood-risk-intelligence เป็นแหล่งหลัก (จัดรูปแบบ frames ให้เรียบง่ายแล้ว)
// ถ้า proxy ล่ม/rate limit ค่อย fallback ไปเรียก endpoint ทางการของ RainViewer ตรงๆ
const RAINVIEWER_PROXY_URL = 'https://flashflood-risk-intelligence.vercel.app/api/rainviewer';
const RAINVIEWER_FALLBACK_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_TILE_SIZE = 256;
const RADAR_COLOR_SCHEME = 2; // Universal Blue — โทนเดียวกับตัวอย่างที่ต้องการเลียนแบบ
const RADAR_TILE_OPTIONS = '1_1'; // smooth=1, snow=1
const RADAR_PLAY_INTERVAL_MS = 700;

let radarHost = 'https://tilecache.rainviewer.com';
let radarFrames = []; // [{ time, path }]
let radarFrameIndex = 0;
let radarPlaying = false;
let radarPlayTimer = null;
let radarLoadingPromise = null;

let radarControlEl = null;
let radarPlayBtn = null;
let radarSlider = null;
let radarTimeLabel = null;

function radarTileUrl(host, path) {
  return `${host}${path}/${RADAR_TILE_SIZE}/{z}/{x}/{y}/${RADAR_COLOR_SCHEME}/${RADAR_TILE_OPTIONS}.png`;
}

// ดึงรายการเฟรมเรดาร์ — คืน { host, frames, latestIndex }
async function fetchRadarFrames() {
  try {
    const res = await fetch(RAINVIEWER_PROXY_URL);
    if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.frames) || !json.frames.length) throw new Error('proxy ไม่มีเฟรม');
    return {
      host: json.host || radarHost,
      frames: json.frames,
      latestIndex: typeof json.latestIndex === 'number' ? json.latestIndex : json.frames.length - 1,
    };
  } catch (err) {
    log('[RainViewer] proxy ใช้ไม่ได้ ลอง fallback ไป endpoint ทางการ:', err.message);
    const res = await fetch(RAINVIEWER_FALLBACK_URL);
    if (!res.ok) throw new Error(`RainViewer HTTP ${res.status}`);
    const json = await res.json();
    const past = (json.radar && json.radar.past) || [];
    const nowcast = (json.radar && json.radar.nowcast) || [];
    const frames = [...past, ...nowcast];
    if (!frames.length) throw new Error('RainViewer ไม่มีเฟรม');
    return { host: json.host || radarHost, frames, latestIndex: past.length - 1 };
  }
}

// โหลดเฟรม (ครั้งเดียว — ถ้ามีอยู่แล้วไม่โหลดซ้ำ) ใช้ promise เดียวกันกันยิงซ้ำซ้อนตอนคลิกถี่ๆ
function ensureRadarFrames() {
  if (radarFrames.length) return Promise.resolve();
  if (radarLoadingPromise) return radarLoadingPromise;

  radarLoadingPromise = fetchRadarFrames()
    .then((data) => {
      radarHost = data.host;
      radarFrames = data.frames;
      radarFrameIndex = Math.max(0, Math.min(data.latestIndex, radarFrames.length - 1));
    })
    .catch((err) => {
      console.warn('โหลดเรดาร์ฝนไม่สำเร็จ:', err.message);
      radarFrames = [];
    })
    .finally(() => {
      radarLoadingPromise = null;
    });

  return radarLoadingPromise;
}

// สลับไปแสดงเฟรมที่ index ที่กำหนด (วนกลับต้น/ท้ายอัตโนมัติ)
function setRadarFrame(index) {
  if (!radarFrames.length) return;
  radarFrameIndex = ((index % radarFrames.length) + radarFrames.length) % radarFrames.length;
  const frame = radarFrames[radarFrameIndex];
  radarLayer.setUrl(radarTileUrl(radarHost, frame.path));
  updateRadarControlUI();
}

function scheduleRadarPlay() {
  clearRadarPlayTimer();
  if (!radarPlaying) return;
  radarPlayTimer = setTimeout(() => {
    setRadarFrame(radarFrameIndex + 1);
    scheduleRadarPlay();
  }, RADAR_PLAY_INTERVAL_MS);
}

function clearRadarPlayTimer() {
  if (radarPlayTimer) {
    clearTimeout(radarPlayTimer);
    radarPlayTimer = null;
  }
}

// เปิด layer เรดาร์ (จาก layer control) — โหลดเฟรมถ้ายังไม่มี แล้วเริ่มเล่นอัตโนมัติ
async function startRadar() {
  await ensureRadarFrames();
  if (!radarFrames.length) return;
  setRadarFrame(radarFrameIndex);
  showRadarControl();
  radarPlaying = true;
  if (radarPlayBtn) radarPlayBtn.innerHTML = '❚❚';
  scheduleRadarPlay();
}

// ปิด layer เรดาร์
function stopRadar() {
  radarPlaying = false;
  clearRadarPlayTimer();
  hideRadarControl();
}

// เรียกจาก main.js ทุกรอบ auto-refresh (5 นาที) — รีเฟรชเฉพาะตอนเปิด layer เรดาร์อยู่เท่านั้น
function refreshRadarIfActive() {
  if (!map || !radarLayer || !map.hasLayer(radarLayer)) return;
  radarFrames = []; // บังคับดึงชุดใหม่ เพื่อให้ได้เฟรมล่าสุดที่เพิ่งออก
  ensureRadarFrames().then(() => {
    if (!radarFrames.length) return;
    setRadarFrame(radarFrames.length - 1); // เลื่อนไปเฟรมล่าสุดเสมอเมื่อรีเฟรช
    showRadarControl();
  });
}

function showRadarControl() {
  if (!radarControlEl) return;
  if (radarSlider) {
    radarSlider.max = String(Math.max(0, radarFrames.length - 1));
    radarSlider.value = String(radarFrameIndex);
  }
  radarControlEl.style.display = 'flex';
}

function hideRadarControl() {
  if (radarControlEl) radarControlEl.style.display = 'none';
}

function updateRadarControlUI() {
  if (!radarControlEl || radarControlEl.style.display === 'none') return;
  if (radarSlider) radarSlider.value = String(radarFrameIndex);
  if (radarTimeLabel) {
    const frame = radarFrames[radarFrameIndex];
    radarTimeLabel.textContent = frame
      ? new Date(frame.time * 1000).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' น.'
      : '--:--';
  }
}

// สร้าง custom Leaflet control (ปุ่มเล่น/หยุด + แถบเลื่อนเวลา) ซ่อนไว้ก่อน แสดงเมื่อเปิด layer เรดาร์เท่านั้น
function createRadarControl() {
  const RadarControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
      const container = L.DomUtil.create('div', 'radar-control');
      container.style.display = 'none';

      const btn = L.DomUtil.create('button', 'radar-play-btn', container);
      btn.type = 'button';
      btn.innerHTML = '❚❚';
      btn.title = 'เล่น/หยุดเรดาร์ฝน';
      btn.setAttribute('aria-label', 'เล่น/หยุดเรดาร์ฝน');

      const slider = L.DomUtil.create('input', 'radar-slider', container);
      slider.type = 'range';
      slider.min = '0';
      slider.max = '0';
      slider.step = '1';
      slider.value = '0';
      slider.setAttribute('aria-label', 'เลื่อนช่วงเวลาเรดาร์ฝน');

      const timeLabel = L.DomUtil.create('span', 'radar-time-label', container);
      timeLabel.textContent = '--:--';

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      btn.addEventListener('click', () => {
        radarPlaying = !radarPlaying;
        btn.innerHTML = radarPlaying ? '❚❚' : '▶';
        if (radarPlaying) scheduleRadarPlay();
        else clearRadarPlayTimer();
      });

      slider.addEventListener('input', (e) => {
        radarPlaying = false;
        clearRadarPlayTimer();
        btn.innerHTML = '▶';
        setRadarFrame(parseInt(e.target.value, 10));
      });

      radarControlEl = container;
      radarPlayBtn = btn;
      radarSlider = slider;
      radarTimeLabel = timeLabel;

      return container;
    },
  });

  map.addControl(new RadarControl());
}

// ==========================================
// 8.1 แถบเลื่อนความโปร่งใส (opacity) ของ layer IDW — โผล่เฉพาะตอนเปิด layer IDW เท่านั้น
// ==========================================
let idwOpacityControlEl = null;
let idwOpacitySlider = null;

function showIdwOpacityControl() {
  if (!idwOpacityControlEl) return;
  if (idwOpacitySlider) idwOpacitySlider.value = String(idwOpacity);
  idwOpacityControlEl.style.display = 'flex';
}

function hideIdwOpacityControl() {
  if (idwOpacityControlEl) idwOpacityControlEl.style.display = 'none';
}

// สร้าง custom Leaflet control (แถบเลื่อน 0–100%) ซ่อนไว้ก่อน แสดงเมื่อเปิด layer IDW เท่านั้น
function createIdwOpacityControl() {
  const IdwOpacityControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
      const container = L.DomUtil.create('div', 'radar-control idw-opacity-control');
      container.style.display = 'none';

      const label = L.DomUtil.create('span', 'idw-opacity-label', container);
      label.textContent = 'IDW';
      label.title = 'ความโปร่งใสชั้นข้อมูล IDW';

      const slider = L.DomUtil.create('input', 'radar-slider', container);
      slider.type = 'range';
      slider.min = '0';
      slider.max = '1';
      slider.step = '0.05';
      slider.value = String(idwOpacity);
      slider.setAttribute('aria-label', 'ปรับความโปร่งใสชั้นข้อมูล IDW');

      const valueLabel = L.DomUtil.create('span', 'radar-time-label', container);
      valueLabel.textContent = `${Math.round(idwOpacity * 100)}%`;

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      slider.addEventListener('input', (e) => {
        idwOpacity = parseFloat(e.target.value);
        valueLabel.textContent = `${Math.round(idwOpacity * 100)}%`;
        if (idwImageOverlay) idwImageOverlay.setOpacity(idwOpacity); // ปรับสดทันที ไม่ต้องคำนวณ raster ใหม่
      });

      idwOpacityControlEl = container;
      idwOpacitySlider = slider;

      return container;
    },
  });

  map.addControl(new IdwOpacityControl());
}

// ==========================================
// 10. ย้าย Map Legend เข้าไปแสดงในแผนที่ตอนโหมดเต็มจอ (มุมซ้ายล่าง มุมเดียวกับปุ่ม play เรดาร์) — ยุบ/แสดงได้
// ==========================================
// สลับ #mapLegend (element ตัวเดิม ไม่ clone) ระหว่างตำแหน่งปกติใต้แผนที่ กับมุมซ้ายล่างของแผนที่
// เข้า/ออกโหมดเต็มจอ — ใช้ element เดิมเพื่อให้ renderMapLegend() อัปเดตเนื้อหาได้ปกติไม่ว่าจะอยู่ที่ไหน
// ห่อด้วยปุ่มยุบ/แสดง (เหมือนที่ทำกับตัวกรอง) เพราะ renderMapLegend() เขียนทับ #mapLegend.innerHTML ทุกครั้ง
// ถ้าใส่ปุ่มไว้ข้างในตัว element เดียวกันจะโดนล้างทิ้งไปด้วย จึงต้องมีกล่องห่อแยกต่างหากถาวร
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
    legendToggleBtn.innerHTML = collapsed ? '▾ คำอธิบายสัญลักษณ์' : '▴ คำอธิบายสัญลักษณ์';
    legendToggleBtn.title = collapsed ? 'แสดงคำอธิบายสัญลักษณ์' : 'ยุบคำอธิบายสัญลักษณ์';
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
      btn.innerHTML = '▴ คำอธิบายสัญลักษณ์';
      btn.title = 'ยุบคำอธิบายสัญลักษณ์';
      btn.setAttribute('aria-label', 'ยุบ/แสดงคำอธิบายสัญลักษณ์');

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
// 11. ย้ายแถบตัวกรอง (ช่วงเวลา/อำเภอ/ตำบล/หน่วยงาน) เข้าไปแสดงในแผนที่ตอนโหมดเต็มจอ — ยุบ/แสดงได้
// ==========================================
// สลับ #periodRow (element ตัวเดิม ไม่ clone) เข้า/ออกมุมขวาบนของแผนที่ เหมือนวิธีที่ทำกับ legend
// เพราะ select ทั้ง 4 ตัวผูก event listener ไว้กับ id เดิมอยู่แล้ว (bindPeriodSelect/bindDistrictFilter/...)
// ย้าย element ตัวจริงจึงไม่ต้อง bind ใหม่ ทำงานเหมือนเดิมทุกอย่างไม่ว่าจะอยู่ที่ไหนใน DOM
let filterRowOriginalParent = null;
let filterRowOriginalNextSibling = null;
let searchOriginalParent = null;
let searchOriginalNextSibling = null;
let statusOriginalParent = null;
let statusOriginalNextSibling = null;
let filterControlEl = null;
let filterPanelEl = null;
let filterToggleBtn = null;
let filterSearchFieldEl = null;
let filterStatusFieldEl = null;
let filtersCollapsed = false;

function setFiltersCollapsed(collapsed) {
  filtersCollapsed = collapsed;
  if (filterPanelEl) filterPanelEl.style.display = collapsed ? 'none' : 'block';
  if (filterToggleBtn) {
    filterToggleBtn.innerHTML = collapsed ? '▾ ตัวกรอง' : '▴ ตัวกรอง';
    filterToggleBtn.title = collapsed ? 'แสดงตัวกรอง' : 'ยุบตัวกรอง';
  }
}

function toggleFiltersInFullscreen(isFullscreen) {
  const rowEl = document.getElementById('periodRow');
  const searchEl = document.getElementById('tableSearch');
  const statusEl = document.getElementById('statusFilter');
  if (!rowEl || !filterControlEl || !filterPanelEl) return;

  if (isFullscreen) {
    // ค้นหา + สถานะ ย้ายมาก่อน (บนสุดของกล่อง) ตามด้วยช่วงเวลา/อำเภอ/ตำบล/หน่วยงานเดิม
    if (searchEl && filterSearchFieldEl) {
      searchOriginalParent = searchEl.parentElement;
      searchOriginalNextSibling = searchEl.nextSibling;
      filterSearchFieldEl.appendChild(searchEl);
    }
    if (statusEl && filterStatusFieldEl) {
      statusOriginalParent = statusEl.parentElement;
      statusOriginalNextSibling = statusEl.nextSibling;
      filterStatusFieldEl.appendChild(statusEl);
    }

    filterRowOriginalParent = rowEl.parentElement;
    filterRowOriginalNextSibling = rowEl.nextSibling;
    filterPanelEl.appendChild(rowEl);

    filterControlEl.style.display = 'block';
    setFiltersCollapsed(true); // ยุบไว้เป็นค่าเริ่มต้นทุกครั้งที่เข้าเต็มจอ ให้ผู้ใช้กดแสดงเอง
  } else {
    filterControlEl.style.display = 'none';
    if (filterRowOriginalParent) {
      filterRowOriginalParent.insertBefore(rowEl, filterRowOriginalNextSibling);
    }
    // คืนสถานะก่อนค้นหา (reverse order) เพราะ searchOriginalNextSibling อ้างถึง statusEl
    // ต้องคืน statusEl กลับที่เดิมก่อน insertBefore(searchEl, statusEl) ถึงจะหา sibling เจอ
    if (statusEl && statusOriginalParent) {
      statusOriginalParent.insertBefore(statusEl, statusOriginalNextSibling);
    }
    if (searchEl && searchOriginalParent) {
      searchOriginalParent.insertBefore(searchEl, searchOriginalNextSibling);
    }
  }
}

// สร้าง custom Leaflet control (ปุ่มยุบ/แสดง + กล่องใส่ #periodRow) ซ่อนไว้ก่อน แสดงเมื่อเข้าเต็มจอเท่านั้น
function createFilterControl() {
  const FilterControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      const container = L.DomUtil.create('div', 'filter-toggle-control leaflet-control');
      container.style.display = 'none';

      const btn = L.DomUtil.create('button', 'filter-toggle-btn', container);
      btn.type = 'button';
      btn.innerHTML = '▴ ตัวกรอง';
      btn.title = 'ยุบตัวกรอง';
      btn.setAttribute('aria-label', 'ยุบ/แสดงตัวกรอง');

      const panel = L.DomUtil.create('div', 'filter-panel', container);

      // ช่องรอรับ #tableSearch / #statusFilter (ตัวจริงจากตารางข้างล่าง) ตอนเข้าเต็มจอ
      const searchField = L.DomUtil.create('div', 'period-field', panel);
      L.DomUtil.create('label', '', searchField).textContent = 'ค้นหา';

      const statusField = L.DomUtil.create('div', 'period-field', panel);
      L.DomUtil.create('label', '', statusField).textContent = 'สถานะ';

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      btn.addEventListener('click', () => setFiltersCollapsed(!filtersCollapsed));

      filterControlEl = container;
      filterPanelEl = panel;
      filterToggleBtn = btn;
      filterSearchFieldEl = searchField;
      filterStatusFieldEl = statusField;

      return container;
    },
  });

  map.addControl(new FilterControl());
}

// ==========================================
// 12. ย้ายตารางข้อมูล เข้าไปแสดงในแผนที่ตอนโหมดเต็มจอ (มุมขวาล่าง) — ยุบ/แสดงได้
// ==========================================
// สลับ .table-wrap (element ตัวเดิม ไม่ clone) เข้า/ออกมุมขวาล่างของแผนที่ เหมือนวิธีที่ทำกับ legend/ตัวกรอง
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
    tableToggleBtn.innerHTML = collapsed ? '▾ ตารางข้อมูล' : '▴ ตารางข้อมูล';
    tableToggleBtn.title = collapsed ? 'แสดงตารางข้อมูล' : 'ยุบตารางข้อมูล';
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
      btn.innerHTML = '▴ ตารางข้อมูล';
      btn.title = 'ยุบตารางข้อมูล';
      btn.setAttribute('aria-label', 'ยุบ/แสดงตารางข้อมูล');

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