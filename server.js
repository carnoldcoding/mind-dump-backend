const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const cors = require('cors');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const corsOptions = {
    origin: [
      'http://localhost:5173',  
      'http://127.0.0.1:5173', 
      'http://192.168.1.7:5173',
      'http://localhost:4173',
      'https://syntheticsoul.me/',
      'https://react-refactor.mind-dump-e5i.pages.dev/'
    ],
    credentials: true,
    optionsSuccessStatus: 200
  };

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Base Routes
app.use('/api/posts', require('./routes/public/posts'));

// Start server after DB connects
connectDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});