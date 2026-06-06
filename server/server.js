require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'darvia_secret_key_123';

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Middleware to authenticate JWT
const authenticateToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  });
};

// Generate 6-digit ID
const generateBankId = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// --- Auth Routes ---

app.post('/api/register', async (req, res) => {
  const { full_name, dob, password, confirm_password, phone, email, terms_accepted } = req.body;

  if (!full_name || !dob || !password || !confirm_password || !phone || !email) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (password !== confirm_password) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  if (!terms_accepted) {
    return res.status(400).json({ error: 'You must accept the Terms of Service' });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const id = generateBankId();

    db.run(
      `INSERT INTO users (id, email, password_hash, full_name, dob, phone) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, email, password_hash, full_name, dob, phone],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already registered' });
          }
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: 'User registered', id });
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(400).json({ error: 'User not found' });

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(400).json({ error: 'Invalid password' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
    res.cookie('token', token, { httpOnly: true });
    res.json({ message: 'Logged in', id: user.id });
  });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

// --- Bank Routes ---

app.get('/api/user', authenticateToken, (req, res) => {
  db.get(`SELECT id, email, full_name, balance, latest_transaction FROM users WHERE id = ?`, [req.user.id], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(user);
  });
});

app.post('/api/transfer', authenticateToken, (req, res) => {
  const { recipient_id, amount } = req.body;
  const amt = parseFloat(amount);

  if (!recipient_id || isNaN(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Invalid recipient or amount' });
  }

  if (recipient_id === req.user.id) {
    return res.status(400).json({ error: 'Cannot transfer to yourself' });
  }

  // Check if sender has enough balance
  db.get(`SELECT balance FROM users WHERE id = ?`, [req.user.id], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (user.balance < amt) return res.status(400).json({ error: 'Insufficient funds' });

    // Check if recipient exists
    db.get(`SELECT id FROM users WHERE id = ?`, [recipient_id], (err, recipient) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

      // Create pending transfer
      db.run(
        `INSERT INTO transfers (sender_id, recipient_id, amount, status) VALUES (?, ?, ?, ?)`,
        [req.user.id, recipient_id, amt, 'pending'],
        function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: 'Transfer initiated. Waiting for recipient to accept.' });
        }
      );
    });
  });
});

app.get('/api/transfers/pending', authenticateToken, (req, res) => {
  db.all(
    `SELECT t.id, t.amount, u.full_name as sender_name 
     FROM transfers t 
     JOIN users u ON t.sender_id = u.id 
     WHERE t.recipient_id = ? AND t.status = 'pending'`,
    [req.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.post('/api/transfers/respond', authenticateToken, (req, res) => {
  const { transfer_id, action } = req.body; // action: 'accept' or 'decline'

  db.get(
    `SELECT t.*, s.full_name as sender_name, r.full_name as recipient_name 
     FROM transfers t 
     JOIN users s ON t.sender_id = s.id 
     JOIN users r ON t.recipient_id = r.id 
     WHERE t.id = ? AND t.recipient_id = ? AND t.status = 'pending'`, 
    [transfer_id, req.user.id], 
    (err, transfer) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!transfer) return res.status(404).json({ error: 'Transfer not found or already processed' });

      if (action === 'decline') {
        db.run(`UPDATE transfers SET status = 'declined' WHERE id = ?`, [transfer_id], (err) => {
          if (err) return res.status(500).json({ error: err.message });
          return res.json({ message: 'Transfer declined' });
        });
      } else if (action === 'accept') {
        // Atomic transaction for the transfer
        db.serialize(() => {
          db.run("BEGIN TRANSACTION");

          // Double check sender balance again
          db.get(`SELECT balance FROM users WHERE id = ?`, [transfer.sender_id], (err, sender) => {
            if (err || sender.balance < transfer.amount) {
              db.run("ROLLBACK");
              return res.status(400).json({ error: 'Sender no longer has sufficient funds' });
            }

            // Update sender
            db.run(`UPDATE users SET balance = balance - ?, latest_transaction = ? WHERE id = ?`, 
              [transfer.amount, `Sent £${transfer.amount} to ${transfer.recipient_name}`, transfer.sender_id]);

            // Update recipient
            db.run(`UPDATE users SET balance = balance + ?, latest_transaction = ? WHERE id = ?`, 
              [transfer.amount, `Received £${transfer.amount} from ${transfer.sender_name}`, transfer.recipient_id]);

            // Update transfer status
            db.run(`UPDATE transfers SET status = 'accepted' WHERE id = ?`, [transfer_id]);

            db.run("COMMIT", (err) => {
              if (err) return res.status(500).json({ error: 'Transaction failed' });
              res.json({ message: 'Transfer accepted and processed' });
            });
          });
        });
      } else {
        res.status(400).json({ error: 'Invalid action' });
      }
    }
  );
});

app.listen(PORT, () => {
  console.log(`National Bank of Darvia server running on http://localhost:${PORT}`);
});
