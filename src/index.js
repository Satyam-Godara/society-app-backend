// const express = require('express');
// const cors = require('cors');
// require('dotenv').config();

// const app = express();
// app.use(cors());
// app.use(express.json());

// // Health check
// app.get('/health', (req, res) => {
//   res.json({ status: 'ok', app: 'Society App API' });
// });

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });


// require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
// const express = require('express');
// const cors = require('cors');

// const app = express();
// app.use(cors());
// app.use(express.json());

// // Routes
// app.use('/api/auth',       require('./routes/auth'));
// app.use('/api/bills',      require('./routes/bills'));
// app.use('/api/visitors',   require('./routes/visitors'));
// app.use('/api/complaints', require('./routes/complaints'));
// app.use('/api/notices',    require('./routes/notices'));
// app.use('/api/ai', require('./routes/ai'));
// app.use('/api/payments', require('./routes/payments'));

// // Health check
// app.get('/health', (req, res) => {
//   res.json({ status: 'ok', app: 'Society App API', version: '1.0.0' });
// });

// // 404 handler
// app.use((req, res) => {
//   res.status(404).json({ error: `Route ${req.path} not found` });
// });

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Society App API running on port ${PORT}`);
// });


require('dotenv').config({
  path: require('path').resolve(__dirname, '../.env')
});
const express = require('express');
const cors    = require('cors');

const app = express();

// Security & parsing
app.use(cors({
  origin: '*', // tighten this after MVP
  methods: ['GET','POST','PUT','DELETE'],
}));
app.use(express.json({ limit: '10mb' }));

// Simple request logger (helps debug production issues)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// Routes
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/bills',      require('./routes/bills'));
app.use('/api/visitors',   require('./routes/visitors'));
app.use('/api/complaints', require('./routes/complaints'));
app.use('/api/notices',    require('./routes/notices'));
app.use('/api/ai',         require('./routes/ai'));
app.use('/api/payments',   require('./routes/payments'));

// Health check — Railway uses this to confirm app is running
app.get('/health', (req, res) => {
  res.json({
    status:  'ok',
    app:     'Society App API',
    version: '1.0.0',
    time:    new Date().toISOString(),
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.path} not found` });
});

// Global error handler — catches any unhandled errors
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Society App API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});