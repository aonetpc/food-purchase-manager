const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

const ROOM_TYPES = [
  { name: '【稻香楼】标准大床房', price: 1118 },
  { name: '【稻香楼】标准双床房', price: 1118 },
  { name: '【稻香楼】稻香山林大床房', price: 1118 },
  { name: '【稻香楼】稻香山林双床房', price: 1118 },
  { name: '【蝉鸣院】单人房', price: 1500 },
  { name: '【蝉鸣院】标准大床房', price: 1500 },
  { name: '【蝉鸣院】大床房', price: 1680 },
  { name: '【蝉鸣院】双床房', price: 1680 },
  { name: '【蝉鸣院】大床房带露台', price: 1780 },
  { name: '【蝉鸣院】行政双床套房', price: 1780 },
  { name: '【蝉鸣院】多床家庭套房', price: 2380 },
  { name: '竹風别墅大床房', price: 2880 },
  { name: '竹風临湖别墅大床房', price: 3380 },
  { name: '竹風别墅多床房', price: 3580 },
  { name: '竹風临湖别墅多床房', price: 4080 },
  { name: '湖畔别墅', price: 11888 },
];

async function seedRoomTypes() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'food_purchase',
    password: process.env.DB_PASSWORD || 'food_purchase123',
    database: process.env.DB_NAME || 'food_purchase',
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
    dateStrings: true,
    timezone: '+08:00',
  });

  try {
    console.log('=== 房型数据导入 ===\n');

    const [existing] = await pool.query(
      "SELECT code, name FROM booking_room_types ORDER BY sort_order ASC, id ASC"
    );

    const existingCodes = new Set(existing.map(r => r.code));
    const existingNames = new Set(existing.map(r => r.name));

    console.log(`现有房型 ${existing.length} 条：`);
    existing.forEach(r => console.log(`  ${r.code} - ${r.name}`));

    // 计算 RM 前缀的下一个序号
    let maxRmNum = 0;
    existing.forEach(r => {
      const m = (r.code || '').match(/^RM(\d+)$/);
      if (m) maxRmNum = Math.max(maxRmNum, parseInt(m[1], 10));
    });

    console.log(`\n现有 RM 最大序号: ${maxRmNum}`);

    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < ROOM_TYPES.length; i++) {
      const rt = ROOM_TYPES[i];
      const code = `RM${String(maxRmNum + i + 1).padStart(3, '0')}`;

      if (existingCodes.has(code) || existingNames.has(rt.name)) {
        console.log(`⏭ 跳过: ${code} ${rt.name} (已存在)`);
        skipped++;
        continue;
      }

      const id = uuidv4();
      const sortOrder = existing.length + i + 1;

      await pool.query(
        `INSERT INTO booking_room_types (id, code, name, price, status, sort_order) VALUES (?, ?, ?, ?, 1, ?)`,
        [id, code, rt.name, rt.price, sortOrder]
      );

      console.log(`✅ 插入: ${code} ${rt.name} ¥${rt.price} (排序: ${sortOrder})`);
      inserted++;
    }

    console.log(`\n完成：新增 ${inserted} 条，跳过 ${skipped} 条`);
  } catch (err) {
    console.error('❌ 导入失败:', err.message);
    process.exit(1);
  } finally {
    try { await pool.end(); } catch (e) {}
  }
}

seedRoomTypes().then(() => process.exit(0));
