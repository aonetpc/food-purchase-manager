const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

const dbToFrontend = (row) => ({
  id: row.id,
  date: row.date,
  ingredient_id: row.ingredient_id,
  ingredient_name: row.ingredient_name,
  category_id: row.category_id || '',
  category_name: row.category_name || '',
  department_id: row.department_id || '',
  department_name: row.department_name || '',
  supplier_id: row.supplier_id || '',
  supplier_name: row.supplier_name || '',
  purchase_unit: row.purchase_unit,
  purchase_quantity: parseFloat(row.purchase_quantity),
  purchase_unit_price: parseFloat(row.purchase_unit_price),
  base_unit: row.base_unit || '',
  base_unit_price: parseFloat(row.base_unit_price) || 0,
  base_quantity: parseFloat(row.base_quantity) || 0,
  amount: parseFloat(row.amount),
  created_at: row.created_at,
});

router.get('/', async (req, res) => {
  try {
    const { date, start_date, end_date, month, year } = req.query;
    let sql = 'SELECT * FROM purchase_records';
    const params = [];

    if (date) {
      sql += ' WHERE date = ?';
      params.push(date);
    } else if (month) {
      sql += " WHERE DATE_FORMAT(date, '%Y-%m') = ?";
      params.push(month);
    } else if (year) {
      sql += ' WHERE YEAR(date) = ?';
      params.push(year);
    } else if (start_date && end_date) {
      sql += ' WHERE date >= ? AND date <= ?';
      params.push(start_date, end_date);
    }

    sql += ' ORDER BY date ASC, created_at ASC';

    const [rows] = await pool.query(sql, params);
    const result = rows.map(dbToFrontend);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const item = req.body;
    const id = uuidv4();

    await pool.query(
      `INSERT INTO purchase_records 
       (id, date, ingredient_id, ingredient_name, category_id, category_name,
        department_id, department_name, supplier_id, supplier_name,
        purchase_unit, purchase_quantity, purchase_unit_price,
        base_unit, base_unit_price, base_quantity, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        item.date,
        item.ingredient_id,
        item.ingredient_name,
        item.category_id,
        item.category_name,
        item.department_id || '',
        item.department_name || '',
        item.supplier_id || '',
        item.supplier_name || '',
        item.purchase_unit,
        item.purchase_quantity,
        item.purchase_unit_price,
        item.base_unit,
        item.base_unit_price,
        item.base_quantity,
        item.amount,
      ]
    );

    const [rows] = await pool.query('SELECT * FROM purchase_records WHERE id = ?', [id]);
    res.json(dbToFrontend(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const item = req.body;

    const fields = [];
    const values = [];

    const fieldMap = {
      date: 'date',
      ingredient_id: 'ingredient_id',
      ingredient_name: 'ingredient_name',
      category_id: 'category_id',
      category_name: 'category_name',
      department_id: 'department_id',
      department_name: 'department_name',
      supplier_id: 'supplier_id',
      supplier_name: 'supplier_name',
      purchase_unit: 'purchase_unit',
      purchase_quantity: 'purchase_quantity',
      purchase_unit_price: 'purchase_unit_price',
      base_unit: 'base_unit',
      base_unit_price: 'base_unit_price',
      base_quantity: 'base_quantity',
      amount: 'amount',
    };

    for (const [key, dbField] of Object.entries(fieldMap)) {
      if (item[key] !== undefined) {
        fields.push(`${dbField} = ?`);
        values.push(item[key]);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: '没有更新字段' });
    }

    values.push(id);
    await pool.query(`UPDATE purchase_records SET ${fields.join(', ')} WHERE id = ?`, values);

    const [rows] = await pool.query('SELECT * FROM purchase_records WHERE id = ?', [id]);
    res.json(dbToFrontend(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM purchase_records WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/batch-save', async (req, res) => {
  try {
    const { date, items } = req.body;

    if (!date) {
      return res.status(400).json({ error: '缺少日期参数' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [existingRows] = await conn.query(
        'SELECT id FROM purchase_records WHERE date = ?',
        [date]
      );
      const existingIds = new Set(existingRows.map(r => r.id));

      const incomingIds = new Set(
        items
          .map(item => item.id || item.ingredientId)
          .filter(id => id && typeof id === 'string')
      );

      const idsToDelete = [...existingIds].filter(id => !incomingIds.has(id));
      if (idsToDelete.length > 0) {
        const placeholders = idsToDelete.map(() => '?').join(',');
        await conn.query(
          `DELETE FROM purchase_records WHERE id IN (${placeholders})`,
          idsToDelete
        );
      }

      const savedItems = [];
      for (const item of items) {
        const id = item.id && typeof item.id === 'string' ? item.id : uuidv4();
        const ingredientId = item.ingredient_id || item.ingredientId;
        const ingredientName = item.ingredient_name || item.ingredientName;
        const categoryId = item.category_id || item.categoryId;
        const categoryName = item.category_name || item.categoryName;
        const departmentId = item.department_id || item.departmentId || '';
        const departmentName = item.department_name || item.departmentName || '';
        const supplierId = item.supplier_id || item.supplierId || '';
        const supplierName = item.supplier_name || item.supplierName || '';
        const purchaseUnit = item.purchase_unit || item.purchaseUnit;
        const purchaseQuantity = item.purchase_quantity ?? item.purchaseQuantity;
        const purchaseUnitPrice = item.purchase_unit_price ?? item.purchaseUnitPrice;
        const baseUnit = item.base_unit || item.baseUnit || '';
        const baseUnitPrice = item.base_unit_price ?? item.baseUnitPrice ?? 0;
        const baseQuantity = item.base_quantity ?? item.baseQuantity ?? 0;
        const amount = item.amount ?? 0;

        if (existingIds.has(id)) {
          await conn.query(
            `UPDATE purchase_records SET
              ingredient_id = ?, ingredient_name = ?,
              category_id = ?, category_name = ?,
              department_id = ?, department_name = ?,
              supplier_id = ?, supplier_name = ?,
              purchase_unit = ?, purchase_quantity = ?, purchase_unit_price = ?,
              base_unit = ?, base_unit_price = ?, base_quantity = ?,
              amount = ?
             WHERE id = ?`,
            [
              ingredientId, ingredientName,
              categoryId, categoryName,
              departmentId, departmentName,
              supplierId, supplierName,
              purchaseUnit, purchaseQuantity, purchaseUnitPrice,
              baseUnit, baseUnitPrice, baseQuantity,
              amount,
              id
            ]
          );
        } else {
          await conn.query(
            `INSERT INTO purchase_records 
             (id, date, ingredient_id, ingredient_name, category_id, category_name,
              department_id, department_name, supplier_id, supplier_name,
              purchase_unit, purchase_quantity, purchase_unit_price,
              base_unit, base_unit_price, base_quantity, amount)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id, date, ingredientId, ingredientName, categoryId, categoryName,
              departmentId, departmentName, supplierId, supplierName,
              purchaseUnit, purchaseQuantity, purchaseUnitPrice,
              baseUnit, baseUnitPrice, baseQuantity, amount
            ]
          );
        }

        savedItems.push({
          ...item,
          id,
          date,
          ingredient_id: ingredientId,
          ingredient_name: ingredientName,
          category_id: categoryId,
          category_name: categoryName,
          department_id: departmentId,
          department_name: departmentName,
          supplier_id: supplierId,
          supplier_name: supplierName,
          purchase_unit: purchaseUnit,
          purchase_quantity: purchaseQuantity,
          purchase_unit_price: purchaseUnitPrice,
          base_unit: baseUnit,
          base_unit_price: baseUnitPrice,
          base_quantity: baseQuantity,
          amount,
        });
      }

      await conn.commit();
      res.json(savedItems);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('batch-save error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/move-date', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id, newDate } = req.body;

    if (!id || !newDate) {
      return res.status(400).json({ error: '缺少参数' });
    }

    await conn.beginTransaction();

    const [itemRows] = await conn.query('SELECT * FROM purchase_records WHERE id = ?', [id]);
    if (itemRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: '记录不存在' });
    }

    const item = itemRows[0];
    const oldDate = item.date;

    if (oldDate === newDate) {
      await conn.rollback();
      return res.status(400).json({ error: '目标日期与原日期相同' });
    }

    const [existingRows] = await conn.query(
      'SELECT * FROM purchase_records WHERE date = ? AND ingredient_id = ? AND purchase_unit = ? AND department_id = ?',
      [newDate, item.ingredient_id, item.purchase_unit, item.department_id || '']
    );

    if (existingRows.length > 0) {
      const existing = existingRows[0];
      const newQuantity = parseFloat(existing.purchase_quantity) + parseFloat(item.purchase_quantity);
      const newAmount = parseFloat(existing.amount) + parseFloat(item.amount);

      await conn.query(
        'UPDATE purchase_records SET purchase_quantity = ?, amount = ? WHERE id = ?',
        [newQuantity, newAmount, existing.id]
      );
      await conn.query('DELETE FROM purchase_records WHERE id = ?', [id]);
    } else {
      await conn.query('UPDATE purchase_records SET date = ? WHERE id = ?', [newDate, id]);
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('move-date error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.delete('/date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    await pool.query('DELETE FROM purchase_records WHERE date = ?', [date]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/average-price', async (req, res) => {
  try {
    const { month } = req.query;
    
    if (!month) {
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const year = lastMonth.getFullYear();
      const monthNum = String(lastMonth.getMonth() + 1).padStart(2, '0');
      month = `${year}-${monthNum}`;
    }

    const [results] = await pool.query(`
      SELECT 
        ingredient_id, 
        ingredient_name, 
        AVG(purchase_unit_price) as avg_price
      FROM purchase_records 
      WHERE DATE_FORMAT(date, '%Y-%m') = ?
      GROUP BY ingredient_id, ingredient_name
    `, [month]);

    const prices = {};
    results.forEach(row => {
      prices[row.ingredient_id] = {
        ingredientName: row.ingredient_name,
        avgPrice: parseFloat(row.avg_price)
      };
    });

    res.json(prices);
  } catch (err) {
    console.error('average-price error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 月度采购汇总（智能历史对比）
router.get('/summary', async (req, res) => {
  try {
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({ error: '请提供月份参数，如 ?month=2026-07' });
    }

    // 解析月份
    const [year, monthNum] = month.split('-').map(Number);
    const lastMonth = new Date(year, monthNum - 2, 1); // 上月
    const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

    // 查询本月采购记录
    const [monthRows] = await pool.query(`
      SELECT
        ingredient_id,
        ingredient_name,
        category_id,
        category_name,
        purchase_unit,
        purchase_unit_price,
        purchase_quantity,
        amount,
        date,
        department_name,
        supplier_name
      FROM purchase_records
      WHERE DATE_FORMAT(date, '%Y-%m') = ?
      ORDER BY date ASC
    `, [month]);

    // 查询上月采购记录
    const [lastMonthRows] = await pool.query(`
      SELECT
        ingredient_id,
        ingredient_name,
        AVG(purchase_unit_price) as avg_price,
        SUM(purchase_quantity) as total_qty
      FROM purchase_records
      WHERE DATE_FORMAT(date, '%Y-%m') = ?
      GROUP BY ingredient_id, ingredient_name
    `, [lastMonthStr]);

    // 查询最近3个月历史记录（用于上月未采购的情况）
    const threeMonthsAgo = new Date(year, monthNum - 4, 1);
    const threeMonthsAgoStr = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}`;
    const [historyRows] = await pool.query(`
      SELECT
        ingredient_id,
        ingredient_name,
        AVG(purchase_unit_price) as avg_price,
        SUM(purchase_quantity) as total_qty,
        MAX(date) as last_purchase_date
      FROM purchase_records
      WHERE DATE_FORMAT(date, '%Y-%m') >= ? AND DATE_FORMAT(date, '%Y-%m') < ?
      GROUP BY ingredient_id, ingredient_name
    `, [threeMonthsAgoStr, month]);

    // 构建上月价格映射
    const lastMonthMap = {};
    lastMonthRows.forEach(row => {
      lastMonthMap[row.ingredient_id] = {
        avgPrice: parseFloat(row.avg_price),
        totalQty: parseFloat(row.total_qty)
      };
    });

    // 构建历史价格映射
    const historyMap = {};
    historyRows.forEach(row => {
      historyMap[row.ingredient_id] = {
        avgPrice: parseFloat(row.avg_price),
        totalQty: parseFloat(row.total_qty),
        lastPurchaseDate: row.last_purchase_date
      };
    });

    // 按食材分组统计本月数据
    const ingredientMap = {};
    monthRows.forEach(row => {
      const id = row.ingredient_id;
      if (!ingredientMap[id]) {
        ingredientMap[id] = {
          ingredientId: id,
          ingredientName: row.ingredient_name,
          categoryId: row.category_id || '',
          categoryName: row.category_name || '未分类',
          purchaseUnit: row.purchase_unit,
          records: [],
          totalPrice: 0,
          totalQty: 0,
          totalAmount: 0,
          purchaseCount: 0,
          departments: new Set(),
          suppliers: new Set()
        };
      }
      const item = ingredientMap[id];
      item.records.push(row);
      item.totalPrice += parseFloat(row.purchase_unit_price);
      item.totalQty += parseFloat(row.purchase_quantity);
      item.totalAmount += parseFloat(row.amount);
      item.purchaseCount++;
      if (row.department_name) item.departments.add(row.department_name);
      if (row.supplier_name) item.suppliers.add(row.supplier_name);
    });

    // 构建汇总结果
    const summary = Object.values(ingredientMap).map(item => {
      const avgPrice = item.totalPrice / item.purchaseCount;

      // 智能对比逻辑
      let compareSource = 'new';
      let comparePrice = null;
      let changeRate = null;

      if (lastMonthMap[item.ingredientId]) {
        // 上月有采购，对比上月均价
        compareSource = 'lastMonth';
        comparePrice = lastMonthMap[item.ingredientId].avgPrice;
        changeRate = ((avgPrice - comparePrice) / comparePrice) * 100;
      } else if (historyMap[item.ingredientId]) {
        // 上月无采购，查找历史记录
        compareSource = 'history';
        comparePrice = historyMap[item.ingredientId].avgPrice;
        changeRate = ((avgPrice - comparePrice) / comparePrice) * 100;
      } else {
        // 全新物品
        compareSource = 'new';
        comparePrice = null;
        changeRate = null;
      }

      return {
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        purchaseUnit: item.purchaseUnit,
        avgPrice: Math.round(avgPrice * 100) / 100,
        totalQty: Math.round(item.totalQty * 100) / 100,
        totalAmount: Math.round(item.totalAmount * 100) / 100,
        purchaseCount: item.purchaseCount,
        departments: Array.from(item.departments).join('、'),
        suppliers: Array.from(item.suppliers).join('、'),
        compareSource,
        comparePrice: comparePrice ? Math.round(comparePrice * 100) / 100 : null,
        changeRate: changeRate ? Math.round(changeRate * 10) / 10 : null,
        lastPurchaseDate: compareSource === 'history' ? historyMap[item.ingredientId]?.lastPurchaseDate : null
      };
    });

    // 按总金额排序
    summary.sort((a, b) => b.totalAmount - a.totalAmount);

    // 统计概览
    const overview = {
      totalAmount: summary.reduce((s, i) => s + i.totalAmount, 0),
      totalItems: summary.length,
      totalPurchaseCount: monthRows.length,
      avgPrice: summary.length > 0 ? Math.round(summary.reduce((s, i) => s + i.avgPrice, 0) / summary.length * 100) / 100 : 0,
      newItems: summary.filter(i => i.compareSource === 'new').length,
      priceUpItems: summary.filter(i => i.changeRate !== null && i.changeRate > 0).length,
      priceDownItems: summary.filter(i => i.changeRate !== null && i.changeRate < 0).length
    };

    res.json({ overview, summary, month, lastMonth: lastMonthStr });
  } catch (err) {
    console.error('summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 导出Excel（生成数据供前端下载）
router.get('/export', async (req, res) => {
  try {
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({ error: '请提供月份参数' });
    }

    const [year, monthNum] = month.split('-').map(Number);
    const lastMonth = new Date(year, monthNum - 2, 1);
    const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

    // 查询本月详细记录
    const [rows] = await pool.query(`
      SELECT
        ingredient_name,
        category_name,
        purchase_unit_price,
        purchase_quantity,
        purchase_unit,
        amount,
        date,
        department_name,
        supplier_name
      FROM purchase_records
      WHERE DATE_FORMAT(date, '%Y-%m') = ?
      ORDER BY ingredient_name, date
    `, [month]);

    // 查询上月均价
    const [lastMonthRows] = await pool.query(`
      SELECT
        ingredient_id,
        ingredient_name,
        AVG(purchase_unit_price) as avg_price
      FROM purchase_records
      WHERE DATE_FORMAT(date, '%Y-%m') = ?
      GROUP BY ingredient_id, ingredient_name
    `, [lastMonthStr]);

    const lastMonthMap = {};
    lastMonthRows.forEach(row => {
      lastMonthMap[row.ingredient_name] = parseFloat(row.avg_price);
    });

    // 构建导出数据
    const exportData = rows.map(row => {
      const lastAvg = lastMonthMap[row.ingredient_name];
      const changeRate = lastAvg ? Math.round(((row.purchase_unit_price - lastAvg) / lastAvg) * 1000) / 10 : null;

      return {
        食材名称: row.ingredient_name,
        分类: row.category_name || '未分类',
        采购日期: row.date,
        单价: parseFloat(row.purchase_unit_price),
        数量: parseFloat(row.purchase_quantity),
        单位: row.purchase_unit,
        金额: parseFloat(row.amount),
        部门: row.department_name || '',
        供应商: row.supplier_name || '',
        上月均价: lastAvg || null,
        涨跌幅: changeRate
      };
    });

    res.json({ data: exportData, month });
  } catch (err) {
    console.error('export error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
