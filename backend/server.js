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

const { requireAuth, getUserPermissions, getRoles, getPermissions, getModules, requireRole } = require('./middleware/rbac');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/wecom', wecomRouter);

// 权限相关接口（需登录）
app.get('/api/permissions', requireAuth, getUserPermissions);
app.get('/api/permissions/list', requireAuth, requireRole('admin'), getPermissions);
app.get('/api/roles', requireAuth, requireRole('admin'), getRoles);
app.get('/api/modules', requireAuth, getModules);

// 业务接口（需登录）
app.use('/api/categories', requireAuth, categoriesRouter);
app.use('/api/ingredients', requireAuth, ingredientsRouter);
app.use('/api/purchase', requireAuth, purchaseRouter);
app.use('/api/departments', requireAuth, departmentsRouter);
app.use('/api/suppliers', requireAuth, suppliersRouter);
app.use('/api/purchase-confirmations', requireAuth, purchaseConfirmationsRouter);

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
