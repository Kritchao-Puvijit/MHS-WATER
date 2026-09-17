/* ==========================================================
   i18n.js — สลับภาษา TH/EN สำหรับเว็บ MHS Water
   โหลดเป็น script แรกสุดในทั้งสองหน้า (index.html / waterlevel.html)
   ก่อน leaflet/chart.js/map.js/main.js เพราะไฟล์อื่นเรียก t()/getLang()/
   thaiToRoman() ตอน render — ฟังก์ชันพวกนี้ต้องถูกประกาศไว้ก่อนแล้ว
   ========================================================== */

const LANG_STORAGE_KEY = 'mhsWaterLang';

function getLang() {
  return localStorage.getItem(LANG_STORAGE_KEY) === 'en' ? 'en' : 'th';
}

// เปลี่ยนภาษาแบบไม่รีเฟรชหน้า — ไม่ต้องดึงข้อมูลสถานีใหม่จาก API ซ้ำ (ของเดิมที่โหลดไว้แล้วยังใช้ได้)
// แค่ re-render ทุกจุดที่มีข้อความด้วยภาษาใหม่: ข้อความ static (data-i18n) + ให้แต่ละหน้า
// ประกาศ window.onLanguageChange ไว้เอง (main.js / waterlevel-main.js) สำหรับ re-render ส่วนที่เป็น
// dynamic (ตาราง/แผนที่/legend/dropdown) จากข้อมูลที่ cache ไว้ใน allStations อยู่แล้ว
function setLang(lang) {
  localStorage.setItem(LANG_STORAGE_KEY, lang === 'en' ? 'en' : 'th');
  applyStaticTranslations();
  updateLangToggleUI();
  if (typeof window.onLanguageChange === 'function') window.onLanguageChange();
}

function updateLangToggleUI() {
  const buttons = document.querySelectorAll('.lang-toggle-btn');
  const lang = getLang();
  buttons.forEach((btn) => {
    const isActive = btn.textContent.trim().toLowerCase() === lang;
    btn.classList.toggle('active', isActive);
  });
}

/* ---------------- Dictionary ---------------- */
// คำศัพท์เรียบง่าย อ่านง่าย ไม่ทางการจ๋า ตามที่ผู้ใช้ขอ
const I18N = {
  th: {
    // Header / nav
    'nav.rain': 'น้ำฝน',
    'nav.waterlevel': 'ระดับน้ำ',
    'brand.subtitle.rain': 'ระบบเฝ้าระวังและติดตามปริมาณน้ำฝน',
    'brand.subtitle.water': 'ระบบเฝ้าระวังและติดตามระดับน้ำ',
    'clock.label': 'เวลาปัจจุบัน',

    // Hero
    'hero.line1.rain': 'รายงานสถานการณ์',
    'hero.line1b.rain': 'ปริมาณน้ำฝน',
    'hero.line1.water': 'รายงานสถานการณ์',
    'hero.line1b.water': 'ระดับน้ำ',
    'hero.line2': 'จังหวัดแม่ฮ่องสอน',
    'hero.source.rain': 'ข้อมูลปริมาณน้ำฝนจากคลังข้อมูลน้ำแห่งชาติ (สสน.)',
    'hero.source.water': 'ข้อมูลระดับน้ำจากคลังข้อมูลน้ำแห่งชาติ (สสน.)',

    // Rain extremes
    'extremes.min': '🔵 ฝนน้อยสุด',
    'extremes.max': '🔴 ฝนมากสุด',
    'extremes.noData': 'ไม่พบข้อมูล',
    'unit.mm': 'มม.',
    'unit.msl': 'ม.รทก.',
    'unit.meter': 'ม.',
    'gps.notSupported': 'เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง',
    'gps.errorGeneric': 'ไม่สามารถระบุตำแหน่งได้',
    'gps.errorDenied': 'ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง',
    'gps.errorUnavailable': 'ไม่สามารถระบุตำแหน่งปัจจุบันได้',
    'gps.errorTimeout': 'หมดเวลาในการค้นหาตำแหน่ง',

    // Status bar (rain)
    'status.total': 'สถานีทั้งหมด',
    'status.rain.normal': 'ฝนตกเล็กน้อย',
    'status.rain.watch': 'ฝนตกปานกลาง',
    'status.rain.warning': 'ฝนตกหนัก',
    'status.rain.critical': 'ฝนตกหนักมาก',
    // Status bar (water level)
    'status.water.criticalLow': 'น้อยวิกฤต',
    'status.water.low': 'น้อย',
    'status.water.normal': 'ปกติ',
    'status.water.high': 'มาก',
    'status.water.overflow': 'ล้นตลิ่ง',
    'status.unknown': 'ไม่มีข้อมูล',

    // Map panel
    'map.title.rain': 'แผนที่แสดงปริมาณน้ำฝน',
    'map.title.water': 'แผนที่แสดงระดับน้ำ',
    'map.hint': 'คลิกจุดสถานีเพื่อดูรายละเอียด',

    // Filters
    'filter.period': 'ช่วงเวลา',
    'filter.district': 'อำเภอ',
    'filter.allDistrict': 'ทุกอำเภอ',
    'filter.tambon': 'ตำบล',
    'filter.allTambon': 'ทุกตำบล',
    'filter.agency': 'หน่วยงาน',
    'filter.allAgency': 'ทุกหน่วยงาน',
    'period.24h': '24 ชั่วโมง',
    'period.today': 'ฝนวันนี้',
    'period.yesterday': 'ฝนวานนี้',
    'period.3d': '3 วัน',
    'period.5d': '5 วัน',
    'period.7d': '7 วัน',
    'period.15d': '15 วัน',
    'period.monthly': 'รายเดือน',
    'period.yearly': 'รายปี',
    'period.hint': 'แสดงข้อมูล ณ 24 ชั่วโมงล่าสุด จากคลังข้อมูลน้ำแห่งชาติ (สสน.)',

    // Table
    'table.title.rain': 'ข้อมูลปริมาณฝนล่าสุด',
    'table.title.water': 'ข้อมูลระดับน้ำล่าสุด',
    'table.hint': 'แสดงค่าล่าสุดจากทุกสถานี เรียงตามเวลาล่าสุด',
    'table.found': 'พบ',
    'table.items': 'รายการ',
    'table.search.placeholder': 'ค้นหาสถานี ตำบล หรืออำเภอ',
    'table.allStatus': 'ทุกสถานะ',
    'table.col.station': 'สถานี',
    'table.col.tambon': 'ตำบล',
    'table.col.district': 'อำเภอ',
    'table.col.rainfall': 'ปริมาณฝน (มม.)',
    'table.col.waterlevel': 'ระดับน้ำ (ม.)',
    'table.col.capacity': 'ความจุลำน้ำ (%)',
    'table.col.status': 'สถานะ',
    'table.col.time': 'เวลาข้อมูล',
    'table.col.chart': 'กราฟ',
    'table.loading': 'กำลังโหลดข้อมูล...',
    'table.noData': 'ไม่พบข้อมูล',

    // Chart modal
    'chart.title.rain': 'กราฟฝนสถานี',
    'chart.title.water': 'กราฟระดับน้ำสถานี',
    'chart.close': 'ปิด',
    'chart.periodLabel': 'ประเภทข้อมูล',
    'chart.monthLabel': 'เดือน',
    'chart.yearLabel': 'ปี',
    'chart.startDate': 'วันที่เริ่มต้น',
    'chart.endDate': 'วันที่สิ้นสุด',
    'chart.opt.24h': 'ฝน 24 ชั่วโมง',
    'chart.opt.today': 'ฝนวันนี้',
    'chart.opt.yesterday': 'ฝนเมื่อวาน',
    'chart.opt.3d': 'ฝน 3 วัน',
    'chart.opt.5d': 'ฝน 5 วัน',
    'chart.opt.7d': 'ฝน 7 วัน',
    'chart.opt.15d': 'ฝน 15 วัน',
    'chart.opt.monthly': 'ฝนรายเดือน',
    'chart.opt.yearly': 'ฝนรายปี',

    // Footer
    'footer.developedBy': 'พัฒนาโดย โครงการชลประทานแม่ฮ่องสอน สำนักงานชลประทานที่ 1 กรมชลประทาน',
    'footer.disclaimer': 'ข้อมูลเพื่อการเฝ้าระวัง โปรดติดตามประกาศจากหน่วยงานภาครัฐ',

    // Map popups / legend / dynamic labels
    'popup.station': 'สถานี',
    'popup.tambon': 'ตำบล',
    'popup.district': 'อำเภอ',
    'popup.rainfall': 'ปริมาณฝน',
    'popup.waterlevel': 'ระดับน้ำ',
    'popup.capacity': 'ความจุลำน้ำ',
    'popup.river': 'แม่น้ำ/ลำน้ำ',
    'popup.status': 'สถานะ',
    'popup.band': 'ช่วงเกณฑ์',
    'popup.time': 'เวลา',
    'popup.agency': 'หน่วยงาน',
    'popup.viewChart': '📈 ดูกราฟย้อนหลัง',
    'gps.title': 'ตำแหน่งปัจจุบัน',
    'fullscreen.enter': 'ขยายแผนที่เต็มจอ',
    'fullscreen.exit': 'ออกจากเต็มจอ',
    'fullscreen.toggle': 'สลับโหมดเต็มจอ',
    'layer.idw': 'IDW ปริมาณฝน (Interpolation)',
    'layer.radar': 'เรดาร์ฝน (RainViewer)',
    'layer.rainStations': 'สถานีตรวจวัดน้ำฝน',
    'layer.waterStations': 'สถานีตรวจวัดระดับน้ำ',
    'layer.district': 'ขอบเขตอำเภอ',
    'layer.tambon': 'ขอบเขตตำบล',
    'layer.village': 'ขอบเขตหมู่บ้าน',
    'layer.roadmap': 'แผนที่ถนน',
    'layer.satellite': 'ภาพถ่ายดาวเทียม',
    'layer.terrain': 'แผนที่ภูมิประเทศ',
    'radar.toggle': 'เล่น/หยุดเรดาร์ฝน',
    'radar.slider': 'เลื่อนช่วงเวลาเรดาร์ฝน',
    'idw.opacityTitle': 'ความโปร่งใสชั้นข้อมูล IDW',
    'idw.opacityAria': 'ปรับความโปร่งใสชั้นข้อมูล IDW',
    'legend.show': 'แสดงคำอธิบายสัญลักษณ์',
    'legend.hide': 'ยุบคำอธิบายสัญลักษณ์',
    'legend.label': 'คำอธิบายสัญลักษณ์',
    'legend.toggleAria': 'ยุบ/แสดงคำอธิบายสัญลักษณ์',
    'filterPanel.show': 'แสดงตัวกรอง',
    'filterPanel.hide': 'ยุบตัวกรอง',
    'filterPanel.label': 'ตัวกรอง',
    'filterPanel.toggleAria': 'ยุบ/แสดงตัวกรอง',
    'filter.search': 'ค้นหา',
    'tablePanel.show': 'แสดงตารางข้อมูล',
    'tablePanel.hide': 'ยุบตารางข้อมูล',
    'tablePanel.label': 'ตารางข้อมูล',
    'tablePanel.toggleAria': 'ยุบ/แสดงตารางข้อมูล',
    'chart.download': '⬇ ดาวน์โหลด',
    'chart.rainfallUnit': 'ปริมาณฝน (มม.)',
    'chart.rainDaily': 'ปริมาณฝนรายวัน',
    'chart.rainCumulative': 'สะสม',
    'chart.rainAccum': 'ปริมาณฝนสะสม',
    'chart.rainHourly24h': 'ปริมาณฝนรายชั่วโมง (24 ชม.)',
    'chart.rainHourlyYesterday': 'ปริมาณฝนรายชั่วโมง (เมื่อวาน)',
    'chart.rainHourlyToday': 'ปริมาณฝนรายชั่วโมง (วันนี้)',
    'chart.rainAccumToday': 'ปริมาณฝนสะสมวันนี้',
    'chart.rainMonthlyBar': 'ปริมาณฝนรายเดือน',
    'chart.rainAccumYearly': 'ปริมาณฝนสะสมรายปี',
    'chart.waterlevel': 'ระดับน้ำ',
    'chart.bankLevel': 'ระดับตลิ่ง',
    'chart.bankLevelMin': 'ระดับตลิ่งต่ำสุด',
    'chart.capacityPercent': 'ความจุลำน้ำ (%)',
    'chart.noData': 'ไม่มีข้อมูลย้อนหลังสำหรับสถานีนี้ในช่วงเวลาที่เลือก',
    'chart.loadFailed': 'โหลดข้อมูลกราฟไม่สำเร็จ',
  },
  en: {
    'nav.rain': 'Rain',
    'nav.waterlevel': 'Water Level',
    'brand.subtitle.rain': 'Rainfall Monitoring System',
    'brand.subtitle.water': 'Water Level Monitoring System',
    'clock.label': 'Current Time',

    'hero.line1.rain': 'Rainfall Report',
    'hero.line1b.rain': '',
    'hero.line1.water': 'Water Level Report',
    'hero.line1b.water': '',
    'hero.line2': 'Mae Hong Son Province',
    'hero.source.rain': 'Rainfall data from the National Hydroinformatics Data Center (HII)',
    'hero.source.water': 'Water level data from the National Hydroinformatics Data Center (HII)',

    'extremes.min': '🔵 Lowest Rainfall',
    'extremes.max': '🔴 Highest Rainfall',
    'extremes.noData': 'No data',
    'unit.mm': 'mm',
    'unit.msl': 'MSL',
    'unit.meter': 'm',
    'gps.notSupported': 'This browser does not support geolocation',
    'gps.errorGeneric': 'Unable to determine location',
    'gps.errorDenied': 'Location access denied',
    'gps.errorUnavailable': 'Current location unavailable',
    'gps.errorTimeout': 'Location request timed out',

    'status.total': 'All Stations',
    'status.rain.normal': 'Light Rain',
    'status.rain.watch': 'Moderate Rain',
    'status.rain.warning': 'Heavy Rain',
    'status.rain.critical': 'Very Heavy Rain',
    'status.water.criticalLow': 'Critically Low',
    'status.water.low': 'Low',
    'status.water.normal': 'Normal',
    'status.water.high': 'High',
    'status.water.overflow': 'Overflowing',
    'status.unknown': 'No Data',

    'map.title.rain': 'Rainfall Map',
    'map.title.water': 'Water Level Map',
    'map.hint': 'Click a station point for details',

    'filter.period': 'Period',
    'filter.district': 'District',
    'filter.allDistrict': 'All Districts',
    'filter.tambon': 'Sub-district',
    'filter.allTambon': 'All Sub-districts',
    'filter.agency': 'Agency',
    'filter.allAgency': 'All Agencies',
    'period.24h': '24 Hours',
    'period.today': 'Today',
    'period.yesterday': 'Yesterday',
    'period.3d': '3 Days',
    'period.5d': '5 Days',
    'period.7d': '7 Days',
    'period.15d': '15 Days',
    'period.monthly': 'Monthly',
    'period.yearly': 'Yearly',
    'period.hint': 'Showing the latest 24-hour data from the National Hydroinformatics Data Center (HII)',

    'table.title.rain': 'Latest Rainfall Data',
    'table.title.water': 'Latest Water Level Data',
    'table.hint': 'Latest values from all stations, sorted by most recent',
    'table.found': 'Found',
    'table.items': 'stations',
    'table.search.placeholder': 'Search station, sub-district or district',
    'table.allStatus': 'All Statuses',
    'table.col.station': 'Station',
    'table.col.tambon': 'Sub-district',
    'table.col.district': 'District',
    'table.col.rainfall': 'Rainfall (mm)',
    'table.col.waterlevel': 'Water Level (m)',
    'table.col.capacity': 'Channel Capacity (%)',
    'table.col.status': 'Status',
    'table.col.time': 'Time',
    'table.col.chart': 'Chart',
    'table.loading': 'Loading data...',
    'table.noData': 'No data found',

    'chart.title.rain': 'Rainfall Chart —',
    'chart.title.water': 'Water Level Chart —',
    'chart.close': 'Close',
    'chart.periodLabel': 'Data Type',
    'chart.monthLabel': 'Month',
    'chart.yearLabel': 'Year',
    'chart.startDate': 'Start Date',
    'chart.endDate': 'End Date',
    'chart.opt.24h': '24-Hour Rain',
    'chart.opt.today': "Today's Rain",
    'chart.opt.yesterday': "Yesterday's Rain",
    'chart.opt.3d': '3-Day Rain',
    'chart.opt.5d': '5-Day Rain',
    'chart.opt.7d': '7-Day Rain',
    'chart.opt.15d': '15-Day Rain',
    'chart.opt.monthly': 'Monthly Rain',
    'chart.opt.yearly': 'Yearly Rain',

    'footer.developedBy': 'Developed by the Mae Hong Son Irrigation Project, Irrigation Office 1, Royal Irrigation Department',
    'footer.disclaimer': 'For monitoring purposes only — please follow official government announcements',

    'popup.station': 'Station',
    'popup.tambon': 'Sub-district',
    'popup.district': 'District',
    'popup.rainfall': 'Rainfall',
    'popup.waterlevel': 'Water Level',
    'popup.capacity': 'Channel Capacity',
    'popup.river': 'River/Canal',
    'popup.status': 'Status',
    'popup.band': 'Range',
    'popup.time': 'Time',
    'popup.agency': 'Agency',
    'popup.viewChart': '📈 View History',
    'gps.title': 'Current Location',
    'fullscreen.enter': 'Enter Fullscreen',
    'fullscreen.exit': 'Exit Fullscreen',
    'fullscreen.toggle': 'Toggle Fullscreen',
    'layer.idw': 'IDW Rainfall (Interpolation)',
    'layer.radar': 'Rain Radar (RainViewer)',
    'layer.rainStations': 'Rainfall Stations',
    'layer.waterStations': 'Water Level Stations',
    'layer.district': 'District Boundary',
    'layer.tambon': 'Sub-district Boundary',
    'layer.village': 'Village Boundary',
    'layer.roadmap': 'Road Map',
    'layer.satellite': 'Satellite',
    'layer.terrain': 'Terrain',
    'radar.toggle': 'Play/Pause Rain Radar',
    'radar.slider': 'Rain Radar Time Slider',
    'idw.opacityTitle': 'IDW Layer Opacity',
    'idw.opacityAria': 'Adjust IDW Layer Opacity',
    'legend.show': 'Show Legend',
    'legend.hide': 'Hide Legend',
    'legend.label': 'Legend',
    'legend.toggleAria': 'Toggle Legend',
    'filterPanel.show': 'Show Filters',
    'filterPanel.hide': 'Hide Filters',
    'filterPanel.label': 'Filters',
    'filterPanel.toggleAria': 'Toggle Filters',
    'filter.search': 'Search',
    'tablePanel.show': 'Show Table',
    'tablePanel.hide': 'Hide Table',
    'tablePanel.label': 'Data Table',
    'tablePanel.toggleAria': 'Toggle Table',
    'chart.download': '⬇ Download',
    'chart.rainfallUnit': 'Rainfall (mm)',
    'chart.rainDaily': 'Daily Rainfall',
    'chart.rainCumulative': 'Cumulative',
    'chart.rainAccum': 'Cumulative Rainfall',
    'chart.rainHourly24h': 'Hourly Rainfall (24h)',
    'chart.rainHourlyYesterday': 'Hourly Rainfall (Yesterday)',
    'chart.rainHourlyToday': 'Hourly Rainfall (Today)',
    'chart.rainAccumToday': "Today's Cumulative Rainfall",
    'chart.rainMonthlyBar': 'Monthly Rainfall',
    'chart.rainAccumYearly': 'Yearly Cumulative Rainfall',
    'chart.waterlevel': 'Water Level',
    'chart.bankLevel': 'Bank Level',
    'chart.bankLevelMin': 'Minimum Bank Level',
    'chart.capacityPercent': 'Channel Capacity (%)',
    'chart.noData': 'No historical data for this station in the selected period',
    'chart.loadFailed': 'Failed to load chart data',
  },
};

function t(key) {
  const lang = getLang();
  const dict = I18N[lang] || I18N.th;
  if (dict[key] !== undefined) return dict[key];
  return I18N.th[key] !== undefined ? I18N.th[key] : key;
}

// เดือนไทย/อังกฤษ — ใช้แทน THAI_MONTHS เดิมใน station-chart.js
const MONTH_NAMES = {
  th: ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
function monthName(index) {
  return (MONTH_NAMES[getLang()] || MONTH_NAMES.th)[index];
}

/* ---------------- Thai place-name → Roman (approximate, readable) ---------------- */
// ไม่ใช่ RTGS มาตรฐานเป๊ะ 100% แต่เน้นอ่านง่าย ถูกแกรมม่าโรมันพื้นฐาน ตามที่ขอ
// ขั้นตอน: 1) คำศัพท์สถานที่ที่พบบ่อยแทนทั้งคำก่อน (แม่นยำกว่า)
//         2) ที่เหลือแทนทีละพยางค์ด้วยตารางเสียง+พยัญชนะแบบง่าย
const TH_PLACE_WORDS = [
  ['จังหวัด', 'Changwat'], ['อำเภอ', 'Amphoe'], ['ตำบล', 'Tambon'], ['หมู่บ้าน', 'Ban'],
  ['จ.', 'Changwat'], ['อ.', 'Amphoe'], ['ต.', 'Tambon'], // ตัวย่อที่ใช้ในไฟล์ GeoJSON ขอบเขต
  ['บ้าน', 'Ban'], ['เมือง', 'Mueang'], ['ห้วย', 'Huai'], ['แม่น้ำ', 'Maenam'], ['แม่', 'Mae'],
  ['ดอย', 'Doi'], ['ผา', 'Pha'], ['น้ำ', 'Nam'], ['ปาง', 'Pang'], ['ทุ่ง', 'Thung'],
  ['หนอง', 'Nong'], ['สบ', 'Sop'], ['ป่า', 'Pa'], ['ขุนยวม', 'Khun Yuam'], ['ขุน', 'Khun'],
  ['แก่ง', 'Kaeng'], ['ท่า', 'Tha'], ['โป่งแดง', 'Pong Daeng'], ['โป่ง', 'Pong'],
  ['สองแคว', 'Song Khwae'], ['กาศ', 'Kat'], ['ปาย', 'Pai'], ['ลาน้อย', 'La Noi'],
  ['ลาหลวง', 'La Luang'], ['สะเรียง', 'Sariang'], ['สา', 'Sa'], ['พะมอลอ', 'Phamolo'],
  ['ตะควน', 'Takhuan'], ['ปางมะผ้า', 'Pang Mapha'], ['หมู', 'Mu'], ['เวียงใต้', 'Wiang Tai'],
  ['เวียงเหนือ', 'Wiang Nuea'], ['ผาบ่อง', 'Pha Bong'], ['หมอกจำแป่', 'Mok Champae'],
  ['ห้วยผา', 'Huai Pha'], ['ห้วยปูลิง', 'Huai Puling'], ['ห้วยโป่ง', 'Huai Pong'],
  ['จองคำ', 'Chong Kham'], ['สอง', 'Song'], ['ยวม', 'Yuam'], ['ปางตอง', 'Pang Tong'],
  ['ไก่ป่า', 'Kai Pa'], ['แปง', 'Paeng'], ['ของ', 'Khong'], ['เมย', 'Moei'],
  // ชื่อเฉพาะที่ยืนยันตัวสะกดทางการจากแหล่งข้อมูลจริงแล้ว (Wikipedia/Britannica) ไม่ได้เดาทับศัพท์
  ['แม่สุรินทร์', 'Mae Surin'], ['ถ้ำลอด', 'Tham Lot'], ['ถ้ำ', 'Tham'], ['สาละวิน', 'Salween'],
];

// คำ/วลีที่ควร "แปลความหมาย" จริงๆ ไม่ใช่ทับศัพท์ (ชื่อหน่วยงาน/สถานที่ราชการ ไม่ใช่ชื่อเฉพาะ)
// เรียงยาวไปสั้นตอน matching เหมือนกับ TH_PLACE_WORDS (วลีที่จำเพาะกว่าต้องจับคู่ก่อนคำย่อย)
const TH_TRANSLATE_WORDS = [
  ['หน่วยพิทักษ์อุทยานแห่งชาติที่', 'National Park Protection Unit'],
  ['หน่วยจัดการต้นน้ำและพัฒนาชุมชนในพื้นที่ป่าอนุรักษ์', 'Watershed Management and Community Development Unit'],
  ['ที่ทำการเขตรักษาพันธุ์สัตว์ป่า', 'Wildlife Sanctuary Office'],
  ['เขตรักษาพันธุ์สัตว์ป่า', 'Wildlife Sanctuary'],
  ['ที่ทำการอุทยานแห่งชาติ', 'National Park Office'],
  ['อุทยานแห่งชาติ', 'National Park'],
  ['โครงการพัฒนาราษฎรชาวไทยภูเขา', 'Hill Tribe Development Project'],
  ['องค์การบริหารส่วนตำบล', 'Sub-district Administrative Organization'],
  ['อบต.', 'SAO'],
  ['หลังอาคารกองร้อย อส.', 'Behind the Volunteer Defense Corps Building'],
  ['วนอุทยาน', 'Forest Park'],
  ['น้ำตก', 'Waterfall'],
  ['ที่ทำการ', 'Office'],
  ['หมู่', 'Moo'],
  ['วัด', 'Wat'],
];

function romanizeWord(word) {
  // ตารางแทนที่แบบ greedy (เรียงยาวไปสั้น) — สระ/พยัญชนะไทยพื้นฐานที่พบบ่อยในชื่อสถานที่
  const RULES = [
    // สระประสม/พิเศษ (ต้องมาก่อนสระเดี่ยว)
    ['เอือ', 'uea'], ['เอีย', 'ia'], ['เอา', 'ao'], ['ัวะ', 'ua'], ['ัว', 'ua'],
    ['ะ', 'a'], ['ำ', 'am'], ['ไ', 'ai'], ['ใ', 'ai'],
    ['เอะ', 'e'], ['แอะ', 'ae'], ['โอะ', 'o'],
    ['เ', 'e'], ['แ', 'ae'], ['โ', 'o'],
    ['ื', 'ue'], ['ุ', 'u'], ['ู', 'u'], ['ิ', 'i'], ['ี', 'i'], ['ึ', 'ue'],
    ['า', 'a'], ['ั', 'a'], ['อ', 'o'],
    // พยัญชนะต้น
    ['ข', 'kh'], ['ค', 'kh'], ['ฆ', 'kh'], ['ก', 'k'],
    ['ฉ', 'ch'], ['ช', 'ch'], ['ฌ', 'ch'], ['จ', 'ch'],
    ['ศ', 's'], ['ษ', 's'], ['ส', 's'], ['ซ', 's'],
    ['ญ', 'y'], ['ย', 'y'],
    ['ฎ', 'd'], ['ด', 'd'], ['ฏ', 't'], ['ต', 't'],
    ['ฐ', 'th'], ['ถ', 'th'], ['ฑ', 'th'], ['ฒ', 'th'], ['ท', 'th'], ['ธ', 'th'],
    ['ณ', 'n'], ['น', 'n'], ['บ', 'b'], ['ป', 'p'],
    ['ผ', 'ph'], ['พ', 'ph'], ['ภ', 'ph'], ['ฝ', 'f'], ['ฟ', 'f'],
    ['ม', 'm'], ['ร', 'r'], ['ล', 'l'], ['ฬ', 'l'], ['ว', 'w'],
    ['ห', 'h'], ['ฮ', 'h'], ['ง', 'ng'],
    // วรรณยุกต์/เครื่องหมาย — RTGS ไม่สนใจวรรณยุกต์ ตัดทิ้ง
    ['่', ''], ['้', ''], ['๊', ''], ['๋', ''], ['ๆ', ''], ['ฯ', ''],
  ];

  // ์ (การันต์) ทำให้ตัวอักษรก่อนหน้าเป็นใบ้ — ตัดตัวอักษรก่อนหน้า + ตัว ์ ทิ้งทั้งคู่
  let cleaned = word.replace(/.์/g, '');

  // แบ่งพยางค์คร่าวๆ: สระนำ (เ แ โ ใ ไ) ในภาษาไทยเขียนไว้หน้าพยัญชนะต้นของพยางค์ใหม่เสมอ
  // ใส่ช่องว่างก่อนตัวอักษรพวกนี้ (ยกเว้นตัวแรกสุด) เพื่อกันคำยาวๆ ถูกแปลงเป็นตัวหนังสือรวดยาวอ่านไม่ออก
  cleaned = cleaned.replace(/(.)([เแโใไ])/g, '$1 $2');

  let out = '';
  let i = 0;
  while (i < cleaned.length) {
    if (cleaned[i] === ' ') { out += ' '; i += 1; continue; }
    let matched = false;
    for (const [pattern, roman] of RULES) {
      if (cleaned.startsWith(pattern, i)) {
        out += roman;
        i += pattern.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += cleaned[i]; // ตัวอักษรที่ไม่ใช่ไทย (เช่น ตัวเลข/อังกฤษ/ช่องว่าง) ผ่านตรงๆ
      i += 1;
    }
  }
  return out;
}

// Capitalize คำแรกของแต่ละคำ ให้ดูเป็นชื่อเฉพาะ
function capitalizeWords(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

const _romanCache = {};
function thaiToRoman(str) {
  if (!str || typeof str !== 'string') return str;
  if (!/[฀-๿]/.test(str)) return str; // ไม่มีอักษรไทยเลย ส่งกลับตรงๆ (เช่นชื่อเป็น EN อยู่แล้ว)
  if (_romanCache[str]) return _romanCache[str];

  let remaining = str;
  let result = '';

  // แทนคำศัพท์สถานที่ที่รู้จักก่อน (เรียงยาวไปสั้น กันคำสั้นไปกินคำยาว)
  const sortedWords = TH_TRANSLATE_WORDS.concat(TH_PLACE_WORDS).sort((a, b) => b[0].length - a[0].length);
  while (remaining.length > 0) {
    let matchedWord = null;
    for (const [th, en] of sortedWords) {
      if (remaining.startsWith(th)) {
        matchedWord = [th, en];
        break;
      }
    }
    if (matchedWord) {
      result += (result && !result.endsWith(' ') ? ' ' : '') + matchedWord[1];
      remaining = remaining.slice(matchedWord[0].length);
    } else {
      // หาความยาว "คำไทยที่เหลือ" ไปจนกว่าจะเจอคำศัพท์ที่รู้จักตัวถัดไป หรือจบสตริง แล้วแปลงทีละพยางค์
      let nextCut = remaining.length;
      for (const [th] of sortedWords) {
        const idx = remaining.indexOf(th, 1);
        if (idx !== -1 && idx < nextCut) nextCut = idx;
      }
      const chunk = remaining.slice(0, nextCut);
      const roman = capitalizeWords(romanizeWord(chunk).trim());
      if (roman) result += (result && !result.endsWith(' ') ? ' ' : '') + roman;
      remaining = remaining.slice(nextCut);
    }
  }

  const final = result.trim().replace(/\s+/g, ' ');
  _romanCache[str] = final;
  return final;
}

// สลับข้อความ th↔en ตามภาษาปัจจุบัน — ใช้ตรงๆ ตอนแสดงชื่อสถานที่ (ถ้า EN → romanize, TH → คืนค่าเดิม)
function localizeName(thaiName) {
  return getLang() === 'en' ? thaiToRoman(thaiName) : thaiName;
}

// ชื่อหน่วยงาน — ไม่ใช่ชื่อเฉพาะ (proper name) จึงต้อง "แปล" เป็นชื่อทางการภาษาอังกฤษจริงๆ
// ไม่ใช่ทับศัพท์เหมือนชื่อสถานที่ — รายชื่อนี้เป็นชุดคงที่ (หน่วยงานที่ให้ข้อมูลใน Thaiwater API ทั้งหมด)
const AGENCY_TRANSLATE = {
  'กรมชลประทาน': 'Royal Irrigation Department',
  'กรมทรัพยากรน้ำ': 'Department of Water Resources',
  'กรมอุตุนิยมวิทยา': 'Thai Meteorological Department',
  'กรมป้องกันและบรรเทาสาธารณภัย': 'Department of Disaster Prevention and Mitigation',
  'สถาบันสารสนเทศทรัพยากรน้ำ (องค์การมหาชน)': 'Hydro-Informatics Institute (Public Organization)',
  'มูลนิธิอาสาเพื่อนพึ่ง (ภาฯ) ยามยาก สภากาชาดไทย': 'Thai Red Cross Society — Friends in Need (of "PA") Volunteers Foundation',
};

function localizeAgency(name) {
  if (getLang() !== 'en' || !name) return name;
  const trimmed = name.trim();
  return AGENCY_TRANSLATE[trimmed] || name;
}

/* ---------------- Apply translations to static HTML ---------------- */
function applyStaticTranslations() {
  document.documentElement.setAttribute('lang', getLang()); // ให้ CSS ::before (หัวข้อกลุ่มใน layer control) สลับภาษาตามได้
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.setAttribute('placeholder', t(key));
  });
}

/* ---------------- Language toggle button ---------------- */
function createLangToggle() {
  const nav = document.querySelector('.header-nav');
  if (!nav) return;

  const wrap = document.createElement('div');
  wrap.className = 'lang-toggle';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Switch language / สลับภาษา');

  const lang = getLang();
  const thBtn = document.createElement('button');
  thBtn.type = 'button';
  thBtn.className = 'lang-toggle-btn' + (lang === 'th' ? ' active' : '');
  thBtn.textContent = 'TH';

  const enBtn = document.createElement('button');
  enBtn.type = 'button';
  enBtn.className = 'lang-toggle-btn' + (lang === 'en' ? ' active' : '');
  enBtn.textContent = 'EN';

  thBtn.addEventListener('click', () => { if (getLang() !== 'th') setLang('th'); });
  enBtn.addEventListener('click', () => { if (getLang() !== 'en') setLang('en'); });

  wrap.appendChild(thBtn);
  wrap.appendChild(enBtn);
  nav.appendChild(wrap);
}

document.addEventListener('DOMContentLoaded', () => {
  applyStaticTranslations();
  createLangToggle();
});
