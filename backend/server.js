const express = require('express');
const cors = require('cors');
const path = require('path');

const categoriesRouter = require('./routes/categories');
const ingredientsRouter = require('./routes/ingredients');
const purchaseRouter = require('./routes/purchase');
const authRouter = require('./routes/auth');
const departmentsRouter = require('./routes/departments');
const suppliersRouter = require('./routes/suppliers');
const wecomRouter = require('./routes/wecom');
const purchaseConfirmationsRouter = require('./routes/purchase-confirmations');
const reconciliationRouter = require('./routes/reconciliation');
const userSignaturesRouter = require('./routes/user-signatures');

// 仓库管理模块
const warehousesRouter = require('./routes/warehouses');
const inventoryRouter = require('./routes/inventory');
const stockMovementsRouter = require('./routes/stock-movements');
const warehousePurchasesRouter = require('./routes/warehouse-purchases');
const stockTakesRouter = require('./routes/stock-takes');

// 扫码领料模块
const scanRequisitionRouter = require('./routes/scan-requisition');

// 管理报表模块
const reportsRouter = require('./routes/reports');

// 外请人员打卡模块
const tempAuthRouter = require('./routes/temp-auth');
const tempPositionsRouter = require('./routes/temp-positions');
const tempCheckinsRouter = require('./routes/temp-checkins');
const tempAssessmentsRouter = require('./routes/temp-assessments');
const tempStatsRouter = require('./routes/temp-stats');
const tempWorkersRouter = require('./routes/temp-workers');
const bookingBoardRouter = require('./routes/booking-board');
const checkupTemplatesRouter = require('./routes/checkup-templates');
const { requireAuth, getUserPermissions, getRoles, getPermissions, getModules, requireRole } = require('./middleware/rbac');
const rolesRouter = require('./routes/roles');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 为企微回调添加raw body解析
app.use('/api/wecom/callback', express.raw({ type: '*/*' }));
app.use('/api/wecom/callback', (req, res, next) => {
  req.rawBody = req.body;
  try {
    req.body = JSON.parse(req.body.toString());
  } catch (e) {
    try {
      const xmlStr = req.body.toString();
      if (xmlStr.includes('<xml>')) {
        req.body = { xml: xmlStr };
      } else {
        req.body = {};
      }
    } catch (e2) {
      req.body = {};
    }
  }
  next();
});

app.use('/api/auth', authRouter);
app.use('/api/wecom', wecomRouter);

// 权限相关接口（需登录）
app.get('/api/permissions', requireAuth, getUserPermissions);
app.get('/api/permissions/list', requireAuth, requireRole('admin'), getPermissions);
app.get('/api/modules', requireAuth, getModules);

// 角色管理接口（管理员专用）
app.use('/api/roles', rolesRouter);

// 业务接口（需登录）
app.use('/api/categories', requireAuth, categoriesRouter);
app.use('/api/ingredients', requireAuth, ingredientsRouter);
app.use('/api/purchase', requireAuth, purchaseRouter);
app.use('/api/departments', requireAuth, departmentsRouter);
app.use('/api/suppliers', requireAuth, suppliersRouter);

// 仓库管理接口（需登录）
app.use('/api/warehouses', requireAuth, warehousesRouter);
app.use('/api/inventory', requireAuth, inventoryRouter);
app.use('/api/stock-movements', requireAuth, stockMovementsRouter);

// 盘点管理接口（PC端需登录，H5端token免登录）
app.use('/api/stock-takes', stockTakesRouter);

// 仓库采购接口（部分接口不需要登录：confirm-page, confirm-submit, pdf下载）
app.use('/api/warehouse-purchases', warehousePurchasesRouter);

// 扫码领料接口（微信端部分不需登录：config, wx-login；PC端需登录）
app.use('/api/scan-requisition', scanRequisitionRouter);

// 管理报表接口（需登录）
app.use('/api/reports', requireAuth, reportsRouter);

// 体检套餐分享链接（免登录公开访问：查看详情 + PDF下载）
// ⚠️ 必须挂在 /api/booking requireAuth 之前！路径更长更具体的先注册，
//    否则 /api/booking 下的 requireAuth 会先拦截，导致客户未登录打不开分享链接
app.use('/api/booking/checkup-share', checkupTemplatesRouter.sharePublicRouter);

// 预订调度接口（需登录）
app.use('/api/booking', requireAuth, bookingBoardRouter);

// 体检销售套餐模板（需登录）
app.use('/api/booking/checkup-templates', requireAuth, checkupTemplatesRouter);

// 采购确认接口（部分接口不需要登录）
app.use('/api/purchase-confirmations', purchaseConfirmationsRouter);
app.use('/api/reconciliation', reconciliationRouter);
app.use('/api/user/signature', userSignaturesRouter);

// ================================================
// 外请人员打卡模块
// ================================================
// 微信端（外请人员，独立认证）
app.use('/api/temp/auth', tempAuthRouter);
app.use('/api/temp/checkins', tempCheckinsRouter); // 内含微信端 + 企微端接口

// 企微端（审核员/董事长，复用现有认证）
app.use('/api/temp/positions', tempPositionsRouter);
app.use('/api/temp/assessments', tempAssessmentsRouter);
app.use('/api/temp/stats', tempStatsRouter);

// PC管理端（管理员）
app.use('/api/temp/workers', tempWorkersRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Server running on http://127.0.0.1:${PORT}`);
});
