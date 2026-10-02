// api/thaiwater/[...path].js
//
// Proxy เดียวครอบคลุมทุก endpoint ของ Thaiwater (สสน.) ที่เว็บนี้เรียกใช้ทั้งหมด
// ไม่ว่าจะเป็น /public/rain_24h, /provinces/rain3d, /public/rain_monthly_graph?station_id=... ฯลฯ
//
// วิธีทำงาน: client เรียก /api/thaiwater/<path>?<query เดิมทุกอย่าง>
// ฟังก์ชันนี้ forward ไป https://api-v3.thaiwater.net/api/v1/thaiwater30/<path>?<query>
// แล้วติด Cache-Control ให้ Vercel Edge CDN เก็บผลลัพธ์ไว้ "ใช้ร่วมกันทุกคนที่เข้าเว็บ"
// ไม่ว่าจะมีกี่คนเปิดพร้อมกัน ฝั่งเราจะยิงไป Thaiwater จริงแค่ครั้งเดียวต่อ path+query ทุก 5 นาที
//
// สำคัญ: นี่คือเหตุผลที่ client ฝั่ง main.js/waterlevel-main.js แทบไม่ต้องแก้อะไรเลย
// นอกจากเปลี่ยนค่าคงที่ THAIWATER_BASE ให้ชี้มาที่ '/api/thaiwater' แทน URL จริงของ Thaiwater

const THAIWATER_UPSTREAM = 'https://api-v3.thaiwater.net/api/v1/thaiwater30';

module.exports = async (req, res) => {
  const { path, ...restQuery } = req.query;

  if (!path) {
    res.status(400).json({ error: 'ไม่ได้ระบุ path ของ Thaiwater API' });
    return;
  }

  const subPath = Array.isArray(path) ? path.join('/') : path;
  const qs = new URLSearchParams(restQuery).toString();
  const upstreamUrl = `${THAIWATER_UPSTREAM}/${subPath}${qs ? `?${qs}` : ''}`;

  try {
    const upstreamRes = await fetch(upstreamUrl);

    if (!upstreamRes.ok) {
      res.status(upstreamRes.status).json({
        error: `Thaiwater API ตอบกลับ HTTP ${upstreamRes.status}`,
        upstreamUrl, // ช่วย debug — ลบออกได้ถ้าไม่อยากโชว์ URL จริงต่อสาธารณะ
      });
      return;
    }

    const data = await upstreamRes.json();

    // s-maxage = cache ฝั่ง Vercel Edge (ใช้ร่วมกันทุก visitor) อยู่ 300 วิ (5 นาที)
    // stale-while-revalidate = ระหว่างรอข้อมูลใหม่ ยังเสิร์ฟของเก่าไปก่อนได้ 60 วิ ไม่ให้ผู้ใช้รอ
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: 'เรียก Thaiwater API ไม่สำเร็จ: ' + err.message });
  }
};