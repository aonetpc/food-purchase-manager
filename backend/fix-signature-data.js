const mysql = require('mysql2/promise');

async function fixSignature() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'food_purchase',
    password: 'food_purchase123',
    database: 'food_purchase',
    dateStrings: true,
    timezone: '+08:00',
  });

  try {
    console.log('=== 开始修复7月25日确认单签名（从早餐复制）===');
    
    // 1. 查找7月25日的确认单
    const [confirmations] = await pool.query(
      'SELECT id, departments, confirmed_signatures FROM purchase_confirmations WHERE purchase_date = ?',
      ['2026-07-25']
    );
    
    if (confirmations.length === 0) {
      console.log('❌ 未找到7月25日的确认单');
      await pool.end();
      return;
    }
    
    const confirmation = confirmations[0];
    const confId = confirmation.id;
    const departments = typeof confirmation.departments === 'string' 
      ? JSON.parse(confirmation.departments) 
      : confirmation.departments;
    let signatures = typeof confirmation.confirmed_signatures === 'string' 
      ? JSON.parse(confirmation.confirmed_signatures || '{}') 
      : (confirmation.confirmed_signatures || {});
    
    console.log('确认单ID:', confId);
    console.log('部门数量:', departments.length);
    console.log('已有签名数:', Object.keys(signatures).length);
    
    // 2. 打印所有部门和签名信息（调试用）
    console.log('\n=== 部门列表 ===');
    departments.forEach(dept => {
      const deptKey = String(dept.id);
      const hasSig = !!(signatures[deptKey] || signatures[dept.id]);
      console.log(`ID: ${dept.id} (类型: ${typeof dept.id}), 名称: ${dept.name || '未知'}, 已确认: ${dept.confirmed}, 确认人: ${dept.confirmed_by || '-'}, 有签名: ${hasSig}`);
    });
    
    console.log('\n=== 签名keys ===');
    Object.keys(signatures).forEach(key => {
      console.log(`key: ${key} (类型: ${typeof key}), name: ${signatures[key].name}`);
    });
    
    // 3. 找到邓岳圳的签名（从已有签名中查找）
    let dengSignature = null;
    for (const key of Object.keys(signatures)) {
      const sig = signatures[key];
      if (sig.name === '邓岳圳' && sig.data) {
        dengSignature = sig;
        console.log('\n✅ 找到邓岳圳的签名，key:', key);
        break;
      }
    }
    
    if (!dengSignature) {
      console.log('\n❌ 未找到邓岳圳的签名');
      await pool.end();
      return;
    }
    
    // 4. 把签名复制到所有邓岳圳已确认但没有签名的部门
    let updated = false;
    for (const dept of departments) {
      const deptKey = String(dept.id);
      const hasSig = !!(signatures[deptKey] || signatures[dept.id]);
      
      if (dept.confirmed && dept.confirmed_by === '邓岳圳' && !hasSig) {
        signatures[deptKey] = {
          name: '邓岳圳',
          data: dengSignature.data,
          timestamp: dept.confirmed_at || dengSignature.timestamp
        };
        console.log(`✅ 复制签名到部门[${dept.name || dept.id}]`);
        updated = true;
      }
    }
    
    // 5. 更新数据库
    if (updated) {
      await pool.query(
        'UPDATE purchase_confirmations SET confirmed_signatures = ? WHERE id = ?',
        [JSON.stringify(signatures), confId]
      );
      console.log('\n✅ 数据库更新成功！');
      console.log('更新后的签名keys:', Object.keys(signatures));
    } else {
      console.log('\n⏭️  没有需要更新的数据');
    }
    
  } catch (err) {
    console.error('❌ 修复失败:', err);
  } finally {
    await pool.end();
  }
}

fixSignature();