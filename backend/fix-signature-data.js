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
    console.log('=== 开始修复7月25日确认单签名 ===');
    
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
    
    // 2. 查找wecom_DengYueZhen用户
    const [users] = await pool.query(
      'SELECT id, name FROM users WHERE username = ?',
      ['wecom_DengYueZhen']
    );
    
    if (users.length === 0) {
      console.log('❌ 未找到wecom_DengYueZhen用户');
      await pool.end();
      return;
    }
    
    const userId = users[0].id;
    const userName = users[0].name;
    console.log('用户ID:', userId);
    console.log('用户姓名:', userName);
    
    // 3. 查找用户签名
    const [sigRows] = await pool.query(
      'SELECT signature_data FROM user_signatures WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
      [userId]
    );
    
    if (sigRows.length === 0 || !sigRows[0].signature_data) {
      console.log('❌ 未找到用户签名');
      await pool.end();
      return;
    }
    
    const signatureData = sigRows[0].signature_data;
    console.log('签名数据长度:', signatureData.length);
    console.log('签名数据前50字符:', signatureData.substring(0, 50));
    
    // 4. 补全缺失签名
    let updated = false;
    for (const dept of departments) {
      if (dept.confirmed && dept.confirmed_by === userName) {
        const deptKey = String(dept.id);
        if (!signatures[deptKey] || !signatures[deptKey].data) {
          signatures[deptKey] = {
            name: dept.confirmed_by,
            data: signatureData,
            timestamp: dept.confirmed_at
          };
          console.log(`✅ 补全部门[${dept.name || dept.id}]的签名`);
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
    } else {
      console.log('\n⏭️  没有需要更新的数据');
    }
    
    // 6. 重新生成PDF
    console.log('\n🔄 重新生成PDF...');
    try {
      const [pdfRes] = await pool.query('SELECT pdf_url FROM purchase_confirmations WHERE id = ?', [confId]);
      if (pdfRes.length > 0) {
        console.log('PDF URL:', pdfRes[0].pdf_url);
        console.log('提示：请在系统中点击"重新生成PDF"按钮来更新PDF文件');
      }
    } catch (e) {
      console.log('PDF生成需要通过API调用，请在系统中操作');
    }
    
  } catch (err) {
    console.error('❌ 修复失败:', err);
  } finally {
    await pool.end();
  }
}

fixSignature();