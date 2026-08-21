/* ==========================================================
   station-chart.js — Modal + Chart.js สำหรับดูกราฟรายสถานี
   ใช้ร่วมกันทั้งหน้าน้ำฝน (main.js) และหน้าระดับน้ำ (waterlevel-main.js)
   แต่ละหน้าจะเรียก openStationChart(id, name, fetchFn) โดยส่งฟังก์ชันดึงข้อมูลของตัวเองเข้ามา
   fetchFn: async (stationId, periodType, month, year, startDate, endDate) => { unitLabel, labels, datasets } | null | throws
   startDate/endDate เป็น 'YYYY-MM-DD' มีความหมายเฉพาะ periodType ที่เป็นช่วงวันที่กำหนดเอง (rain3d/rain5d/rain7d/rain15d)
   ไฟล์นี้ไม่รู้จัก field ข้อมูลเฉพาะของแต่ละหน้าเลย รู้แค่ผลลัพธ์ที่ provider ส่งกลับมาตาม contract ข้างบน
   ========================================================== */

let stationChart = null; // instance ของ Chart.js ปัจจุบัน (ต้อง destroy ก่อนสร้างใหม่ทุกครั้ง)
let currentChartStation = null; // { id, name, fetchFn }
let currentChartMonth = null; // 1-12 (มีความหมายเฉพาะตอน periodType เป็น rain_monthly)
let currentChartYear = null;
let currentChartStartDate = null; // 'YYYY-MM-DD' (มีความหมายเฉพาะ periodType ที่เป็นช่วงวันที่กำหนดเอง)
let currentChartEndDate = null;
let currentChartPeriod = 'rain_monthly'; // ค่าเริ่มต้น — หน้าที่ไม่มี #chartPeriodSelect (เช่นระดับน้ำ) จะใช้ค่านี้ตลอด
let chartRequestToken = 0; // กันกรณีสลับเดือน/ประเภทข้อมูลเร็วๆ แล้ว response เก่ามาถึงทีหลัง response ใหม่

// ประเภทข้อมูลที่ query เป็นช่วงวันที่เริ่มต้น/สิ้นสุดได้เอง (แทนที่จะเป็นหน้าต่างตายตัว)
const DATE_RANGE_DEFAULT_DAYS = { rain3d: 3, rain5d: 5, rain7d: 7, rain15d: 15 };
function isDateRangePeriod(period) {
  return Object.prototype.hasOwnProperty.call(DATE_RANGE_DEFAULT_DAYS, period);
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('chartModalOverlay');
  if (!overlay) return; // หน้านี้ไม่มี modal (กันพลาด ไม่ error ถ้าลืมใส่ markup)

  const closeBtn = document.getElementById('chartModalClose');
  const prevBtn = document.getElementById('chartPrevMonth');
  const nextBtn = document.getElementById('chartNextMonth');
  const periodSelect = document.getElementById('chartPeriodSelect');
  const yearSelect = document.getElementById('chartYearSelect');
  const monthSelect = document.getElementById('chartMonthSelect');
  const startDateInput = document.getElementById('chartStartDate');
  const endDateInput = document.getElementById('chartEndDate');

  closeBtn.addEventListener('click', closeStationChart);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeStationChart();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeStationChart();
  });

  // หน้าน้ำฝนเอาปุ่ม ‹ › ออกแล้ว (ใช้ dropdown เดือน/ปี query ตรงๆ แทน) หน้าระดับน้ำยังมีอยู่ — เช็คก่อนผูก event กันพัง
  if (prevBtn) prevBtn.addEventListener('click', () => shiftChartMonth(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => shiftChartMonth(1));

  if (periodSelect) {
    currentChartPeriod = periodSelect.value;
    periodSelect.addEventListener('change', (e) => {
      currentChartPeriod = e.target.value;
      updateMonthNavVisibility();
      updateYearNavVisibility();
      updateDateRangeNavVisibility();
      if (isDateRangePeriod(currentChartPeriod)) setDefaultDateRange(currentChartPeriod);
      loadChartData();
    });
  }

  if (yearSelect) {
    yearSelect.addEventListener('change', (e) => {
      currentChartYear = parseInt(e.target.value, 10);
      loadChartData();
    });
  }

  if (monthSelect) {
    monthSelect.addEventListener('change', (e) => {
      currentChartMonth = parseInt(e.target.value, 10);
      loadChartData();
    });
  }

  if (startDateInput && endDateInput) {
    startDateInput.addEventListener('change', (e) => {
      currentChartStartDate = e.target.value;
      endDateInput.min = e.target.value;
      loadChartData();
    });
    endDateInput.addEventListener('change', (e) => {
      currentChartEndDate = e.target.value;
      startDateInput.max = e.target.value;
      loadChartData();
    });
  }

  bindChartDownloadMenu();
});

function updateMonthNavVisibility() {
  const nav = document.getElementById('chartMonthNav');
  if (!nav) return;
  // ปุ่มเลื่อนเดือนมีความหมายเฉพาะมุมมองรายเดือน (รายวันตลอดเดือน) — มุมมอง 24 ชม./วันนี้/เมื่อวาน/7 วัน
  // เป็นหน้าต่างข้อมูลแบบ "ล่าสุด ณ ตอนนี้" ไม่มีแนวคิดเดือนให้เลื่อน
  nav.style.display = currentChartPeriod === 'rain_monthly' ? 'flex' : 'none';
}

function updateDateRangeNavVisibility() {
  const nav = document.getElementById('chartDateRangeNav');
  if (!nav) return;
  // หน้าที่ไม่มี #chartPeriodSelect (เช่นระดับน้ำ) มีมุมมองเดียวคือช่วงวันที่กำหนดเอง จึงแสดงเสมอ
  // หน้าที่มี period dropdown (น้ำฝน) แสดงเฉพาะตอนเลือกประเภท 3/5/7/15 วัน
  const periodSelect = document.getElementById('chartPeriodSelect');
  const show = !periodSelect || isDateRangePeriod(currentChartPeriod);
  nav.style.display = show ? 'flex' : 'none';
}

function formatDateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ตั้งค่าเริ่มต้นของช่วงวันที่เป็น N วันล่าสุด นับถึงวันนี้ — ผู้ใช้ปรับวันที่เองต่อได้อิสระหลังจากนี้ ไม่ได้ล็อกไว้ตายตัว
function setDefaultDateRangeDays(days) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));

  currentChartEndDate = formatDateISO(today);
  currentChartStartDate = formatDateISO(start);

  const startInput = document.getElementById('chartStartDate');
  const endInput = document.getElementById('chartEndDate');
  const todayStr = formatDateISO(today);
  if (startInput) {
    startInput.value = currentChartStartDate;
    startInput.max = todayStr;
  }
  if (endInput) {
    endInput.value = currentChartEndDate;
    endInput.max = todayStr;
    endInput.min = currentChartStartDate;
  }
  if (startInput) startInput.max = currentChartEndDate;
}

// ตั้งค่าเริ่มต้นของช่วงวันที่ตามจำนวนวันของตัวเลือกที่กด (3/5/7/15 วัน) — ใช้เฉพาะหน้าที่มี #chartPeriodSelect
function setDefaultDateRange(periodType) {
  const days = DATE_RANGE_DEFAULT_DAYS[periodType];
  if (!days) return;
  setDefaultDateRangeDays(days);
}

// ช่อง "ปี" ใช้ร่วมกันทั้งมุมมองรายเดือน (query เดือน+ปีที่ต้องการตรงๆ) และรายปี
function updateYearNavVisibility() {
  const nav = document.getElementById('chartYearNav');
  if (!nav) return;
  const showYear = currentChartPeriod === 'rain_monthly' || currentChartPeriod === 'rain_yearly';
  nav.style.display = showYear ? 'flex' : 'none';
  // ซิงก์ dropdown ให้ตรงกับ currentChartYear เผื่อเลื่อนข้ามปีมาจากปุ่ม ‹ › ก่อนหน้า
  const yearSelect = document.getElementById('chartYearSelect');
  if (showYear && yearSelect && yearSelect.value !== String(currentChartYear)) {
    yearSelect.value = String(currentChartYear);
  }
}

// เติมตัวเลือกปีใน dropdown ย้อนหลังจากปีปัจจุบัน — เลือกปีที่สถานีนั้นไม่มีข้อมูลจะเห็นข้อความแจ้งเฉยๆ ไม่พัง
// จึงไม่ต้องเช็คก่อนว่าสถานีมีข้อมูลย้อนไปถึงปีไหนจริงๆ (query ตรงๆ แล้วให้ผลลัพธ์บอกเอง เร็วกว่าเช็คทีละปี)
const CHART_YEARS_BACK = 15;
function populateChartYearOptions(selectedYear) {
  const select = document.getElementById('chartYearSelect');
  if (!select) return;
  const currentYear = new Date().getFullYear();
  const options = [];
  for (let y = currentYear; y >= currentYear - CHART_YEARS_BACK; y--) {
    options.push(`<option value="${y}">${y}</option>`);
  }
  select.innerHTML = options.join('');
  select.value = String(selectedYear);
}

// เติมตัวเลือกเดือนใน dropdown (ใช้เฉพาะมุมมองรายเดือนของหน้าน้ำฝน — หน้าระดับน้ำยังใช้ label แบบเดิม)
function populateChartMonthOptions(selectedMonth) {
  const select = document.getElementById('chartMonthSelect');
  if (!select) return;
  select.innerHTML = THAI_MONTHS.map((name, i) => `<option value="${i + 1}">${name}</option>`).join('');
  select.value = String(selectedMonth);
}

// ซิงก์ dropdown เดือน/ปี ให้ตรงกับ currentChartMonth/currentChartYear เสมอ ไม่ว่าจะเปลี่ยนค่าจากปุ่ม ‹ ›
// หรือจากตัว dropdown เอง — ถ้าหน้านั้นไม่มี element (เช่นหน้าระดับน้ำ) จะ no-op เฉยๆ
function syncMonthYearSelects() {
  const monthSelect = document.getElementById('chartMonthSelect');
  if (monthSelect && monthSelect.value !== String(currentChartMonth)) {
    monthSelect.value = String(currentChartMonth);
  }
  const yearSelect = document.getElementById('chartYearSelect');
  if (yearSelect && yearSelect.value !== String(currentChartYear)) {
    yearSelect.value = String(currentChartYear);
  }
}

// เรียกจากตารางแต่ละหน้า
function openStationChart(stationId, stationName, fetchFn) {
  currentChartStation = { id: stationId, name: stationName, fetchFn };
  const now = new Date();
  currentChartMonth = now.getMonth() + 1;
  currentChartYear = now.getFullYear();
  populateChartYearOptions(currentChartYear);
  populateChartMonthOptions(currentChartMonth);

  const periodSelect = document.getElementById('chartPeriodSelect');
  if (periodSelect) currentChartPeriod = periodSelect.value;
  updateMonthNavVisibility();
  updateYearNavVisibility();
  updateDateRangeNavVisibility();
  if (isDateRangePeriod(currentChartPeriod)) {
    setDefaultDateRange(currentChartPeriod);
  } else if (!periodSelect) {
    setDefaultDateRangeDays(7); // หน้าที่ไม่มี period dropdown (ระดับน้ำ) — ค่าเริ่มต้น 7 วันล่าสุด
  }

  document.getElementById('chartModalTitle').textContent = `กราฟสถานี${stationName}`;
  document.getElementById('chartModalOverlay').classList.add('open');
  document.body.classList.add('chart-modal-active');

  loadChartData();
}

function closeStationChart() {
  document.getElementById('chartModalOverlay').classList.remove('open');
  document.body.classList.remove('chart-modal-active');
  closeChartDownloadMenu();
  currentChartStation = null;
  if (stationChart) {
    stationChart.destroy();
    stationChart = null;
  }
}

function shiftChartMonth(delta) {
  if (!currentChartStation || currentChartPeriod !== 'rain_monthly') return;
  currentChartMonth += delta;
  if (currentChartMonth > 12) {
    currentChartMonth = 1;
    currentChartYear += 1;
  } else if (currentChartMonth < 1) {
    currentChartMonth = 12;
    currentChartYear -= 1;
  }
  loadChartData();
}

async function loadChartData() {
  if (!currentChartStation) return;
  const token = ++chartRequestToken;

  syncMonthYearSelects(); // หน้าน้ำฝน: ซิงก์ dropdown เดือน/ปี ให้ตรงกับค่าปัจจุบันเสมอ (no-op ถ้าไม่มี element)

  // หน้าระดับน้ำยังใช้ label ข้อความแบบเดิม (ยังไม่มี dropdown เดือน/ปี)
  const monthLabelEl = document.getElementById('chartMonthLabel');
  if (monthLabelEl) {
    monthLabelEl.textContent = currentChartPeriod === 'rain_monthly'
      ? `${THAI_MONTHS[currentChartMonth - 1]} ${currentChartYear + 543}`
      : '';
  }
  setChartStatus('กำลังโหลดข้อมูล...', false);

  try {
    const result = await currentChartStation.fetchFn(currentChartStation.id, currentChartPeriod, currentChartMonth, currentChartYear, currentChartStartDate, currentChartEndDate);
    if (token !== chartRequestToken) return; // ผู้ใช้สลับเดือน/ประเภทไปแล้วก่อน response นี้จะมาถึง — ทิ้งผลลัพธ์เก่านี้

    if (!result || !result.labels || !result.labels.length) {
      setChartStatus('ไม่มีข้อมูลย้อนหลังสำหรับสถานีนี้ในช่วงเวลาที่เลือก', true);
      renderChart(null);
      return;
    }

    setChartStatus('', false);
    renderChart(result);
  } catch (err) {
    if (token !== chartRequestToken) return;
    setChartStatus(err.message || 'โหลดข้อมูลกราฟไม่สำเร็จ', true);
    renderChart(null);
  }
}

function setChartStatus(text, isError) {
  const el = document.getElementById('chartModalStatus');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
  el.classList.toggle('visible', !!text);
}

// สีธีมเว็บ (ตรงกับ CSS variables ใน style.css) — ต้อง hardcode ค่า hex ที่นี่เพราะ Chart.js อ่าน CSS var ตรงๆ ไม่ได้
const CHART_COLORS = {
  text: '#E7ECF3',
  textMuted: '#8A97AC',
  grid: 'rgba(34, 48, 71, 0.6)',
  surface: '#121B2E',
  surface2: '#17233A',
  border: '#223047',
  accent: '#38BDF8',
  accentSoft: 'rgba(56, 189, 248, 0.45)',
  bar: 'rgba(56, 189, 248, 0.55)',
  barHover: 'rgba(56, 189, 248, 0.75)',
};

function renderChart(result) {
  const canvas = document.getElementById('stationChartCanvas');
  if (stationChart) {
    stationChart.destroy();
    stationChart = null;
  }
  if (!result) {
    canvas.style.display = 'none';
    return;
  }
  canvas.style.display = 'block';

  // ค่าที่ ds ระบุมาเองต้องชนะค่า default เสมอ (เผื่อ provider อยากได้เส้นสีอื่น เช่น เส้นประแดง "ระดับตลิ่งต่ำสุด"
  // ที่ไม่ควรถูกบังคับให้เป็นสี accent ฟ้าเหมือนเส้นข้อมูลปกติ) — ใช้ ?? เช็ค undefined ไม่ใช่ || เพราะค่า 0 ก็ต้องรอด
  const datasets = result.datasets.map((ds) => ({
    ...ds,
    borderColor: ds.borderColor ?? (ds.type === 'line' ? CHART_COLORS.accent : CHART_COLORS.bar),
    backgroundColor: ds.backgroundColor ?? (ds.type === 'line' ? CHART_COLORS.accentSoft : CHART_COLORS.bar),
    hoverBackgroundColor: ds.hoverBackgroundColor ?? (ds.type === 'line' ? CHART_COLORS.accent : CHART_COLORS.barHover),
    borderWidth: ds.borderWidth ?? (ds.type === 'line' ? 2.5 : 0),
    borderRadius: ds.type === 'bar' ? 4 : undefined,
    borderSkipped: ds.type === 'bar' ? false : undefined,
    tension: ds.tension ?? (ds.type === 'line' ? 0.35 : undefined),
    pointRadius: ds.pointRadius ?? (ds.type === 'line' ? 2.5 : undefined),
    pointBackgroundColor: ds.pointBackgroundColor ?? (ds.type === 'line' ? CHART_COLORS.accent : undefined),
    pointBorderWidth: ds.pointBorderWidth ?? (ds.type === 'line' ? 0 : undefined),
    yAxisID: ds.yAxisID || 'y',
    order: ds.order ?? (ds.type === 'line' ? 0 : 1), // เส้นวาดทับแท่งเสมอ (ยกเว้นระบุ order เองเพื่อคุมชั้นเฉพาะ)
  }));

  stationChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: result.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            color: CHART_COLORS.textMuted,
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 8,
            boxHeight: 8,
            padding: 16,
            font: { family: "'Sarabun', sans-serif", size: 12 },
          },
        },
        tooltip: {
          backgroundColor: CHART_COLORS.surface2,
          titleColor: CHART_COLORS.text,
          bodyColor: CHART_COLORS.text,
          borderColor: CHART_COLORS.border,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          titleFont: { family: "'Kanit', sans-serif", size: 12, weight: '600' },
          bodyFont: { family: "'Sarabun', sans-serif", size: 12 },
          displayColors: true,
          boxPadding: 4,
          callbacks: {
            // rawTimestamps/unitSuffix เป็น field เสริม (opt-in) — provider ไหนไม่ส่งมาก็ใช้ label/ค่าเดิมตามปกติ
            title: (items) => {
              if (!items.length) return '';
              const idx = items[0].dataIndex;
              const raw = result.rawTimestamps && result.rawTimestamps[idx];
              if (!raw) return items[0].label;
              const d = new Date(raw.replace(' ', 'T'));
              if (isNaN(d.getTime())) return items[0].label;
              return d.toLocaleString('th-TH', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
            },
            label: (item) => {
              // dataset ระบุหน่วยของตัวเองได้ (เช่น "%" ของเส้นความจุลำน้ำ) ต่างจากหน่วยหลักของกราฟ (unitSuffix)
              const unit = item.dataset.unitSuffix ?? result.unitSuffix;
              const suffix = unit ? ` ${unit}` : '';
              return `${item.dataset.label}: ${item.formattedValue}${suffix}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: CHART_COLORS.textMuted, font: { family: "'Sarabun', sans-serif", size: 11 }, maxRotation: 0, autoSkip: true },
        },
        y: {
          position: 'left',
          grid: { color: CHART_COLORS.grid, drawTicks: false },
          border: { display: false },
          ticks: { color: CHART_COLORS.textMuted, font: { family: "'Sarabun', sans-serif", size: 11 } },
          title: { display: !!result.unitLabel, text: result.unitLabel, color: CHART_COLORS.textMuted, font: { family: "'Sarabun', sans-serif", size: 11 } },
        },
        // แกน y ขวา — สร้างเฉพาะตอนมี dataset ที่ระบุ yAxisID: 'y1' จริงๆ (เช่น เส้น % ความจุลำน้ำของสถานี RID)
        // ไม่งั้นกราฟหน้าอื่นที่ไม่ได้ใช้ก็จะเจอแกนขวาว่างๆ โผล่มาด้วย
        ...(datasets.some((ds) => ds.yAxisID === 'y1') ? {
          y1: {
            position: 'right',
            grid: { display: false },
            border: { display: false },
            min: 0,
            ticks: { color: CHART_COLORS.textMuted, font: { family: "'Sarabun', sans-serif", size: 11 }, callback: (v) => `${v}%` },
            title: { display: !!result.y1Label, text: result.y1Label, color: CHART_COLORS.textMuted, font: { family: "'Sarabun', sans-serif", size: 11 } },
          },
        } : {}),
      },
    },
  });
}

/* ==========================================================
   ดาวน์โหลด/พิมพ์กราฟ — Print / PNG / JPEG / PDF / SVG
   Chart.js วาดลง <canvas> (raster) เท่านั้น ไม่มี vector path จริง — ไฟล์ SVG ที่ได้จึงเป็น SVG ที่ห่อรูป
   raster ไว้ข้างใน (<image> tag) ไม่ใช่ vector path ที่แก้ไขได้ แจ้งผู้ใช้ไว้ในคอมเมนต์นี้เผื่ออนาคตอยากปรับ
   ========================================================== */

function bindChartDownloadMenu() {
  const wrap = document.getElementById('chartDownloadWrap');
  const btn = document.getElementById('chartDownloadBtn');
  const menu = document.getElementById('chartDownloadMenu');
  if (!wrap || !btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(isOpen));
  });

  menu.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('button[data-action]');
    if (!actionBtn) return;
    closeChartDownloadMenu();
    handleChartDownloadAction(actionBtn.dataset.action);
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) closeChartDownloadMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeChartDownloadMenu();
  });
}

function closeChartDownloadMenu() {
  const btn = document.getElementById('chartDownloadBtn');
  const menu = document.getElementById('chartDownloadMenu');
  if (!menu) return;
  menu.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function chartExportFileName() {
  const stationPart = currentChartStation ? currentChartStation.name.replace(/[\\/:*?"<>|]/g, '_') : 'สถานี';
  const periodSelect = document.getElementById('chartPeriodSelect');
  let periodPart;
  if (currentChartPeriod === 'rain_monthly' && periodSelect) {
    periodPart = `${currentChartYear}-${String(currentChartMonth).padStart(2, '0')}`;
  } else if (isDateRangePeriod(currentChartPeriod) || !periodSelect) {
    periodPart = `${currentChartStartDate}_ถึง_${currentChartEndDate}`;
  } else {
    periodPart = currentChartPeriod;
  }
  return `กราฟ_${stationPart}_${periodPart}`;
}

// วาด chart ลง canvas ใหม่พร้อมพื้นหลังทึบ (ธีมเว็บ) เพราะ canvas ของ Chart.js พื้นโปร่งใส
// ถ้าไม่ทำแบบนี้ JPEG จะออกมาพื้นดำ/ขาวแปลกๆ (JPEG ไม่รองรับความโปร่งใส)
function getChartExportCanvas() {
  if (!stationChart) return null;
  const source = stationChart.canvas;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = source.width;
  exportCanvas.height = source.height;
  const ctx = exportCanvas.getContext('2d');
  ctx.fillStyle = CHART_COLORS.surface;
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  ctx.drawImage(source, 0, 0);
  return exportCanvas;
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function handleChartDownloadAction(action) {
  if (!stationChart) {
    setChartStatus('ยังไม่มีกราฟให้ดาวน์โหลด', true);
    return;
  }

  const canvas = getChartExportCanvas();
  const filename = chartExportFileName();

  if (action === 'png') {
    downloadDataUrl(canvas.toDataURL('image/png', 1), `${filename}.png`);
  } else if (action === 'jpeg') {
    downloadDataUrl(canvas.toDataURL('image/jpeg', 0.95), `${filename}.jpg`);
  } else if (action === 'svg') {
    downloadChartAsSvg(canvas, filename);
  } else if (action === 'pdf') {
    downloadChartAsPdf(canvas, filename);
  } else if (action === 'print') {
    printChartImage(canvas);
  }
}

// SVG แบบห่อรูป raster ไว้ข้างใน (ไม่ใช่ vector path จริง เพราะ Chart.js เรนเดอร์ผ่าน canvas เท่านั้น)
function downloadChartAsSvg(canvas, filename) {
  const pngDataUrl = canvas.toDataURL('image/png', 1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
  <image href="${pngDataUrl}" width="${canvas.width}" height="${canvas.height}" />
</svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, `${filename}.svg`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadChartAsPdf(canvas, filename) {
  if (typeof jspdf === 'undefined') {
    setChartStatus('โหลดไลบรารี PDF ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต', true);
    return;
  }
  const isLandscape = canvas.width >= canvas.height;
  const doc = new jspdf.jsPDF({ orientation: isLandscape ? 'landscape' : 'portrait', unit: 'pt' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 24;
  const availW = pageWidth - margin * 2;
  const availH = pageHeight - margin * 2;
  const scale = Math.min(availW / canvas.width, availH / canvas.height);
  const w = canvas.width * scale;
  const h = canvas.height * scale;
  const x = (pageWidth - w) / 2;
  const y = (pageHeight - h) / 2;

  doc.setFillColor(CHART_COLORS.surface);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');
  doc.addImage(canvas.toDataURL('image/png', 1), 'PNG', x, y, w, h);
  doc.save(`${filename}.pdf`);
}

function printChartImage(canvas) {
  const dataUrl = canvas.toDataURL('image/png', 1);
  const title = currentChartStation ? `กราฟสถานี${currentChartStation.name}` : 'กราฟ';
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    setChartStatus('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต popup แล้วลองใหม่', true);
    return;
  }
  printWindow.document.write(`<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8"><title>${title}</title>
<style>
  body { margin: 0; padding: 24px; background: #fff; text-align: center; font-family: sans-serif; }
  h1 { font-size: 16px; margin: 0 0 16px; }
  img { max-width: 100%; }
</style></head>
<body>
  <h1>${title}</h1>
  <img src="${dataUrl}" onload="window.print(); window.onafterprint = () => window.close();">
</body></html>`);
  printWindow.document.close();
}
