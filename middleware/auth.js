const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'No token provided' });

  jwt.verify(token, JWT_SECRET, (err) => {
    if (err) return res.status(401).json({ message: 'Invalid token' });
    next();
  });
}

module.exports = { requireAuth };
