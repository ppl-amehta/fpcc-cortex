const express = require('express');
const cors = require('cors');
const path = require('node:path');

const requestLogger = require('./middleware/logger');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const bomRoutes = require('./routes/bom');
const purchasingRoutes = require('./routes/purchasing');
const inventoryRoutes = require('./routes/inventory');
const mastersRoutes = require('./routes/masters');
const operationsRoutes = require('./routes/operations');
const crmRoutes = require('./routes/crm');
const financeRoutes = require('./routes/finance');
const whatsappRoutes = require('./routes/whatsapp');
const reportsRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(requestLogger);

// Mount API Modules
app.use('/api/auth', authRoutes);
app.use('/api/bom', bomRoutes);
app.use('/api/purchasing', purchasingRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/masters', mastersRoutes);
app.use('/api/operations', operationsRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/reports', reportsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'FPCC Cortex Enterprise Core Engine',
    version: '2.0.0-industrial',
    timestamp: new Date().toISOString()
  });
});

// Serve Floor PWA Frontend
const publicPath = path.resolve(__dirname, '../public');
app.use(express.static(publicPath));

// Fallback to index.html for SPA/PWA
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Global Error Handler (RFC-7807 format)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 FPCC Cortex Enterprise Engine Running on Port ${PORT}`);
  console.log(`🌐 Tablet PWA & Management Dashboard: http://localhost:${PORT}`);
  console.log(`📡 API Health: http://localhost:${PORT}/api/health`);
  console.log(`====================================================`);
});
