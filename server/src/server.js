const express = require('express');
const cors = require('cors');
const path = require('node:path');

const inventoryRoutes = require('./routes/inventory');
const mastersRoutes = require('./routes/masters');
const operationsRoutes = require('./routes/operations');
const crmRoutes = require('./routes/crm');
const financeRoutes = require('./routes/finance');
const whatsappRoutes = require('./routes/whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve API Routes
app.use('/api/inventory', inventoryRoutes);
app.use('/api/masters', mastersRoutes);
app.use('/api/operations', operationsRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'FPCC Cortex Core Engine',
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

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 FPCC Cortex Operations Engine Running on Port ${PORT}`);
  console.log(`🌐 Tablet PWA & Management Dashboard: http://localhost:${PORT}`);
  console.log(`📡 API Health: http://localhost:${PORT}/api/health`);
  console.log(`====================================================`);
});
