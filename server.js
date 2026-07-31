const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const cors = require('cors');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '127.0.0.1';

// CORS: allow any localhost origin on any port, plus an explicit allowlist
// Origin is called whenever an HTTP request is made, it determines whether or not to approve the 
// request based on rules set by the origin property.

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const localhostRegex = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.1\.163)(?::\d+)?$/i;
    if (localhostRegex.test(origin)) return callback(null, true);
    const allowed = [
      'https://syntheticsoul.me',
    ];
    if (allowed.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], 
  credentials: true,
  optionsSuccessStatus: 200,
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Base Routes
app.use('/api/posts', require('./routes/public/posts'));
app.use('/api/soul', require('./routes/public/soul'));
app.use('/api/body', require('./routes/public/body'));
app.use('/api/audio', require('./routes/public/audio'));
app.use('/api/images', require('./routes/public/images'));
app.use('/api/system', require('./routes/public/system'));

// Start server after DB connects
connectDB().then(() => {
  const server = app.listen(PORT, HOST, () => {
    console.log(`Server running at: http://${HOST}:${PORT}`);
  });
});