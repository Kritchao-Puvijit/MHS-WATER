/* ==========================================================
   main.js — MHS Rain Watch (โหมด monitoring ล้วนๆ)
   หน้าที่: ดึงข้อมูลจาก Rainfall API (สสน. — Thaiwater), อัปเดต status bar / map / table
   ========================================================== */

console.log = function () { };

// ฐาน API ของสสน. (Thaiwater v3) — เปลี่ยนจาก disaster.mhs-pao.go.th มาใช้แหล่งนี้แทน
// เพราะบางสถานีของ API เดิมข้อมูลไม่อัพเดท
const THAIWATER_BASE = 'https://api-v3.thaiwater.net/api/v1/thaiwater30';

// ชุดข้อมูลย่อยแต่ละช่วงเวลา — endpoint และชื่อ field ค่าน้ำฝนอาจไม่เหมือนกันในแต่ละ endpoint
// (เดาจากรูปแบบทั่วไปของ API สสน. ยังไม่ยืนยัน 100% — เช็ค console log แล้วแก้ valueKeys ให้ตรงได้)
const PERIOD_CONFIG = {
  rain_24h: { path: '/public/rain_24h', valueKeys: ['rain_24h', 'rainfall_value', 'value'], label: '24 ชั่วโมงล่าสุด' },
  rain_today: { path: '/public/rain_today', valueKeys: ['rain_today', 'rainfall_value', 'value'], label: 'ฝนวันนี้' },
  rain_yesterday: { path: '/public/rain_yesterday', valueKeys: ['rain_yesterday', 'rainfall_value', 'value'], label: 'ฝนวานนี้' },
  rain3d: { path: '/provinces/rain3d', valueKeys: ['rain_3d', 'rain3d', 'rainfall_value', 'value'], label: '3 วันย้อนหลัง' },
  rain5d: { path: '/provinces/rain5d', valueKeys: ['rain_5d', 'rain5d', 'rainfall_value', 'value'], label: '5 วันย้อนหลัง' },
  rain7d: { path: '/provinces/rain7d', valueKeys: ['rain_7d', 'rain7d', 'rainfall_value', 'value'], label: '7 วันย้อนหลัง' },
  rain15d: { path: '/provinces/rain15d', valueKeys: ['rain_15d', 'rain15d', 'rainfall_value', 'value'], label: '15 วันย้อนหลัง' },
  rain_monthly: { path: '/public/rain_monthly', valueKeys: ['rainfall_value', 'rain_month', 'rain_monthly', 'value'], label: 'รายเดือน' },
  rain_yearly: { path: '/public/rain_yearly', valueKeys: ['rainfall_value', 'rain_year', 'rain_yearly', 'value'], label: 'รายปี' },
};

let allStations = [];
let currentStatusFilter = '';
let currentSearchQuery = '';
let currentDistrictFilter = '';
let currentTambonFilter = '';
let currentAgencyFilter = '';
let currentPeriod = 'rain_24h';
let currentSortKey = 'recordedAt'; // 'recordedAt' (ค่าเริ่มต้น: เวลาล่าสุดก่อน) | 'rainfall' (คลิกหัวตาราง)
let currentSortDirection = 'desc';

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  renderMapLegend();
  startLiveClock();
  bindStatusFilter();
  bindTableSearch();
  bindDistrictFilter();
  bindTambonFilter();
  bindAgencyFilter();
  bindPeriodSelect();
  bindHeaderNav();
  bindTableRowClick();
  bindRainfallSort();
  bindRainExtremesClick();

  loadAll();
  setInterval(loadAll, 5 * 60 * 1000); // อัปเดตทุก 5 นาที (monitoring ควรถี่กว่า dashboard วิเคราะห์)
});

/* ---------------- Header nav dropdown (น้ำฝน/ระดับน้ำ) ---------------- */
function bindHeaderNav() {
  const btn = document.getElementById('navDropdownBtn');
  const menu = document.getElementById('navDropdownMenu');
  if (!btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  document.addEventListener('click', () => menu.classList.remove('open'));
}

/* ---------------- Live clock ---------------- */
function startLiveClock() {
  const el = document.getElementById('liveClock');
  const tick = () => {
    el.textContent = new Date().toLocaleTimeString('th-TH', { hour12: false });
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------------- Live Date ---------- */
function startLiveDate() {
  const el = document.getElementById('liveDate');
  const tick = () => {
    el.textContent = new Date().toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };
  tick();
  setInterval(tick, 60 * 1000); // อัปเดตทุก 1 นาที
}

startLiveDate();

/* ---------------- API helpers ---------------- */
function pick(obj, keys, fallback = null) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return fallback;
}

// ดึงค่าที่อาจเป็น { th: '...', en: '...' } (รูปแบบที่ API สสน. ใช้บ่อย) หรือ string ตรงๆ
function pickLocalized(obj, keys, fallback = '-') {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') {
      if (typeof v === 'object') return v.th || v.en || fallback;
      return v;
    }
  }
  return fallback;
}

async function fetchApi(url) {
  const res = await fetch(url);
  if (res.status === 429) throw new Error('เรียก API ถี่เกินไป (Rate Limit) กรุณารอสักครู่');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function extractRecords(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.result)) return json.result;
  return [];
}

// เช็คว่า record เป็นของแม่ฮ่องสอนไหม — ใช้วิธี stringify ทั้ง object แล้วหาคำว่า "แม่ฮ่องสอน"/"Mae Hong Son"
// เพราะยังไม่ยืนยัน field path ที่แน่นอนของ province ใน response (โครงสร้าง geocode อาจซ้อนหลายชั้น)
// วิธีนี้ทนทานกว่าเดา field name ตรงๆ แต่ถ้ามั่นใจ field แล้วเปลี่ยนมาเช็คตรงๆ จะเร็วกว่า
function isMaeHongSonRecord(raw) {
  const text = JSON.stringify(raw);
  return text.includes('แม่ฮ่องสอน') || text.includes('Mae Hong Son');
}

// แปลง record จาก Thaiwater API ให้เป็นรูปแบบมาตรฐานที่ map.js/main.js ใช้ (เหมือนของเดิมทุกจุด)
function normalizeThaiwaterStation(raw, valueKeys) {
  const geocode = raw.geocode || {};
  const station = raw.station || {};
  const nameFromStation = pickLocalized(station, ['tele_station_name', 'station_name', 'name']);
  const nameFromRaw = pickLocalized(raw, ['station_name', 'name']);
  return {
    // ต้องเป็น station.id (รหัสสถานีจริง คงที่) ไม่ใช่ raw.id (รหัสรายการอ่านค่าแต่ละครั้ง เปลี่ยนทุกรอบข้อมูล)
    // เพราะ endpoint กราฟย้อนหลัง (rain_24h_graph/rain_monthly_graph) ต้องการ station_id ตัวจริงเท่านั้น
    // ใส่ raw.id ผิดจะได้ผลลัพธ์ "OK" กลับมาแต่ค่าเป็น null ล้วนๆ (ดูเหมือนใช้ได้แต่กราฟว่างเปล่า)
    id: pick(station, ['id']) ?? pick(raw, ['id', 'station_id'], JSON.stringify(raw).length),
    name: nameFromStation !== '-' ? nameFromStation
      : nameFromRaw !== '-' ? nameFromRaw
        : pickLocalized(geocode, ['tumbon_name', 'tambon_name'], 'ไม่ทราบชื่อ'),
    subDistrict: pickLocalized(geocode, ['tumbon_name', 'tambon_name', 'sub_district'], '-'),
    district: pickLocalized(geocode, ['amphoe_name', 'district_name', 'district'], '-'),
    lat: parseFloat(
      pick(station, ['tele_station_lat', 'lat', 'latitude']) ??
      pick(raw, ['lat', 'latitude']) ??
      pick(geocode, ['lat', 'latitude'])
    ),
    lng: parseFloat(
      pick(station, ['tele_station_long', 'tele_station_lng', 'long', 'lng', 'longitude']) ??
      pick(raw, ['long', 'lng', 'longitude']) ??
      pick(geocode, ['long', 'lng', 'longitude'])
    ),
    rainfall: parseFloat(pick(raw, valueKeys, 0)),
    recordedAt: pick(raw, ['rainfall_datetime', 'datetime', 'measure_time'], '-'),
    agency: pickLocalized(raw.agency || {}, ['agency_name'], '-'),
  };
}

/* ---------------- Load ---------------- */
async function loadAll() {
  try {
    await loadStationsFromThaiwater(currentPeriod);
    render();
    renderIdwLayer(allStations); // js/map.js — คำนวณเฉพาะตอนข้อมูลเปลี่ยนจริง (ทุก 5 นาที) เท่านั้น
    refreshRadarIfActive(); // js/map.js — รีเฟรชเฟรมเรดาร์ฝนเฉพาะตอนเปิด layer อยู่เท่านั้น
  } catch (err) {
    console.error('โหลดข้อมูลไม่สำเร็จ:', err);
    document.getElementById('reportTableBody').innerHTML =
      `<tr><td colspan="6" class="text-center" style="color:#F87171;">${err.message}</td></tr>`;
  }
}

async function loadStationsFromThaiwater(period) {
  const config = PERIOD_CONFIG[period];
  const json = await fetchApi(`${THAIWATER_BASE}${config.path}`);

  // Response ของ Thaiwater มักห่อด้วย { data: [...] } หรือคืน array ตรงๆ
  const rawList = extractRecords(json);

  log(`[Thaiwater ${period}] raw response (${rawList.length} รายการทั้งประเทศ):`, json);
  if (rawList.length) {
    // log ตัวอย่าง record แรกแบบเห็นชัดๆ ไว้ตรวจ field name — ลบทิ้งได้เมื่อ field mapping นิ่งแล้ว
    console.log(`%c[Thaiwater ${period}] ตัวอย่าง record แรก (ใช้เช็ค field name):`, 'color:#38BDF8;font-weight:bold', rawList[0]);
  }

  const mhsOnly = rawList.filter(isMaeHongSonRecord);
  log(`[Thaiwater ${period}] กรองเฉพาะแม่ฮ่องสอนได้: ${mhsOnly.length} สถานี`);

  allStations = mhsOnly
    .map((raw) => normalizeThaiwaterStation(raw, PERIOD_CONFIG[period].valueKeys))
    .filter((s) => !isNaN(s.lat) && !isNaN(s.lng));

  log(`[Thaiwater ${period}] มีพิกัดใช้ปักหมุดได้จริง: ${allStations.length} สถานี`);

  populateDistrictOptions(allStations);
  populateTambonOptions(allStations);
  populateAgencyOptions(allStations);
}

function populateDistrictOptions(stations) {
  const select = document.getElementById('districtSelect');
  if (!select) return;
  const current = select.value;
  const districts = [...new Set(stations.map((s) => s.district).filter((d) => d && d !== '-'))].sort();

  select.innerHTML = '<option value="">ทุกอำเภอ</option>' +
    districts.map((d) => `<option value="${d}">${d}</option>`).join('');
  if (districts.includes(current)) select.value = current;
}

// ตำบล: จำกัดตัวเลือกตามอำเภอที่เลือกไว้อยู่ (ถ้ามี) — เลือกอำเภอก่อนแล้วค่อยเลือกตำบลจะตรงกันเสมอ
function populateTambonOptions(stations) {
  const select = document.getElementById('tambonSelect');
  if (!select) return;
  const current = select.value;
  const scoped = currentDistrictFilter
    ? stations.filter((s) => s.district === currentDistrictFilter)
    : stations;
  const tambons = [...new Set(scoped.map((s) => s.subDistrict).filter((t) => t && t !== '-'))].sort();

  select.innerHTML = '<option value="">ทุกตำบล</option>' +
    tambons.map((t) => `<option value="${t}">${t}</option>`).join('');
  if (tambons.includes(current)) select.value = current;
  else currentTambonFilter = '';
}

function populateAgencyOptions(stations) {
  const select = document.getElementById('agencySelect');
  if (!select) return;
  const current = select.value;
  const agencies = [...new Set(stations.map((s) => s.agency).filter((a) => a && a !== '-'))].sort();

  select.innerHTML = '<option value="">ทุกหน่วยงาน</option>' +
    agencies.map((a) => `<option value="${a}">${a}</option>`).join('');
  if (agencies.includes(current)) select.value = current;
}

/* ---------------- Filter ---------------- */
function getFilteredStations() {
  let stations = [...allStations];

  if (currentStatusFilter) {
    stations = stations.filter((s) => classifyRainStatus(s.rainfall) === currentStatusFilter);
  }

  if (currentDistrictFilter) {
    stations = stations.filter((s) => s.district === currentDistrictFilter);
  }

  if (currentTambonFilter) {
    stations = stations.filter((s) => s.subDistrict === currentTambonFilter);
  }

  if (currentAgencyFilter) {
    stations = stations.filter((s) => s.agency === currentAgencyFilter);
  }

  if (currentSearchQuery && currentSearchQuery.trim() !== '') {
    const query = currentSearchQuery.trim().toLowerCase();
    stations = stations.filter((s) => {
      const nameMatch = s.name ? s.name.toLowerCase().includes(query) : false;
      const subDistrictMatch = s.subDistrict ? s.subDistrict.toLowerCase().includes(query) : false;
      const districtMatch = s.district ? s.district.toLowerCase().includes(query) : false;
      return nameMatch || subDistrictMatch || districtMatch;
    });
  }

  return stations;
}

/* ---------------- Render ---------------- */
function render() {
  const filteredStations = getFilteredStations();
  renderStationMarkers(filteredStations); // js/map.js
  // หมายเหตุ: renderIdwLayer() ไม่เรียกจากตรงนี้แล้ว — ย้ายไปเรียกเฉพาะใน loadAll()
  // เพราะ IDW ใช้ allStations (ข้อมูลฝนทั้งหมด) เสมอ ไม่ได้ขึ้นกับ search/filter เลย
  // เรียกซ้ำทุกครั้งที่พิมพ์ค้นหา/เปลี่ยน dropdown จะคำนวณ raster หนักๆ ทิ้งเปล่าๆ ทำให้หน่วง
  renderStatusBar();
  renderTable(filteredStations);
  renderRainExtremes(filteredStations);
}

// การ์ด "ฝนน้อยสุด/มากสุด" เหนือแผนที่ — ใช้ชุดสถานีเดียวกับที่กรองอยู่ตอนนั้น (ตามอำเภอ/ตำบล/หน่วยงาน/ค้นหา)
// เพื่อให้สอดคล้องกับจุดที่เห็นบนแผนที่ ณ ขณะนั้น ไม่ใช่ค่าทั้งจังหวัดเสมอไป
function renderRainExtremes(filteredStations) {
  const minCard = document.getElementById('rainExtremeMin');
  const maxCard = document.getElementById('rainExtremeMax');
  if (!minCard || !maxCard) return;

  const valid = filteredStations.filter((s) => s.rainfall !== null && !isNaN(s.rainfall));

  const fillCard = (card, station) => {
    const valueEl = card.querySelector('.rain-extreme-value');
    const stationEl = card.querySelector('.rain-extreme-station');
    if (!station) {
      valueEl.innerHTML = '- <span class="muted">มม.</span>';
      stationEl.textContent = 'ไม่พบข้อมูล';
      card.disabled = true;
      delete card.dataset.id;
      return;
    }
    valueEl.innerHTML = `${station.rainfall.toFixed(1)} <span class="muted">มม.</span>`;
    stationEl.textContent = `${station.name} • ${station.district}`;
    card.disabled = false;
    card.dataset.id = station.id;
  };

  if (!valid.length) {
    fillCard(minCard, null);
    fillCard(maxCard, null);
    return;
  }

  let minStation = valid[0];
  let maxStation = valid[0];
  valid.forEach((s) => {
    if (s.rainfall < minStation.rainfall) minStation = s;
    if (s.rainfall > maxStation.rainfall) maxStation = s;
  });

  fillCard(minCard, minStation);
  fillCard(maxCard, maxStation);
}

function bindRainExtremesClick() {
  const container = document.getElementById('rainExtremes');
  if (!container) return;
  container.addEventListener('click', (e) => {
    const card = e.target.closest('.rain-extreme-card');
    if (!card || !card.dataset.id) return;
    focusStationOnMap(card.dataset.id); // js/map.js
  });
}

function renderStatusBar() {
  const counts = { normal: 0, watch: 0, warning: 0, critical: 0 };
  allStations.forEach((s) => {
    const status = classifyRainStatus(s.rainfall); // js/map.js
    if (status) counts[status]++;
  });

  document.getElementById('countTotal').textContent = allStations.length;
  document.getElementById('countNormal').textContent = counts.normal;
  document.getElementById('countWatch').textContent = counts.watch;
  document.getElementById('countWarning').textContent = counts.warning;
  document.getElementById('countCritical').textContent = counts.critical;
}

function renderTable() {
  const tbody = document.getElementById('reportTableBody');
  let rows = getFilteredStations().filter((s) => s.rainfall !== null && !isNaN(s.rainfall));

  if (currentSortKey === 'rainfall') {
    rows.sort((a, b) => (currentSortDirection === 'desc' ? b.rainfall - a.rainfall : a.rainfall - b.rainfall));
  } else {
    rows.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1)); // ค่าเริ่มต้น: เวลาล่าสุดก่อน
  }

  const countEl = document.getElementById('recordCountValue');
  if (countEl) countEl.textContent = rows.length.toLocaleString('th-TH');

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center muted">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  const unit = currentPeriod === 'rain_yearly' ? 'มม./ปี' : currentPeriod === 'rain_monthly' ? 'มม./เดือน' : 'มม.';

  // รายเดือน/รายปี: คอลัมน์สถานะแสดงช่วงเกณฑ์ + สีตามสเกลละเอียด (js/map.js)
  const fineScale = currentFineRainScale();

  tbody.innerHTML = rows
    .map((s) => {
      const status = classifyRainStatus(s.rainfall);
      const band = classifyFineRain(s.rainfall, fineScale);
      const statusCell = band
        ? `<span class="status-badge" style="background:${band.color};color:${contrastTextColor(band.color)};">${band.label}</span>`
        : `<span class="status-badge ${status}">${STATUS_LABEL[status]}</span>`;
      return `
      <tr data-id="${s.id}" tabindex="0">
        <td>${s.name}</td>
        <td>${s.subDistrict}</td>
        <td>${s.district}</td>
        <td class="text-right">${s.rainfall.toFixed(1)} <span class="muted">${unit}</span></td>
        <td>${statusCell}</td>
        <td class="muted">${s.recordedAt}</td>
        <td class="text-center">
          <button type="button" class="chart-open-btn" data-id="${s.id}" data-name="${s.name}" title="ดูกราฟย้อนหลัง" aria-label="ดูกราฟย้อนหลัง">📈</button>
        </td>
      </tr>`;
    })
    .join('');
}

// ดึงข้อมูลฝนย้อนหลังของสถานีหนึ่งๆ สำหรับ modal กราฟ (js/station-chart.js) — แยกตามประเภทข้อมูลที่เลือกใน dropdown
// periodType: 'rain_24h' | 'rain_today' | 'rain_yesterday' | 'rain3d' | 'rain5d' | 'rain7d' | 'rain15d' | 'rain_monthly' | 'rain_yearly'
// rain3d/rain5d/rain7d/rain15d ใช้ startDate/endDate ที่ผู้ใช้เลือกเองจากช่อง "วันที่เริ่มต้น/สิ้นสุด" ใน modal (ไม่ผูกกับ N วันตายตัว)
async function fetchStationRainChart(stationId, periodType, month, year, startDate, endDate) {
  if (periodType === 'rain_24h') return fetchStationRainHourly(stationId, null, 'ปริมาณฝนรายชั่วโมง (24 ชม.)', 'ปริมาณฝนสะสม');
  if (periodType === 'rain_today') return fetchStationRainToday(stationId);
  if (periodType === 'rain_yesterday') return fetchStationRainYesterdayHourly(stationId);
  if (periodType === 'rain3d' || periodType === 'rain5d' || periodType === 'rain7d' || periodType === 'rain15d') {
    return fetchStationRainDateRange(stationId, startDate, endDate);
  }
  if (periodType === 'rain_yearly') return fetchStationRainYearly(stationId, year);
  return fetchStationRainMonthly(stationId, month, year);
}

// รวมค่าสะสมไล่ตามลำดับ (ใช้ทำเส้น "ปริมาณฝนสะสม" ทับแท่ง "ปริมาณฝนรายวัน/รายชั่วโมง")
function buildCumulative(values) {
  let running = 0;
  return values.map((v) => {
    running += v;
    return running;
  });
}

// รายเดือน (รายวันตลอดทั้งเดือน) — /public/rain_monthly_graph
async function fetchStationRainMonthly(stationId, month, year) {
  const url = `${THAIWATER_BASE}/public/rain_monthly_graph?station_id=${stationId}&month=${month}&year=${year}`;
  const json = await fetchApi(url);
  if (json.result !== 'OK' || !Array.isArray(json.data) || !json.data.length) return null;

  const labels = json.data.map((d) => {
    const datePart = (d.rainfall_datetime || '').split(' ')[0];
    const parts = datePart.split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : datePart;
  });
  const dailyValues = json.data.map((d) => (typeof d.rainfall_value === 'number' ? d.rainfall_value : 0));

  return {
    unitLabel: 'ปริมาณฝน (มม.)',
    labels,
    datasets: [
      { type: 'bar', label: 'ปริมาณฝนรายวัน', data: dailyValues },
      { type: 'line', label: 'ปริมาณฝนสะสม', data: buildCumulative(dailyValues) },
    ],
  };
}

// รายชั่วโมง (24 ชม. ล่าสุด หรือย้อนไปวันใดวันหนึ่งถ้าใส่ dateParam) — /public/rain_24h_graph
async function fetchStationRainHourly(stationId, dateParam, barLabel, lineLabel) {
  const dateQuery = dateParam ? `&date=${dateParam}` : '';
  const url = `${THAIWATER_BASE}/public/rain_24h_graph?station_id=${stationId}${dateQuery}`;
  const json = await fetchApi(url);
  if (json.result !== 'OK' || !Array.isArray(json.data) || !json.data.length) return null;

  const labels = json.data.map((d) => (d.rainfall_datetime || '').split(' ')[1]?.slice(0, 5) || '');
  const values = json.data.map((d) => (typeof d.rainfall_value === 'number' ? d.rainfall_value : 0));

  return {
    unitLabel: 'ปริมาณฝน (มม.)',
    labels,
    datasets: [
      { type: 'bar', label: barLabel, data: values },
      { type: 'line', label: lineLabel, data: buildCumulative(values) },
    ],
  };
}

// เมื่อวาน = ฝนรายชั่วโมงของ "เมื่อวาน" ตัวเดียว (ใช้ rain_24h_graph ใส่ date ย้อนไป 1 วัน)
async function fetchStationRainYesterdayHourly(stationId) {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const dateStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  return fetchStationRainHourly(stationId, dateStr, 'ปริมาณฝนรายชั่วโมง (เมื่อวาน)', 'ปริมาณฝนสะสม');
}

// วันนี้ (รายชั่วโมง ตั้งแต่ 00:00 ถึงตอนนี้) — /public/rain_today_graph
// หมายเหตุ: field name ต่างจาก endpoint อื่น (date_time/rainfall แทน rainfall_datetime/rainfall_value)
// และบางครั้งมี record ซ้ำเวลาเดียวกัน จึงต้อง dedupe ก่อน
async function fetchStationRainToday(stationId) {
  const url = `${THAIWATER_BASE}/public/rain_today_graph?station_id=${stationId}`;
  const json = await fetchApi(url);
  if (json.result !== 'OK' || !Array.isArray(json.data) || !json.data.length) return null;

  const seen = new Set();
  const rows = json.data.filter((d) => {
    if (seen.has(d.date_time)) return false;
    seen.add(d.date_time);
    return true;
  });

  const labels = rows.map((d) => (d.date_time || '').split(' ')[1]?.slice(0, 5) || '');
  const values = rows.map((d) => (typeof d.rainfall === 'number' ? d.rainfall : 0));

  return {
    unitLabel: 'ปริมาณฝน (มม.)',
    labels,
    datasets: [
      { type: 'bar', label: 'ปริมาณฝนรายชั่วโมง (วันนี้)', data: values },
      { type: 'line', label: 'ปริมาณฝนสะสมวันนี้', data: buildCumulative(values) },
    ],
  };
}

// ช่วงวันที่กำหนดเอง (ใช้กับ 3/5/7/15 วันทั้งหมด — ผู้ใช้เลือกวันที่เริ่มต้น/สิ้นสุดเองจาก modal ได้อิสระ ไม่ผูกกับ N วันตายตัว)
// Thaiwater ไม่มี endpoint กราฟสำเร็จรูปสำหรับช่วงวันที่กำหนดเอง (ลองเดาชื่อ endpoint แล้วได้ 404 ทุกแบบ)
// จึงประกอบเองจาก rain_monthly_graph รายเดือน โดยดึงทุกเดือนปฏิทินที่ช่วงวันที่คาบเกี่ยว (อาจมากกว่า 1 เดือน)
// แล้วกรองเอาเฉพาะแถวที่อยู่ในช่วง [startDateStr, endDateStr] ที่ผู้ใช้เลือกจริงๆ
async function fetchStationRainDateRange(stationId, startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return null;
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);
  if (isNaN(startDate) || isNaN(endDate) || startDate > endDate) return null;

  const monthsNeeded = new Map(); // key "YYYY-M" -> { year, month }
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  while (cursor <= endDate) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth() + 1}`;
    monthsNeeded.set(key, { year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const allRows = [];
  for (const { year, month } of monthsNeeded.values()) {
    const url = `${THAIWATER_BASE}/public/rain_monthly_graph?station_id=${stationId}&month=${month}&year=${year}`;
    const json = await fetchApi(url);
    if (json.result === 'OK' && Array.isArray(json.data)) allRows.push(...json.data);
  }
  if (!allRows.length) return null;

  const filtered = allRows.filter((d) => {
    const datePart = (d.rainfall_datetime || '').split(' ')[0];
    return datePart && datePart >= startDateStr && datePart <= endDateStr;
  });
  if (!filtered.length) return null;

  filtered.sort((a, b) => ((a.rainfall_datetime || '') < (b.rainfall_datetime || '') ? -1 : 1));

  const labels = filtered.map((d) => {
    const parts = (d.rainfall_datetime || '').split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d.rainfall_datetime;
  });
  const values = filtered.map((d) => (typeof d.rainfall_value === 'number' ? d.rainfall_value : 0));

  return {
    unitLabel: 'ปริมาณฝน (มม.)',
    labels,
    datasets: [
      { type: 'bar', label: 'ปริมาณฝนรายวัน', data: values },
      { type: 'line', label: 'ปริมาณฝนสะสม', data: buildCumulative(values) },
    ],
  };
}

// รายปี (รวมรายเดือนตลอดปี) — /public/rain_yearly_graph
// หมายเหตุ: field name ต่างจาก endpoint อื่น (date_time/rainfall เหมือน rain_today_graph)
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
async function fetchStationRainYearly(stationId, year) {
  const url = `${THAIWATER_BASE}/public/rain_yearly_graph?station_id=${stationId}&year=${year}`;
  const json = await fetchApi(url);
  if (json.result !== 'OK' || !Array.isArray(json.data) || !json.data.length) return null;

  const labels = json.data.map((d) => {
    const datePart = (d.date_time || '').split(' ')[0];
    const parts = datePart.split('-');
    return parts.length === 3 ? THAI_MONTHS_SHORT[parseInt(parts[1], 10) - 1] : datePart;
  });
  const values = json.data.map((d) => (typeof d.rainfall === 'number' ? d.rainfall : 0));

  return {
    unitLabel: 'ปริมาณฝน (มม.)',
    labels,
    datasets: [
      { type: 'bar', label: 'ปริมาณฝนรายเดือน', data: values },
      { type: 'line', label: 'ปริมาณฝนสะสมรายปี', data: buildCumulative(values) },
    ],
  };
}

// คลิก (หรือกด Enter บนแถวที่โฟกัสด้วยคีย์บอร์ด) แถวไหนในตาราง ให้เลื่อนแผนที่ไปเปิด popup สถานีนั้น (js/map.js)
// คลิกปุ่ม 📈 ในคอลัมน์กราฟ ให้เปิด modal กราฟย้อนหลังแทน (js/station-chart.js) — ไม่เปิดพร้อมกันทั้งคู่
function bindTableRowClick() {
  const tbody = document.getElementById('reportTableBody');
  if (!tbody) return;

  const activateRow = (row) => {
    if (!row || !row.dataset.id) return;
    focusStationOnMap(row.dataset.id);
  };

  tbody.addEventListener('click', (e) => {
    const chartBtn = e.target.closest('.chart-open-btn');
    if (chartBtn) {
      openStationChart(chartBtn.dataset.id, chartBtn.dataset.name, fetchStationRainChart);
      return;
    }
    activateRow(e.target.closest('tr[data-id]'));
  });
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('.chart-open-btn')) return; // ปุ่มมี native click behavior ของตัวเองอยู่แล้ว
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    e.preventDefault();
    activateRow(row);
  });
}

// คลิกหัวคอลัมน์ "ปริมาณฝน" เพื่อเรียงมากสุด-น้อยสุด (คลิกซ้ำสลับทิศทาง) — Enter/Space ก็ใช้ได้เพราะตั้ง tabindex/role=button ไว้
function bindRainfallSort() {
  const header = document.getElementById('sortRainfallHeader');
  if (!header) return;
  updateRainfallSortIndicator(); // โชว์สัญลักษณ์ตั้งแต่โหลดหน้าแรก กันคนดูไม่รู้ว่าคอลัมน์นี้กดเรียงได้

  const toggleSort = () => {
    if (currentSortKey === 'rainfall') {
      currentSortDirection = currentSortDirection === 'desc' ? 'asc' : 'desc';
    } else {
      currentSortKey = 'rainfall';
      currentSortDirection = 'desc'; // เริ่มจากมากสุดก่อนตามที่ขอ
    }
    updateRainfallSortIndicator();
    render();
  };

  header.addEventListener('click', toggleSort);
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleSort();
    }
  });
}

function updateRainfallSortIndicator() {
  const indicator = document.getElementById('sortRainfallIndicator');
  if (!indicator) return;
  const isActive = currentSortKey === 'rainfall';
  indicator.textContent = isActive ? (currentSortDirection === 'desc' ? '▼' : '▲') : '⇅';
  indicator.classList.toggle('active', isActive);
}

function bindStatusFilter() {
  document.getElementById('statusFilter').addEventListener('change', (e) => {
    currentStatusFilter = e.target.value;
    render();
  });
}

function bindDistrictFilter() {
  const el = document.getElementById('districtSelect');
  if (!el) return;
  el.addEventListener('change', (e) => {
    currentDistrictFilter = e.target.value;
    populateTambonOptions(allStations); // เปลี่ยนอำเภอ = ตัวเลือกตำบลต้องรีสโคปตาม
    render();
  });
}

function bindTambonFilter() {
  const el = document.getElementById('tambonSelect');
  if (!el) return;
  el.addEventListener('change', (e) => {
    currentTambonFilter = e.target.value;
    render();
  });
}

function bindAgencyFilter() {
  const el = document.getElementById('agencySelect');
  if (!el) return;
  el.addEventListener('change', (e) => {
    currentAgencyFilter = e.target.value;
    render();
  });
}

function bindPeriodSelect() {
  const el = document.getElementById('periodSelect');
  const hint = document.getElementById('periodHint');
  if (!el) return;
  el.addEventListener('change', async (e) => {
    currentPeriod = e.target.value;
    if (hint) hint.textContent = `แสดงข้อมูล ${PERIOD_CONFIG[currentPeriod].label} จากคลังข้อมูลน้ำแห่งชาติ (สสน.)`;
    renderMapLegend(); // legend ขึ้นกับช่วงเวลา (รายเดือน/รายปีใช้สเกลละเอียด) จึงต้องวาดใหม่ทุกครั้ง
    await loadAll(); // เปลี่ยนช่วงเวลา = ต้องยิง endpoint ใหม่ทั้งชุด ไม่ใช่แค่ filter ข้อมูลเดิม
  });
}

function bindTableSearch() {
  const input = document.getElementById('tableSearch');
  let debounceTimer;
  input.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const value = e.target.value;
    // รอ 250ms หลังหยุดพิมพ์ค่อย render จริง — กันเรียก render ทุก keystroke ตอนพิมพ์เร็วๆ
    debounceTimer = setTimeout(() => {
      currentSearchQuery = value;
      render();
    }, 250);
  });
}