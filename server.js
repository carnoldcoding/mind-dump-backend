const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const cors = require('cors');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors());

// Base Routes
app.use('/api/posts', require('./routes/public/posts'));

// Start server after DB connects
connectDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});