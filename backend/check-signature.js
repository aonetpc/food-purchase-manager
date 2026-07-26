async function checkData() {
  try {
    const token = 'Bearer ' + process.env.AUTH_TOKEN;
    
    // 1. 查询7月25日的确认单
    const confirmRes = await fetch('http://localhost:3000/api/purchase-confirmations', {
      headers: { Authorization: token }
    });
    const confirmations = await confirmRes.json();
    const target = confirmations.find(c => c.purchase_date === '2026-07-25');
    
    console.log('=== 7月25日确认单 ===');
    console.log('ID:', target?.id);
    console.log('departments:', JSON.stringify(target?.departments, null, 2));
    console.log('confirmed_signatures:', JSON.stringify(target?.confirmed_signatures, null, 2));
    
    // 2. 查询wecom_DengYueZhen用户的签名
    // 先查用户ID
    const userRes = await fetch('http://localhost:3000/api/users', {
      headers: { Authorization: token }
    });
    const users = await userRes.json();
    const user = users.find(u => u.username === 'wecom_DengYueZhen');
    
    if (user) {
      console.log('\n=== wecom_DengYueZhen 用户 ===');
      console.log('ID:', user.id);
      console.log('姓名:', user.name);
      
      // 查询签名
      const sigRes = await fetch(`http://localhost:3000/api/user/signature?user_id=${user.id}&user_source=system`, {
        headers: { Authorization: token }
      });
      const sigData = await sigRes.json();
      console.log('\n=== 用户签名 ===');
      console.log('signature_data exists:', sigData.signature_data ? sigData.signature_data.substring(0, 50) + '...' : null);
    }
  } catch (e) {
    console.error('Error:', e);
  }
}

checkData();