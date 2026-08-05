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
    console.log('\n=== 开始修复7月25日确认单签名（从早餐复制）===');
    
    // 1. 查找7月25日的确认单
    const [confirmations] = await pool.query(
      'SELECT id, purchase_date, departments, confirmed_signatures FROM purchase_confirmations WHERE purchase_date = ?',
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
    console.log('purchase_date:', confirmation.purchase_date);
    console.log('部门数量:', departments.length);
    console.log('已有签名数:', Object.keys(signatures).length);
    console.log('签名keys:', JSON.stringify(Object.keys(signatures)));
    
    // 2. 打印所有部门详细信息
    console.log('\n=== 部门列表 ===');
    departments.forEach(dept => {
      const deptKeyStr = String(dept.id);
      const hasSigStr = !!(signatures[deptKeyStr] && signatures[deptKeyStr].data);
      const hasSigNum = !!(signatures[dept.id] && signatures[dept.id].data);
      console.log(`  ID: ${dept.id} (类型: ${typeof dept.id}), 名称: ${dept.name || '未知'}, 已确认: ${dept.confirmed}, 确认人: ${dept.confirmed_by || '-'}, 有签名(str): ${hasSigStr}, 有签名(num): ${hasSigNum}`);
    });
    
    // 3. 找到邓岳圳的签名（从已有签名中查找）
    let dengSignature = null;
    let dengKey = null;
    for (const key of Object.keys(signatures)) {
      const sig = signatures[key];
      if (sig.name === '邓岳圳' && sig.data) {
        dengSignature = sig;
        dengKey = key;
        console.log('\n✅ 找到邓岳圳的签名');
        console.log('   签名key:', key, '(类型:', typeof key, ')');
        console.log('   签名名称:', sig.name);
        console.log('   签名数据长度:', sig.data ? sig.data.length : 0);
        break;
      }
    }
    
    if (!dengSignature) {
      console.log('\n❌ 未找到邓岳圳的签名，检查所有签名：');
      for (const key of Object.keys(signatures)) {
        const sig = signatures[key];
        console.log(`   key: ${key}, name: ${sig.name}, data: ${sig.data ? '有数据' : '空'}`);
      }
      await pool.end();
      return;
    }
    
    // 4. 把签名复制到所有邓岳圳已确认但没有签名的部门
    let updated = false;
    console.log('\n=== 开始复制签名 ===');
    for (const dept of departments) {
      const deptKey = String(dept.id);
      const hasSigStr = !!(signatures[deptKey] && signatures[deptKey].data);
      const hasSigNum = !!(signatures[dept.id] && signatures[dept.id].data);
      
      if (dept.confirmed && dept.confirmed_by === '邓岳圳') {
        if (!hasSigStr && !hasSigNum) {
          signatures[deptKey] = {
            name: '邓岳圳',
            data: dengSignature.data,
            timestamp: dept.confirmed_at || dengSignature.timestamp
          };
          console.log(`✅ 复制签名到部门[${dept.name || dept.id}]，key: ${deptKey}`);
          updated = true;
        } else {
          console.log(`⏭️  部门[${dept.name || dept.id}]已有签名，跳过`);
        }
      }
    }
    
    // 5. 更新数据库
    if (updated) {
      await pool.query(
        'UPDATE purchase_confirmations SET confirmed_signatures = ? WHERE id = ?',
        [JSON.stringify(signatures), confId]
      );
      console.log('\n✅ 数据库更新成功！');
      console.log('更新后的签名keys:', JSON.stringify(Object.keys(signatures)));
      
      // 验证更新结果
      const [verify] = await pool.query(
        'SELECT confirmed_signatures FROM purchase_confirmations WHERE id = ?',
        [confId]
      );
      const newSignatures = JSON.parse(verify[0].confirmed_signatures || '{}');
      console.log('验证签名keys:', JSON.stringify(Object.keys(newSignatures)));
    } else {
      console.log('\n⏭️  没有需要更新的数据');
    }
    
  } catch (err) {
    console.error('❌ 修复失败:', err);
  } finally {
    await pool.end();
  }
}

fixSignature().then(() => process.exit(0)).catch(() => process.exit(0));