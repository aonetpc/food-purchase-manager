/**
 * 预订通知企微调试脚本
 * 
 * 在服务器上运行: cd /opt/food-purchase/backend && node scripts/test-wecom-booking.js
 * 
 * 功能：
 * 1. 检查企微配置是否完整
 * 2. 通过系统用户名查找企微userid
 * 3. 验证企微用户是否存在
 * 4. 发送测试模板卡片
 * 5. 输出完整的调试信息
 */

const pool = require('../db');

// 模拟环境变量
require('dotenv').config();

async function main() {
  const username = process.argv[2] || 'aonetpc';
  console.log('='.repeat(60));
  console.log(`预订通知企微调试脚本`);
  console.log(`测试用户: ${username}`);
  console.log('='.repeat(60));

  try {
    // 1. 检查企微配置
    console.log('\n📋 步骤1: 检查企微配置...');
    const [configRows] = await pool.query('SELECT id, corp_id, agent_id, app_secret, booking_webhook_url, booking_approver_userid, booking_notify_submit, booking_notify_sales, booking_notify_approver FROM wecom_config WHERE id = 1');
    
    if (configRows.length === 0) {
      console.error('❌ 企微配置不存在');
      process.exit(1);
    }
    
    const config = configRows[0];
    console.log(`  corp_id: ${config.corp_id || '❌ 未配置'}`);
    console.log(`  agent_id: ${config.agent_id || '❌ 未配置'}`);
    console.log(`  app_secret: ${config.app_secret ? '✅ 已配置' : '❌ 未配置'}`);
    console.log(`  booking_webhook_url: ${config.booking_webhook_url ? '✅ 已配置' : '❌ 未配置'}`);
    console.log(`  booking_approver_userid: ${config.booking_approver_userid || '❌ 未配置'}`);
    console.log(`  booking_notify_submit: ${config.booking_notify_submit ?? '未设置'}`);
    console.log(`  booking_notify_sales: ${config.booking_notify_sales ?? '未设置'}`);
    console.log(`  booking_notify_approver: ${config.booking_notify_approver ?? '未设置'}`);

    if (!config.corp_id || !config.app_secret || !config.agent_id) {
      console.error('\n❌ 企微配置不完整，无法继续测试');
      process.exit(1);
    }

    // 2. 查找系统用户及其企微userid
    console.log('\n👤 步骤2: 查找系统用户及其企微userid...');
    const [userRows] = await pool.query(
      'SELECT id, username, name, wecom_userid, role FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    
    if (userRows.length === 0) {
      console.error(`❌ 系统用户 ${username} 不存在`);
      process.exit(1);
    }
    
    const user = userRows[0];
    console.log(`  用户ID: ${user.id}`);
    console.log(`  用户名: ${user.username}`);
    console.log(`  姓名: ${user.name}`);
    console.log(`  角色: ${user.role}`);
    console.log(`  wecom_userid: ${user.wecom_userid || '❌ 为空！'}`);

    if (!user.wecom_userid) {
      console.error(`\n❌ 用户 ${username} 的 wecom_userid 字段为空`);
      console.log('   请先在用户管理页面绑定企微账号');
      console.log('   或者手动更新数据库: UPDATE users SET wecom_userid = \'实际企微userid\' WHERE username = ?');
      
      // 列出所有有企微userid的用户
      console.log('\n📋 当前已绑定企微的用户列表:');
      const [boundUsers] = await pool.query(
        'SELECT id, username, name, wecom_userid FROM users WHERE wecom_userid IS NOT NULL AND wecom_userid != ""'
      );
      if (boundUsers.length === 0) {
        console.log('  （无已绑定用户）');
      } else {
        boundUsers.forEach(u => {
          console.log(`  - ${u.username} (${u.name}): ${u.wecom_userid}`);
        });
      }
      process.exit(1);
    }

    const targetUserid = user.wecom_userid;

    // 3. 获取access_token
    console.log('\n🔑 步骤3: 获取企微access_token...');
    const tokenRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${config.app_secret}`
    );
    const tokenData = await tokenRes.json();
    
    if (tokenData.errcode !== 0) {
      console.error(`❌ 获取access_token失败: ${tokenData.errmsg}`);
      process.exit(1);
    }
    console.log(`  ✅ access_token获取成功: ${tokenData.access_token.substring(0, 10)}...`);
    const accessToken = tokenData.access_token;

    // 4. 验证企微用户
    console.log('\n🔍 步骤4: 验证企微用户是否存在...');
    try {
      const userRes = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${accessToken}&userid=${targetUserid}`
      );
      const userData = await userRes.json();
      
      if (userData.errcode === 0) {
        console.log(`  ✅ 企微用户验证通过`);
        console.log(`    姓名: ${userData.name}`);
        console.log(`    部门: ${userData.department}`);
      } else {
        console.error(`  ❌ 企微用户验证失败: errcode=${userData.errcode}, errmsg=${userData.errmsg}`);
        if (userData.errcode === 40014) {
          console.log('    提示: access_token无效或已过期');
        } else if (userData.errcode === 4003) {
          console.log('    提示: userid不存在或无权限查看');
        }
        // 不退出，继续尝试发送
      }
    } catch (e) {
      console.warn(`  ⚠️ 企微用户验证异常: ${e.message}`);
    }

    // 5. 发送测试模板卡片
    console.log('\n📤 步骤5: 发送测试模板卡片...');
    const cardContent = {
      card_type: 'button_interaction',
      source: { desc: '预订管理系统' },
      main_title: { 
        title: '📋 预订系统测试通知', 
        desc: `接收人: ${user.name || username}` 
      },
      sub_title_text: '如果您收到此消息，说明企微应用配置正确',
      horizontal_content_list: [
        { keyname: '测试项', value: '模板卡片' },
        { keyname: '发送时间', value: new Date().toLocaleString('zh-CN') },
        { keyname: '测试类型', value: '预订通知' },
      ],
      button_list: [{
        text: '预订系统',
        style: 1,
        type: 1,
        key: 'go_booking_test',
        url: process.env.FRONTEND_URL || '/booking-board',
      }],
      task_id: 'booking_test_card',
      card_action: { 
        type: 1, 
        url: process.env.FRONTEND_URL || '/booking-board' 
      },
    };

    const body = {
      touser: targetUserid,
      msgtype: 'template_card',
      agentid: Number(config.agent_id),
      template_card: cardContent,
      safe: 0,
    };

    console.log(`  目标用户: ${targetUserid}`);
    console.log(`  Agent ID: ${config.agent_id}`);
    console.log(`  消息类型: template_card (button_interaction)`);
    console.log(`  卡片内容:`, JSON.stringify(cardContent).substring(0, 300));

    const sendRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );
    const sendData = await sendRes.json();

    console.log(`\n📬 企微API返回结果:`);
    console.log(`  errcode: ${sendData.errcode}`);
    console.log(`  errmsg: ${sendData.errmsg}`);
    
    if (sendData.errcode === 0) {
      console.log(`  invaliduser: ${sendData.invaliduser || '无'}`);
      console.log(`  ❓ respmsg: ${sendData.respmsg || '无'}`);
      console.log('\n✅ 模板卡片发送成功！请检查企微应用是否收到消息。');
    } else {
      console.error(`\n❌ 模板卡片发送失败！`);
      console.error(`  错误码: ${sendData.errcode}`);
      console.error(`  错误信息: ${sendData.errmsg}`);
      
      // 常见错误码解释
      const errorCodes = {
        40002: '不合法的userid',
        40014: 'access_token无效或已过期',
        4003: 'userid不存在或无权限查看',
        40074: '不合法的appsecret',
        45009: '调用接口的agent不匹配',
        45011: '应用未启用或已停用',
        48002: 'API无权限',
        48009: '用户不在应用可见范围内',
        41028: 'chatid不存在',
      };
      const hint = errorCodes[sendData.errcode];
      if (hint) {
        console.log(`  💡 可能原因: ${hint}`);
      }
      
      if (sendData.invaliduser && sendData.invaliduser.length > 0) {
        console.error(`  ❌ 无效用户: ${sendData.invaliduser.join(', ')}`);
      }
    }

    // 6. 总结
    console.log('\n📊 测试总结:');
    console.log(`  系统用户: ${username} (${user.name})`);
    console.log(`  企微userid: ${targetUserid}`);
    console.log(`  Agent ID: ${config.agent_id}`);
    console.log(`  发送结果: ${sendData.errcode === 0 ? '✅ 成功' : '❌ 失败'}`);
    console.log(`  消息类型: template_card / button_interaction`);

  } catch (err) {
    console.error('\n💥 测试脚本异常:');
    console.error('  错误:', err.message);
    console.error('  堆栈:', err.stack?.substring(0, 500));
  } finally {
    await pool.end();
  }
}

main();
