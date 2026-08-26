/**
 * 诊断订单企微通知数据脚本
 * 用法：cd /opt/food-purchase/backend && node scripts/diagnose-booking-wecom.js [订单号]
 * 
 * 检查：
 * 1. 订单是否存储了 sales_wecom_userid
 * 2. 销售员用户是否绑定了 wecom_userid
 * 3. 企微配置是否完整
 */
const pool = require('../db');

async function main() {
  const orderNo = process.argv[2];
  if (!orderNo) {
    console.error('用法: node scripts/diagnose-booking-wecom.js <订单号>');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log(`诊断订单企微通知: ${orderNo}`);
  console.log('='.repeat(60));

  try {
    // 1. 查订单
    console.log('\n📋 步骤1: 查订单数据...');
    const [orders] = await pool.query(`
      SELECT id, order_no, sales_person, sales_person_id, sales_wecom_userid, status
      FROM booking_orders WHERE order_no = ? LIMIT 1
    `, [orderNo]);

    if (orders.length === 0) {
      console.error(`❌ 订单 ${orderNo} 不存在`);
      process.exit(1);
    }

    const o = orders[0];
    console.log(`  ID: ${o.id}`);
    console.log(`  订单号: ${o.order_no}`);
    console.log(`  状态: ${o.status}`);
    console.log(`  销售员姓名 (sales_person): ${o.sales_person}`);
    console.log(`  销售员ID (sales_person_id): ${o.sales_person_id}`);
    console.log(`  销售员企微userid (sales_wecom_userid): ${o.sales_wecom_userid || '❌ 空'}`);

    // 2. 如果有 sales_person_id，查 users 表
    if (o.sales_person_id) {
      console.log('\n📋 步骤2: 查 users 表（按 sales_person_id）...');
      const [users] = await pool.query(`
        SELECT id, username, name, wecom_userid, role_id, status
        FROM users WHERE id = ? LIMIT 1
      `, [o.sales_person_id]);

      if (users.length > 0) {
        const u = users[0];
        console.log(`  ID: ${u.id}`);
        console.log(`  username: ${u.username}`);
        console.log(`  name: ${u.name}`);
        console.log(`  wecom_userid: ${u.wecom_userid || '❌ 空'}`);
        console.log(`  role_id: ${u.role_id}`);
        console.log(`  status: ${u.status}`);
      } else {
        console.log(`  ⚠️ 未找到用户 ID=${o.sales_person_id}`);
      }
    }

    // 3. 按姓名兜底查
    if (o.sales_person) {
      console.log('\n📋 步骤3: 按销售员姓名兜底查...');
      const [users] = await pool.query(`
        SELECT id, username, name, wecom_userid, role_id
        FROM users WHERE name = ?
      `, [o.sales_person]);

      if (users.length > 0) {
        console.log(`  找到 ${users.length} 个同名用户:`);
        users.forEach((u, i) => {
          console.log(`  [${i}] id=${u.id}, username=${u.username}, wecom_userid=${u.wecom_userid || '❌ 空'}, role_id=${u.role_id}`);
        });
      } else {
        console.log(`  ⚠️ 无姓名为 "${o.sales_person}" 的用户`);
      }
    }

    // 4. 查企微配置
    console.log('\n📋 步骤4: 查企微配置...');
    const [configs] = await pool.query(`
      SELECT id, corp_id, agent_id, 
             CASE WHEN app_secret THEN '已配置' ELSE '❌ 未配置' END as app_secret_status,
             app_secret as app_secret_raw,
             booking_webhook_url,
             booking_approver_userid,
             booking_notify_submit, booking_notify_sales, booking_notify_approver
      FROM wecom_config WHERE id = 1
    `);

    let config = null;
    if (configs.length > 0) {
      const c = configs[0];
      config = c;
      console.log(`  corp_id: ${c.corp_id || '❌ 空'}`);
      console.log(`  agent_id: ${c.agent_id || '❌ 空'}`);
      console.log(`  app_secret: ${c.app_secret_status}`);
      console.log(`  booking_webhook_url: ${c.booking_webhook_url ? '✅ 已配置' : '❌ 空'}`);
      console.log(`  booking_approver_userid: ${c.booking_approver_userid || '❌ 空'}`);
      console.log(`  booking_notify_submit: ${c.booking_notify_submit}`);
      console.log(`  booking_notify_sales: ${c.booking_notify_sales}`);
    } else {
      console.log('  ❌ wecom_config 不存在');
    }

    // 5. 企微API连接测试（获取access_token）
    if (config && config.corp_id && config.app_secret_raw) {
      console.log('\n📋 步骤5: 企微API连接测试...');
      try {
        const tokenUrl = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${config.app_secret_raw}`;
        console.log(`  请求URL: ${tokenUrl.replace(/corpsecret=[^&]*/, 'corpsecret=****')}`);
        const tokenRes = await fetch(tokenUrl);
        const tokenData = await tokenRes.json();
        if (tokenData.errcode === 0) {
          console.log(`  ✅ access_token 获取成功 (有效期${Math.round(tokenData.expires_in/3600)}小时)`);
          
          // 6. 发送测试模板卡片
          if (o.sales_wecom_userid) {
            console.log('\n📋 步骤6: 发送测试模板卡片到销售员...');
            const cardBody = {
              touser: o.sales_wecom_userid,
              msgtype: 'template_card',
              agentid: Number(config.agent_id),
              template_card: {
                card_type: 'button_interaction',
                source: { desc: '预订管理系统' },
                main_title: { title: '🧪 预订通知测试', desc: '这是一条测试消息' },
                sub_title_text: `订单号：${o.order_no}\n此为诊断脚本测试，请忽略`,
                horizontal_content_list: [
                  { keyname: '客户', value: o.sales_person || '测试' },
                  { keyname: '销售员', value: o.sales_person || '测试' },
                ],
                button_list: [{
                  text: '测试按钮',
                  style: 1,
                  type: 1,
                  key: 'test_button',
                  url: 'https://food.hywellness.com/booking-board',
                }],
                task_id: `test_${o.order_no}`,
                card_action: { type: 1, url: 'https://food.hywellness.com/booking-board' },
              },
              safe: 0,
            };
            
            const sendUrl = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${tokenData.access_token}`;
            console.log(`  目标userid: ${o.sales_wecom_userid}`);
            console.log(`  agent_id: ${config.agent_id}`);
            console.log(`  卡片body:`, JSON.stringify(cardBody).substring(0, 300));
            
            const sendRes = await fetch(sendUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(cardBody),
            });
            const sendData = await sendRes.json();
            console.log(`  发送结果:`, JSON.stringify(sendData));
            
            if (sendData.errcode === 0) {
              console.log('  ✅ 模板卡片发送成功！请检查企微应用消息');
            } else {
              console.log(`  ❌ 发送失败: errcode=${sendData.errcode}, errmsg=${sendData.errmsg}`);
              if (sendData.invaliduser) console.log(`  ❌ invaliduser: ${sendData.invaliduser}`);
              if (sendData.errcode === 60011) console.log('  💡 提示: userid不在应用可见范围内，请在企微后台检查应用可见范围');
              if (sendData.errcode === 60012) console.log('  💡 提示: userid已禁用或不存在');
              if (sendData.errcode === 45009) console.log('  💡 提示: 该成员不在应用的可见范围内');
            }
          } else {
            console.log('\n📋 步骤6: 跳过 - 订单无 sales_wecom_userid');
          }
        } else {
          console.log(`  ❌ access_token 获取失败: errcode=${tokenData.errcode}, errmsg=${tokenData.errmsg}`);
          console.log('  💡 可能原因: corp_id或app_secret不正确');
        }
      } catch (apiErr) {
        console.log(`  ❌ API请求异常: ${apiErr.message}`);
        console.log('  💡 可能原因: 服务器网络无法访问qyapi.weixin.qq.com');
      }
    } else {
      console.log('\n📋 步骤5-6: 跳过 - 企微配置不完整');
    }

    // 5. 总结建议
    console.log('\n' + '='.repeat(60));
    console.log('📊 诊断总结:');
    const issues = [];
    
    if (!o.sales_wecom_userid) issues.push('订单 sales_wecom_userid 为空');
    if (o.sales_person_id) {
      const [u] = await pool.query('SELECT wecom_userid FROM users WHERE id = ?', [o.sales_person_id]);
      if (u.length > 0 && !u[0].wecom_userid) issues.push('用户 wecom_userid 为空');
    }
    
    if (issues.length === 0) {
      console.log('  ✅ 数据完整，企微userid已快照');
      console.log('  下一步：检查企微应用配置（可见范围、消息类型）');
    } else {
      console.log('  ❌ 发现问题:');
      issues.forEach(i => console.log(`    - ${i}`));
      console.log('\n  建议:');
      console.log('    1. 在【用户管理】中给销售员绑定企微userid');
      console.log('    2. 或使用 UPDATE users SET wecom_userid = "实际企微userid" WHERE username = "销售员用户名"');
      console.log('    3. 然后重新编辑保存订单，或通过 SQL 回填:');
      console.log('       UPDATE booking_orders bo JOIN users u ON bo.sales_person_id = u.id');
      console.log('       SET bo.sales_wecom_userid = u.wecom_userid');
      console.log('       WHERE bo.order_no = "' + orderNo + '" AND u.wecom_userid IS NOT NULL;');
    }

  } catch (e) {
    console.error('❌ 诊断出错:', e.message);
  } finally {
    await pool.end();
  }
}

main();
