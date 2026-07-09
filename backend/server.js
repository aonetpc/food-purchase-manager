const express = require('express');
const cors = require('cors');
const path = require('path');

const categoriesRouter = require('./routes/categories');
const ingredientsRouter = require('./routes/ingredients');
const purchaseRouter = require('./routes/purchase');
const authRouter = require('./routes/auth');
const departmentsRouter = require('./routes/departments');
const suppliersRouter = require('./routes/suppliers');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/categories', categoriesRouter);
app.use('/api/ingredients', ingredientsRouter);
app.use('/api/purchase', purchaseRouter);
app.use('/api/auth', authRouter);
app.use('/api/departments', departmentsRouter);
app.use('/api/suppliers', suppliersRouter);

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
