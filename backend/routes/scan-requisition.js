/**
 * 扫码领料模块
 *
 * 独立于打卡系统，仅复用微信身份识别（temp_worker_users 的 openid）
 *
 * 接口列表：
 *   微信端（领料人，temp_token 认证）：
 *     GET  /api/scan-requisition/config          获取微信appid
 *     POST /api/scan-requisition/wx-login         微信授权登录
 *     POST /api/scan-requisition/register         完善姓名手机号
 *     GET  /api/scan-requisition/warehouses       部门仓库列表
 *     GET  /api/scan-requisition/my-warehouses    已绑定的仓库
 *     GET  /api/scan-requisition/items            总仓可领物资
 *     POST /api/scan-requisition                  提交领料单
 *
 *   PC端（管理员，requireAuth 认证）：
 *     GET  /api/scan-requisition/pending          待审核列表
 *     POST /api/scan-requisition/:id/approve      审核通过
 *     POST /api/scan-requisition/:id/reject       审核驳回
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { requireAuth } = require('../middleware/rbac');
const { requireTempAuth } = require('../middleware/tempAuth');

// ================================================
// 工具函数
// ================================================

/** 读取微信配置 */
async function getWechatConfig() {
  const [rows] = await pool.query('SELECT * FROM wechat_config WHERE id = 1');
  return rows.length > 0 ? rows[0] : null;
}

/** 安全数值转换 */
function toNum(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'object') {
    const str = val.String || val.string || val.val || JSON.stringify(val);
    return parseFloat(str) || 0;
  }
  return parseFloat(val) || 0;
}

/** 生成领料编号 */
async function generateRequisitionNo() {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
  const [count] = await pool.query(
    `SELECT COUNT(*) as cnt FROM scan_requisitions WHERE DATE(created_at) = CURDATE()`
  );
  const seq = (count[0].cnt || 0) + 1;
  return `RQ${dateStr}-${seq.toString().padStart(3, '0')}`;
}

/** 获取总仓ID */
async function getMainWarehouseId() {
  const [rows] = await pool.query("SELECT id, name FROM warehouses WHERE type = 'main' AND status = 1 LIMIT 1");
  return rows.length > 0 ? rows[0] : null;
}

/** 获取指定仓库（按ID），不存在则回退总仓 */
async function getWarehouseById(warehouseId) {
  if (!warehouseId) return await getMainWarehouseId();
  const [rows] = await pool.query('SELECT id, name FROM warehouses WHERE id = ? AND status = 1 LIMIT 1', [warehouseId]);
  if (rows.length > 0) return rows[0];
  return await getMainWarehouseId();
}

/** 执行出库（事务：扣库存 + 写流水） */
async function executeOutbound(connection, { warehouseId, warehouseName, items, operatorName, operatorId, requisitionNo }) {
  for (const item of items) {
    const qty = toNum(item.quantity);
    if (qty <= 0) continue;

    // 校验库存
    const [inv] = await connection.query(
      'SELECT quantity FROM inventory WHERE warehouse_id = ? AND item_id = ?',
      [warehouseId, item.item_id]
    );
    if (inv.length === 0 || Number(inv[0].quantity) < qty) {
      throw new Error(`物资「${item.item_name}」库存不足（当前库存：${inv.length > 0 ? inv[0].quantity : 0}）`);
    }

    // 写出库流水
    const unitPrice = toNum(item.unit_price);
    const totalAmount = unitPrice ? qty * unitPrice : null;
    const moveId = uuidv4();
    await connection.query(
      `INSERT INTO stock_movements (id, warehouse_id, item_id, item_name, movement_type, quantity, unit, unit_price, total_amount, reason, related_type, operator_id, operator_name, department_id, department_name)
       VALUES (?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?, 'scan', ?, ?, NULL, ?)`,
      [
        moveId, warehouseId, item.item_id, item.item_name,
        -Math.abs(qty), item.unit, unitPrice || null, totalAmount,
        `扫码领料 ${requisitionNo} - ${operatorName}`,
        operatorId || null, operatorName || null,
        warehouseName || null
      ]
    );

    // 扣减库存
    await connection.query(
      'UPDATE inventory SET quantity = quantity - ? WHERE warehouse_id = ? AND item_id = ?',
      [qty, warehouseId, item.item_id]
    );
  }
}

// ================================================
// 微信端接口（领料人）
// ================================================

/** 获取微信 appid（前端构造授权链接） */
router.get('/config', async (req, res) => {
  try {
    const config = await getWechatConfig();
    if (!config || !config.app_id) {
      return res.status(500).json({ error: '微信配置未初始化' });
    }
    res.json({ app_id: config.app_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 微信授权登录（code 换 openid，复用 temp_worker_users 身份） */
router.post('/wx-login', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: '缺少 code 参数' });

    const config = await getWechatConfig();
    if (!config || !config.app_id || !config.app_secret) {
      return res.status(500).json({ error: '微信登录未配置' });
    }

    // 用 code 换 openid
    const tokenRes = await fetch(
      `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${config.app_id}&secret=${config.app_secret}&code=${code}&grant_type=authorization_code`
    );
    const tokenData = await tokenRes.json();

    if (tokenData.errcode) {
      return res.status(401).json({ error: tokenData.errmsg || 'code无效或已过期' });
    }

    const openid = tokenData.openid;
    const unionid = tokenData.unionid || null;

    // 查找已注册用户
    const [existing] = await pool.query(
      'SELECT * FROM temp_worker_users WHERE openid = ?',
      [openid]
    );

    let user;
    let isNewUser;

    if (existing.length > 0) {
      user = existing[0];
      if (user.status !== 1) {
        return res.status(403).json({ error: '账号已被禁用' });
      }
      isNewUser = !user.name;
      pool.query('UPDATE temp_worker_users SET last_login_at = ? WHERE id = ?', [new Date(), user.id]);
    } else {
      // 新用户：自动创建（仅 openid）
      const userId = uuidv4();
      await pool.query(
        'INSERT INTO temp_worker_users (id, openid, unionid, status) VALUES (?, ?, ?, 1)',
        [userId, openid, unionid]
      );
      user = { id: userId, name: '', phone: '', avatar_url: '' };
      isNewUser = true;
    }

    // 查询已绑定的仓库
    const [boundWarehouses] = await pool.query(
      `SELECT w.id, w.name FROM scan_user_warehouses sw
       JOIN warehouses w ON sw.warehouse_id = w.id
       WHERE sw.temp_user_id = ? AND w.status = 1`,
      [user.id]
    );

    res.json({
      success: true,
      is_new_user: isNewUser,
      token: `temp_${user.id}`,
      user: {
        id: user.id,
        name: user.name || '',
        phone: user.phone || '',
      },
      has_bound_warehouse: boundWarehouses.length > 0,
      bound_warehouses: boundWarehouses,
    });
  } catch (err) {
    console.error('scan-requisition wx-login error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** 完善注册信息（姓名+手机号） */
router.post('/register', requireTempAuth, async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name) return res.status(400).json({ error: '姓名为必填项' });

    await pool.query(
      'UPDATE temp_worker_users SET name = ?, phone = ? WHERE id = ?',
      [name, phone || null, req.tempUser.id]
    );

    res.json({
      success: true,
      user: { id: req.tempUser.id, name, phone: phone || null },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 获取部门仓库列表（type='dept'） */
router.get('/warehouses', requireTempAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT w.id, w.name, d.name as department_name
      FROM warehouses w
      LEFT JOIN departments d ON w.department_id = d.id
      WHERE w.type = 'dept' AND w.status = 1
      ORDER BY w.sort_order ASC, w.created_at ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 获取当前用户已绑定的仓库 */
router.get('/my-warehouses', requireTempAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT w.id, w.name, d.name as department_name
      FROM scan_user_warehouses sw
      JOIN warehouses w ON sw.warehouse_id = w.id
      LEFT JOIN departments d ON w.department_id = d.id
      WHERE sw.temp_user_id = ? AND w.status = 1
      ORDER BY sw.assigned_at DESC
    `, [req.tempUser.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 获取指定仓库（出库仓库）库存>0 的物资列表，wh 缺省回退总仓 */
router.get('/items', requireTempAuth, async (req, res) => {
  try {
    const wh = await getWarehouseById(req.query.wh);
    if (!wh) {
      return res.json([]);
    }

    const [rows] = await pool.query(`
      SELECT i.item_id, i.warehouse_id, i.quantity, i.unit,
             wi.name as item_name, wi.sku, wi.reference_price,
             wi.category_id, wc.name as category_name,
             wi.instant_use
      FROM inventory i
      JOIN warehouse_items wi ON i.item_id = wi.id
      LEFT JOIN warehouse_categories wc ON wi.category_id = wc.id
      WHERE i.warehouse_id = ? AND i.quantity > 0 AND wi.status = 1
      ORDER BY wc.sort_order ASC, wi.name ASC
    `, [wh.id]);

    res.json({
      warehouse: wh,
      items: rows.map(r => ({
        ...r,
        quantity: toNum(r.quantity),
        reference_price: toNum(r.reference_price),
        instant_use: Number(r.instant_use) === 1,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 提交领料单 */
router.post('/', requireTempAuth, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    // warehouse_id = 出库仓库（扫码二维码对应仓库，物资从这里出）
    // inbound_warehouse_id = 入库仓库（领料目标部门仓库）
    const { items, warehouse_id, warehouse_name, inbound_warehouse_id, inbound_warehouse_name } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '领料清单不能为空' });
    }

    // 校验每项
    for (const item of items) {
      const qty = toNum(item.quantity);
      if (qty <= 0) {
        return res.status(400).json({ error: `物资「${item.item_name}」数量必须大于0` });
      }
    }

    // 出库仓库（扫码 wh 传入，缺省回退总仓）
    const outboundWh = await getWarehouseById(warehouse_id);
    if (!outboundWh) {
      return res.status(400).json({ error: '出库仓库不存在，请重新扫码' });
    }

    // 查询用户是否已绑定入库仓库
    const [boundWarehouses] = await pool.query(
      'SELECT warehouse_id FROM scan_user_warehouses WHERE temp_user_id = ?',
      [req.tempUser.id]
    );

    const isBound = boundWarehouses.length > 0;
    // 入库仓库：已绑定用绑定仓库，否则用前端传入的 inbound_warehouse_id
    let inboundWhId = isBound ? boundWarehouses[0].warehouse_id : inbound_warehouse_id;
    let inboundWhName = inbound_warehouse_name;
    if (isBound) {
      const [bwRow] = await pool.query('SELECT name FROM warehouses WHERE id = ?', [inboundWhId]);
      inboundWhName = bwRow.length > 0 ? bwRow[0].name : inbound_warehouse_name;
    }

    if (!inboundWhId) {
      return res.status(400).json({ error: '请选择领料仓库' });
    }

    const requisitionNo = await generateRequisitionNo();
    const id = uuidv4();

    // 如果已绑定入库仓库，直接出库
    if (isBound) {
      await connection.beginTransaction();

      await connection.query(
        `INSERT INTO scan_requisitions (id, requisition_no, temp_user_id, user_name, user_phone, warehouse_id, warehouse_name, outbound_warehouse_id, outbound_warehouse_name, items, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', NOW())`,
        [id, requisitionNo, req.tempUser.id, req.tempUser.name, req.tempUser.phone,
         inboundWhId, inboundWhName,
         outboundWh.id, outboundWh.name,
         JSON.stringify(items)]
      );

      // 执行出库（从出库仓库扣库存）
      await executeOutbound(connection, {
        warehouseId: outboundWh.id,
        warehouseName: outboundWh.name,
        items,
        operatorName: req.tempUser.name,
        operatorId: req.tempUser.id,
        requisitionNo,
      });

      await connection.commit();

      return res.json({
        success: true,
        requisition_no: requisitionNo,
        status: 'auto',
        message: '领料成功，已自动出库',
      });
    }

    // 未绑定入库仓库：创建待审核领料单
    await connection.query(
      `INSERT INTO scan_requisitions (id, requisition_no, temp_user_id, user_name, user_phone, warehouse_id, warehouse_name, outbound_warehouse_id, outbound_warehouse_name, items, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [id, requisitionNo, req.tempUser.id, req.tempUser.name, req.tempUser.phone,
       inboundWhId, inboundWhName,
       outboundWh.id, outboundWh.name,
       JSON.stringify(items)]
    );

    res.json({
      success: true,
      requisition_no: requisitionNo,
      status: 'pending',
      message: '领料单已提交，等待管理员审核',
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('提交领料单失败:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// ================================================
// PC端接口（管理员审核）
// ================================================

/** 待审核领料单列表 */
router.get('/pending', requireAuth, async (req, res) => {
  try {
    const { status, page = 1, pageSize = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const size = Math.min(100, parseInt(pageSize));
    const offset = (pageNum - 1) * size;

    let whereClause = 'WHERE 1=1';
    let params = [];
    if (status && status !== 'all') {
      whereClause += ' AND sr.status = ?';
      params.push(status);
    }

    const [rows] = await pool.query(
      `SELECT sr.*, w.name as warehouse_name_full
       FROM scan_requisitions sr
       LEFT JOIN warehouses w ON sr.warehouse_id = w.id
       ${whereClause}
       ORDER BY FIELD(sr.status, 'pending', 'approved', 'rejected', 'auto'), sr.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, size, offset]
    );

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM scan_requisitions sr ${whereClause}`,
      params
    );

    res.json({
      data: rows.map(r => ({
        ...r,
        items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items,
      })),
      total: countResult[0].total,
      page: pageNum,
      pageSize: size,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 审核通过 */
router.post('/:id/approve', requireAuth, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    // inbound_warehouse_id = 入库仓库（领料目标部门仓库，可选覆盖领料单上的入库仓库）
    const { inbound_warehouse_id } = req.body;

    await connection.beginTransaction();

    // 查询领料单
    const [rows] = await connection.query(
      'SELECT * FROM scan_requisitions WHERE id = ? AND status = ?',
      [id, 'pending']
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '领料单不存在或已处理' });
    }

    const requisition = rows[0];
    const items = typeof requisition.items === 'string' ? JSON.parse(requisition.items) : requisition.items;

    // 出库仓库 = 领料单提交时确定的扫码仓库（outbound_warehouse_id）
    const outboundWhId = requisition.outbound_warehouse_id || requisition.warehouse_id;
    if (!outboundWhId) {
      await connection.rollback();
      return res.status(400).json({ error: '领料单缺少出库仓库信息' });
    }
    const [outWhRows] = await connection.query('SELECT name FROM warehouses WHERE id = ?', [outboundWhId]);
    if (outWhRows.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: '出库仓库不存在' });
    }
    const outboundWhName = outWhRows[0].name;

    // 入库仓库（领料目标部门仓库）：优先用管理员指定的，否则用领料单上的
    const inboundWhId = inbound_warehouse_id || requisition.warehouse_id;
    if (!inboundWhId) {
      await connection.rollback();
      return res.status(400).json({ error: '请选择入库仓库（领料部门）' });
    }
    const [inWhRows] = await connection.query('SELECT name FROM warehouses WHERE id = ?', [inboundWhId]);
    if (inWhRows.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: '入库仓库不存在' });
    }
    const inboundWhName = inWhRows[0].name;

    // 执行出库（从出库仓库扣库存）
    await executeOutbound(connection, {
      warehouseId: outboundWhId,
      warehouseName: outboundWhName,
      items,
      operatorName: requisition.user_name,
      operatorId: requisition.temp_user_id,
      requisitionNo: requisition.requisition_no,
    });

    // 更新领料单状态（入库仓库 + 出库仓库）
    await connection.query(
      `UPDATE scan_requisitions SET status = 'approved', auditor_id = ?, auditor_name = ?, approved_at = NOW(), warehouse_id = ?, warehouse_name = ?, outbound_warehouse_id = ?, outbound_warehouse_name = ? WHERE id = ?`,
      [req.user.id, req.user.name, inboundWhId, inboundWhName, outboundWhId, outboundWhName, id]
    );

    // 绑定领料人-入库仓库（后续免审核，自动从扫码仓库出库到该入库仓库）
    await connection.query(
      `INSERT IGNORE INTO scan_user_warehouses (id, temp_user_id, warehouse_id, warehouse_name, assigned_by, assigned_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [uuidv4(), requisition.temp_user_id, inboundWhId, inboundWhName, req.user.id]
    );

    await connection.commit();

    res.json({ success: true, message: '审核通过，已出库并绑定仓库' });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('审核通过失败:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

/** 审核驳回 */
router.post('/:id/reject', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const [result] = await pool.query(
      `UPDATE scan_requisitions SET status = 'rejected', auditor_id = ?, auditor_name = ?, reject_reason = ? WHERE id = ? AND status = 'pending'`,
      [req.user.id, req.user.name, reason || '', id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '领料单不存在或已处理' });
    }

    res.json({ success: true, message: '已驳回' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
