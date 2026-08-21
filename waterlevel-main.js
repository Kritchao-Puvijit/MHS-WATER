/* ==========================================================
   waterlevel-main.js — MHS Water Level Watch
   หน้าที่: ดึงข้อมูลระดับน้ำจาก Thaiwater API (สสน.), อัปเดต status bar / map / table
   ========================================================== */

console.log = function () { };

const THAIWATER_BASE = 'https://api-v3.thaiwater.net/api/v1/thaiwater30';
const WATERLEVEL_PATH = '/public/waterlevel_load';
// ดึงค่าระดับน้ำ
const WATERLEVEL_VALUE_KEYS = ['waterlevel_m', 'waterlevel_msl', 'waterlevel_data', 'waterlevel', 'wl', 'value'];

// สถานีที่ Thaiwater ไม่มีค่า % ความจุ/สถานะ (ขึ้น "ไม่มีข้อมูล" สีเทา) — ใช้ค่าจากระบบโทรมาตร กรมชลประทาน
// (telerid.rid.go.th) แทน โดย map ด้วยชื่อสถานีที่ตรงกันทุกตัวอักษร
// ยกเว้น "เมืองแม่ฮ่องสอน" (มีข้อมูลจาก Thaiwater ปกติอยู่แล้ว) และ "บ้านท่าโป่งแดง" (ตามที่ผู้ใช้ระบุให้คงไว้ที่ Thaiwater)
// — ทั้งสองสถานีนี้ไม่มีอยู่ในระบบโทรมาตรของกรมชลประทานอยู่แล้วด้วย
// zerogate = ระดับท้องน้ำ (0%), criticalLevel = ระดับตลิ่ง (100%) — คำนวณ % ความจุแบบเดียวกับที่ Thaiwater ใช้
const RID_TELERID_WS_BASE = 'wss://telerid.rid.go.th/ws';
const RID_STATION_OVERRIDES = {
  'บ้านท่าสองแคว': { ridId: 912, zerogate: 247.96, criticalLevel: 256.93 },
  'บ้านพะมอลอ': { ridId: 913, zerogate: 202.26, criticalLevel: 208.93 },
  'บ้านแม่ตะควน': { ridId: 914, zerogate: 117.99, criticalLevel: 123.09 },
  'บ้านสบสา': { ridId: 916, zerogate: 444.46, criticalLevel: 450.89 },
  'ห้วยน้ำของ': { ridId: 917, zerogate: 334.36, criticalLevel: 340.09 },
  'ปางหมู': { ridId: 918, zerogate: 192.62, criticalLevel: 200.03 },
};

let allStations = [];
let currentStatusFilter = '';
let currentSearchQuery = '';
let currentDistrictFilter = '';
let currentAgencyFilter = '';
let currentSortKey = 'recordedAt'; // 'recordedAt' (ค่าเริ่มต้น: เวลาล่าสุดก่อน) | 'waterlevel' (คลิกหัวตาราง)
let currentSortDirection = 'desc';

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  renderMapLegend();
  startLiveClock();
  bindStatusFilter();
  bindTableSearch();
  bindDistrictFilter();
  bindAgencyFilter();
  bindHeaderNav();
  bindTableRowClick();
  bindWaterlevelSort();

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
  const lists = [];
  if (Array.isArray(json?.waterlevel_data?.data)) lists.push(...json.waterlevel_data.data);
  if (Array.isArray(json?.waterlevel_manual_data?.data)) lists.push(...json.waterlevel_manual_data.data);
  return lists;
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
    // เพราะ endpoint กราฟย้อนหลัง (waterlevel_graph) ต้องการ station_id ตัวจริงเท่านั้น
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
    waterlevel: parseFloat(pick(raw, valueKeys)),
    storagePercent: parseFloat(pick(raw, ['storage_percent', 'storagePercent'])),
    minBank: parseFloat(pick(station, ['min_bank', 'left_bank', 'right_bank'])),
    diffBank: parseFloat(pick(raw, ['diff_wl_bank'])),
    diffBankText: pick(raw, ['diff_wl_bank_text'], '-'),
    riverName: pickLocalized(raw, ['river_name'], '-'),
    recordedAt: pick(raw, ['waterlevel_datetime', 'rainfall_datetime', 'datetime', 'measure_time'], '-'),
    agency: pickLocalized(raw.agency || {}, ['agency_name'], '-'),
  };
}

/* ---------------- Load ---------------- */
async function loadAll() {
  try {
    await loadStationsFromThaiwater();
    render();
  } catch (err) {
    console.error('โหลดข้อมูลไม่สำเร็จ:', err);
    document.getElementById('reportTableBody').innerHTML =
      `<tr><td colspan="7" class="text-center" style="color:#F87171;">${err.message}</td></tr>`;
  }
}

async function loadStationsFromThaiwater() {
  const json = await fetchApi(`${THAIWATER_BASE}${WATERLEVEL_PATH}`);
  const rawList = extractRecords(json);

  log(`[Thaiwater waterlevel] raw response (${rawList.length} รายการทั้งประเทศ):`, json);
  if (rawList.length) {
    console.log('%c[Thaiwater waterlevel] ตัวอย่าง record แรก (ใช้เช็ค field name):', 'color:#38BDF8;font-weight:bold', rawList[0]);
  }

  const mhsOnly = rawList.filter(isMaeHongSonRecord);
  log(`[Thaiwater waterlevel] กรองเฉพาะแม่ฮ่องสอนได้: ${mhsOnly.length} สถานี`);

  allStations = mhsOnly
    .map((raw) => normalizeThaiwaterStation(raw, WATERLEVEL_VALUE_KEYS))
    .filter((s) => !isNaN(s.lat) && !isNaN(s.lng));

  log(`[Thaiwater waterlevel] มีพิกัดใช้ปักหมุดได้จริง: ${allStations.length} สถานี`);

  await applyRidTeleridOverrides(allStations);

  populateDistrictOptions(allStations);
  populateAgencyOptions(allStations);
}

// เติมค่าระดับน้ำ/% ความจุ/เวลาข้อมูล ให้สถานีที่ Thaiwater ไม่มีข้อมูล โดยดึงจากระบบโทรมาตรกรมชลประทานแทน
// ต่อ WebSocket แบบครั้งเดียว (ไม่ค้างสาย) รอ event แรกที่มีข้อมูลสถานีทั้งหมด แล้วปิดทันที
async function applyRidTeleridOverrides(stations) {
  const targets = stations.filter((s) => RID_STATION_OVERRIDES[s.name]);
  if (!targets.length) return;

  let ridData;
  try {
    ridData = await fetchRidTeleridSnapshot();
  } catch (err) {
    log('[RID telerid] ดึงข้อมูลไม่สำเร็จ ใช้ค่าจาก Thaiwater เดิมต่อไป:', err.message);
    return;
  }

  targets.forEach((s) => {
    const override = RID_STATION_OVERRIDES[s.name];
    const stationData = ridData[String(override.ridId)];
    const wl = stationData?.values?.water_level;
    if (!stationData || wl == null || wl.value == null) return;

    s.waterlevel = wl.value;
    s.storagePercent = ((wl.value - override.zerogate) / (override.criticalLevel - override.zerogate)) * 100;
    s.recordedAt = formatUnixToDateTimeString(wl.unixtime);
  });

  log(`[RID telerid] เติมข้อมูลให้ ${targets.length} สถานี`, targets.map((s) => s.name));
}

function formatUnixToDateTimeString(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

// เปิด WebSocket ไปที่ระบบโทรมาตรกรมชลประทาน (telerid.rid.go.th) รอรับข้อความแรก (type: INIT ครอบคลุมทุกสถานีทั่วประเทศ)
// แล้วปิดทันที — ไม่ค้างสายไว้ เพราะหน้านี้ดึงข้อมูลใหม่เป็นรอบอยู่แล้ว (ทุก 5 นาที) ไม่จำเป็นต้องรับ real-time push ตลอดเวลา
function fetchRidTeleridSnapshot(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws?.close();
      reject(new Error('หมดเวลาเชื่อมต่อระบบโทรมาตรกรมชลประทาน'));
    }, timeoutMs);

    try {
      ws = new WebSocket(`${RID_TELERID_WS_BASE}/public/`);
    } catch (err) {
      clearTimeout(timer);
      reject(err);
      return;
    }

    ws.onmessage = (e) => {
      if (settled) return;
      try {
        const msg = JSON.parse(e.data);
        const payload = JSON.parse(msg.message);
        if (payload.type !== 'INIT') return; // รอเฉพาะข้อความแรกที่มีข้อมูลครบทุกสถานี
        settled = true;
        clearTimeout(timer);
        ws.close();
        resolve(payload.data);
      } catch (err) {
        settled = true;
        clearTimeout(timer);
        ws.close();
        reject(err);
      }
    };
    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('เชื่อมต่อระบบโทรมาตรกรมชลประทานไม่สำเร็จ'));
    };
  });
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
    stations = stations.filter((s) => classifyWaterlevelStatus(s.storagePercent) === currentStatusFilter);
  }

  if (currentDistrictFilter) {
    stations = stations.filter((s) => s.district === currentDistrictFilter);
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
  renderStationMarkers(filteredStations);
  renderStatusBar();
  renderTable(filteredStations);
}

function renderStatusBar() {
  const counts = { critical_low: 0, low: 0, normal: 0, high: 0, overflow: 0 };
  allStations.forEach((s) => {
    const status = classifyWaterlevelStatus(s.storagePercent);
    if (status) counts[status]++;
  });

  document.getElementById('countTotal').textContent = allStations.length;
  document.getElementById('countCriticalLow').textContent = counts.critical_low;
  document.getElementById('countLow').textContent = counts.low;
  document.getElementById('countNormal').textContent = counts.normal;
  document.getElementById('countHigh').textContent = counts.high;
  document.getElementById('countOverflow').textContent = counts.overflow;
}

function renderTable() {
  const tbody = document.getElementById('reportTableBody');
  let rows = getFilteredStations().filter((s) => !isNaN(s.waterlevel) || !isNaN(s.storagePercent));

  if (currentSortKey === 'waterlevel') {
    rows.sort((a, b) => {
      // บางสถานีไม่มีค่าระดับน้ำ (NaN) แต่ยังผ่าน filter เพราะมีความจุลำน้ำ — ดันไปท้ายเสมอไม่ว่าจะเรียงทิศไหน
      const aNaN = isNaN(a.waterlevel);
      const bNaN = isNaN(b.waterlevel);
      if (aNaN && bNaN) return 0;
      if (aNaN) return 1;
      if (bNaN) return -1;
      return currentSortDirection === 'desc' ? b.waterlevel - a.waterlevel : a.waterlevel - b.waterlevel;
    });
  } else {
    rows.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1)); // ค่าเริ่มต้น: เวลาล่าสุดก่อน
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center muted">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((s) => {
      const status = classifyWaterlevelStatus(s.storagePercent) || 'unknown';
      const levelText = !isNaN(s.waterlevel) ? `${s.waterlevel.toFixed(2)} <span class="muted">ม.</span>` : '-';
      const percentText = !isNaN(s.storagePercent) ? `${s.storagePercent.toFixed(1)} <span class="muted">%</span>` : '-';
      return `
      <tr data-id="${s.id}" tabindex="0">
        <td>${s.name}</td>
        <td>${s.subDistrict}</td>
        <td>${s.district}</td>
        <td class="text-right">${levelText}</td>
        <td class="text-right">${percentText}</td>
        <td><span class="status-badge ${status}">${STATUS_LABEL[status]}</span></td>
        <td class="muted">${s.recordedAt}</td>
        <td class="text-center">
          <button type="button" class="chart-open-btn" data-id="${s.id}" data-name="${s.name}" title="ดูกราฟย้อนหลัง" aria-label="ดูกราฟย้อนหลัง">📈</button>
        </td>
      </tr>`;
    })
    .join('');
}

// แปลงวันที่ (YYYY-MM-DD จาก input type=date) เป็น unix timestamp (วินาที) ของเที่ยงคืนตามเวลาไทย (UTC+7)
// ใช้เทียบกับ unixtime ที่ได้จากระบบโทรมาตรกรมชลประทาน (ซึ่งเป็นเวลาไทยเช่นกัน)
function bangkokDateToUnixSeconds(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return (Date.UTC(y, m - 1, d, 0, 0, 0) - 7 * 3600 * 1000) / 1000;
}

// ดึงข้อมูลระดับน้ำย้อนหลังของสถานีหนึ่ง จากระบบโทรมาตรกรมชลประทาน (telerid.rid.go.th) — ใช้กับสถานีใน
// RID_STATION_OVERRIDES เท่านั้น (สถานีที่ Thaiwater ไม่มีข้อมูลกราฟ) ต่อ WebSocket ครั้งเดียวแล้วปิดทันที เหมือน fetchRidTeleridSnapshot
// หมายเหตุ: ข้อมูลย้อนหลังของ endpoint นี้เป็น rolling window ประมาณ 4 วันล่าสุดเท่านั้น (ไม่ใช่คลังข้อมูลเต็ม)
// ถ้าผู้ใช้เลือกช่วงวันที่ย้อนหลังไกลกว่านั้น จะกรองแล้วไม่พบข้อมูลในช่วงนั้น (ขึ้น "ไม่มีข้อมูล" ตามปกติ ไม่ใช่ error)
function fetchRidStationHistory(ridId, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws?.close();
      reject(new Error('หมดเวลาเชื่อมต่อระบบโทรมาตรกรมชลประทาน'));
    }, timeoutMs);

    try {
      ws = new WebSocket(`${RID_TELERID_WS_BASE}/station/${ridId}/`);
    } catch (err) {
      clearTimeout(timer);
      reject(err);
      return;
    }

    ws.onmessage = (e) => {
      if (settled) return;
      try {
        const msg = JSON.parse(e.data);
        const payload = JSON.parse(msg.message); // ข้อความแรกคือข้อมูลสถานีเต็ม (ไม่มี type/data ห่ออีกชั้นเหมือน /public/)
        settled = true;
        clearTimeout(timer);
        ws.close();
        resolve(payload);
      } catch (err) {
        settled = true;
        clearTimeout(timer);
        ws.close();
        reject(err);
      }
    };
    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('เชื่อมต่อระบบโทรมาตรกรมชลประทานไม่สำเร็จ'));
    };
  });
}

// ดึงข้อมูลระดับน้ำย้อนหลังของสถานีหนึ่งๆ ตามช่วงวันที่เริ่มต้น/สิ้นสุดที่ผู้ใช้เลือก สำหรับ modal กราฟ (js/station-chart.js)
// หน้านี้ไม่มี #chartPeriodSelect (มีมุมมองเดียวคือช่วงวันที่กำหนดเอง) — periodType/month/year ไม่ได้ใช้ตรงๆ
// รับไว้เฉยๆ ให้ signature ตรงกับ contract กลางของ station-chart.js (ทุกหน้าเรียก fetchFn รูปแบบเดียวกัน)
//
// สถานีที่อยู่ใน RID_STATION_OVERRIDES (Thaiwater ไม่มีข้อมูลกราฟให้เลย) ดึงจากระบบโทรมาตรกรมชลประทานแทน
// สถานีอื่นๆ ยังใช้ Thaiwater ตามเดิม — แต่ endpoint waterlevel_graph ฝั่ง Thaiwater ยังพัง (โยน 500/panic)
// กับทุกสถานีที่ลองแล้ว รวมถึงสถานีที่เป็น key station ด้วย เขียนแบบยืดหยุ่น (ลองหลายชื่อ field ด้วย pick()) ไว้ก่อน
// เผื่อฝั่งเขาแก้ไขแล้วจะใช้งานได้เลยโดยไม่ต้องแก้โค้ด
async function fetchStationWaterLevelChart(stationId, periodType, month, year, startDate, endDate) {
  if (!startDate || !endDate) return null;

  const station = allStations.find((s) => String(s.id) === String(stationId));
  const ridOverride = station ? RID_STATION_OVERRIDES[station.name] : null;

  let rawTimestamps;
  let values;

  if (ridOverride) {
    let payload;
    try {
      payload = await fetchRidStationHistory(ridOverride.ridId);
    } catch (err) {
      throw new Error('ระบบข้อมูลย้อนหลังของสถานีนี้ขัดข้องชั่วคราว (ระบบโทรมาตรกรมชลประทาน) กรุณาลองใหม่ภายหลัง');
    }
    const series = payload?.values?.water_level_graph?.['0'];
    if (!series || !Array.isArray(series.value) || !Array.isArray(series.time)) return null;

    const startUnix = bangkokDateToUnixSeconds(startDate);
    const endUnixExclusive = bangkokDateToUnixSeconds(endDate) + 86400; // สิ้นสุดวันที่เลือก (ไม่รวมวันถัดไป)

    const filtered = [];
    series.time.forEach((t, i) => {
      if (t >= startUnix && t < endUnixExclusive && series.value[i] != null) {
        filtered.push({ t, v: series.value[i] });
      }
    });
    if (!filtered.length) return null;

    rawTimestamps = filtered.map((f) => formatUnixToDateTimeString(f.t));
    values = filtered.map((f) => f.v);
  } else {
    const url = `${THAIWATER_BASE}/public/waterlevel_graph?station_id=${stationId}&start_date=${startDate}&end_date=${endDate}`;
    let json;
    try {
      json = await fetchApi(url);
    } catch (err) {
      throw new Error('ระบบข้อมูลย้อนหลังของสถานีนี้ขัดข้องชั่วคราว (แหล่งข้อมูลต้นทาง) กรุณาลองใหม่ภายหลัง');
    }
    if (json.result !== 'OK' || !Array.isArray(json.data) || !json.data.length) return null;

    rawTimestamps = json.data.map((d) => pick(d, ['waterlevel_datetime', 'datetime', 'date'], ''));
    values = json.data.map((d) => parseFloat(pick(d, ['waterlevel_value', 'waterlevel_m', 'value'], null)));
  }

  const labels = rawTimestamps.map((raw) => {
    const datePart = raw.split(' ')[0];
    const parts = datePart.split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : datePart;
  });

  // จุดเดี่ยวไม่ลากเส้นเชื่อม (showLine:false) ให้เหมือนกราฟต้นแบบของ Thaiwater เอง — ค่าน้ำมาไม่สม่ำเสมอ
  // ลากเส้นเชื่อมจุดที่ห่างกันมากๆ จะทำให้เข้าใจผิดว่ามีข้อมูลต่อเนื่องช่วงที่จริงๆ ไม่มี
  const datasets = [
    {
      type: 'line',
      label: 'ระดับน้ำ',
      data: values,
      showLine: false,
      pointRadius: 4,
      pointHoverRadius: 6,
    },
  ];

  // เส้นประสีแดง = ระดับตลิ่งของสถานีนี้ (ค่าคงที่ ไม่ใช่อนุกรมเวลา) — ใช้เตือนสายตาว่าระดับน้ำใกล้ล้นตลิ่งแค่ไหน
  // เอาค่าจริงใส่ใน label เลย (ไม่ต้อง hover ดู) ให้ใกล้เคียงกับกราฟต้นแบบที่ติดป้ายค่าไว้ข้างเส้นตรงๆ
  // (station คำนวณไว้แล้วด้านบนตอนเช็ค ridOverride)
  // สถานีที่ใช้ข้อมูล RID (ridOverride) — Thaiwater ไม่มีค่า min_bank ให้ (เป็น 0/NaN) ใช้ criticalLevel
  // จากระบบโทรมาตรกรมชลประทานแทน (ค่าเดียวกับที่ใช้คำนวณ % ความจุในตารางอยู่แล้ว)
  const bankLevel = ridOverride ? ridOverride.criticalLevel : station?.minBank;
  if (bankLevel != null && !isNaN(bankLevel)) {
    datasets.push({
      type: 'line',
      label: `ระดับตลิ่ง${ridOverride ? '' : 'ต่ำสุด'} ${bankLevel.toFixed(2)} ม.รทก.`,
      data: values.map(() => bankLevel),
      borderColor: '#F87171', // แดง ตรงกับ --critical ในธีมเว็บ
      backgroundColor: '#F87171',
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0,
      tension: 0,
    });
  }

  // สถานี RID มี zerogate/criticalLevel คงที่อยู่แล้ว (ใช้คำนวณ % ในตารางอยู่แล้ว) จึงคำนวณ % ความจุ
  // ย้อนหลังทุกจุดจากค่าระดับน้ำเดียวกันนี้ได้เลย — ไม่ใช่ข้อมูลดิบจาก RID ตรงๆ แต่เป็นสูตรเดียวกับที่ใช้ในตาราง
  // วาดบนแกน y ขวา (y1) เพราะหน่วยคนละแบบกับระดับน้ำ (% เทียบกับ ม.รทก.)
  if (ridOverride) {
    const percentValues = values.map(
      (v) => ((v - ridOverride.zerogate) / (ridOverride.criticalLevel - ridOverride.zerogate)) * 100
    );
    datasets.push({
      type: 'line',
      label: 'ความจุลำน้ำ (%)',
      data: percentValues,
      yAxisID: 'y1',
      unitSuffix: '%',
      borderColor: '#34D399', // เขียว ตรงกับสถานะ "ปกติ" ในธีม
      backgroundColor: '#34D399',
      showLine: true,
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 2,
    });
  }

  return {
    unitLabel: 'ระดับน้ำ (ม.รทก.)',
    unitSuffix: 'ม.รทก.',
    y1Label: ridOverride ? 'ความจุลำน้ำ (%)' : undefined,
    rawTimestamps,
    labels,
    datasets,
  };
}

// คลิก (หรือกด Enter บนแถวที่โฟกัสด้วยคีย์บอร์ด) แถวไหนในตาราง ให้เลื่อนแผนที่ไปเปิด popup สถานีนั้น (js/waterlevel-map.js)
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
      openStationChart(chartBtn.dataset.id, chartBtn.dataset.name, fetchStationWaterLevelChart);
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

// คลิกหัวคอลัมน์ "ระดับน้ำ" เพื่อเรียงมากสุด-น้อยสุด (คลิกซ้ำสลับทิศทาง) — Enter/Space ก็ใช้ได้เพราะตั้ง tabindex/role=button ไว้
function bindWaterlevelSort() {
  const header = document.getElementById('sortWaterlevelHeader');
  if (!header) return;
  updateWaterlevelSortIndicator(); // โชว์สัญลักษณ์ตั้งแต่โหลดหน้าแรก กันคนดูไม่รู้ว่าคอลัมน์นี้กดเรียงได้

  const toggleSort = () => {
    if (currentSortKey === 'waterlevel') {
      currentSortDirection = currentSortDirection === 'desc' ? 'asc' : 'desc';
    } else {
      currentSortKey = 'waterlevel';
      currentSortDirection = 'desc'; // เริ่มจากมากสุดก่อนตามที่ขอ
    }
    updateWaterlevelSortIndicator();
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

function updateWaterlevelSortIndicator() {
  const indicator = document.getElementById('sortWaterlevelIndicator');
  if (!indicator) return;
  const isActive = currentSortKey === 'waterlevel';
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