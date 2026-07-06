const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const cors = require('cors');
const os = require('os');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// CORS: allow any localhost origin on any port, plus an explicit allowlist
// Origin is called whenever an HTTP request is made, it determines whether or not to approve the 
// request based on rules set by the origin property.

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const localhostRegex = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
    if (localhostRegex.test(origin)) return callback(null, true);
    const allowed = [
      'http://192.168.1.7:5173',
      'https://syntheticsoul.me',
    ];
    if (allowed.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
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
  const server = app.listen(PORT, () => {
    console.log(`Server running at: http://${getLocalIP()}:${PORT}`);
  });
});