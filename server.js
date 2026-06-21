const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');
const path = require('path');
const db = require('./database');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const PORT = process.env.PORT || 3000;

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// ── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Auth routes ──────────────────────────────────────────────────────────────

app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email and password are required' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const hash = bcrypt.hashSync(password, 10);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, email.toLowerCase(), hash);

  const token = jwt.sign({ id: lastInsertRowid, name, email: email.toLowerCase() }, JWT_SECRET, {
    expiresIn: '7d',
  });
  res.status(201).json({ token, name });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'email and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({ token, name: user.name });
});

// ── RSVP routes ──────────────────────────────────────────────────────────────

app.post('/api/rsvp', requireAuth, async (req, res) => {
  const { id, name, email } = req.user;
  const plusOne = req.body.plusOne ? 1 : 0;

  const existing = db.prepare('SELECT id FROM rsvps WHERE user_id = ?').get(id);
  if (existing) return res.status(409).json({ error: 'You have already RSVPed' });

  db.prepare('INSERT INTO rsvps (user_id, plus_one) VALUES (?, ?)').run(id, plusOne);

  const { count } = db.prepare('SELECT SUM(1 + plus_one) as count FROM rsvps').get();

  // Send confirmation email (non-blocking — don't fail the response if email fails)
  if (resend) {
    resend.emails
      .send({
        from: FROM_EMAIL,
        to: email,
        subject: "You're on the list! — Annual Tech & Innovation Summit 2026",
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
            <div style="background:#2c3e8c;padding:32px;border-radius:8px 8px 0 0">
              <h1 style="color:#fff;margin:0;font-size:1.4rem">Annual Tech &amp; Innovation Summit 2026</h1>
            </div>
            <div style="background:#f9f9f9;padding:32px;border-radius:0 0 8px 8px;border:1px solid #eee;border-top:none">
              <p style="font-size:1rem">Hi <strong>${name}</strong>,</p>
              <p>Your RSVP is confirmed! We're looking forward to seeing you${plusOne ? ' and your guest' : ''}.</p>
              <table style="margin:24px 0;width:100%;border-collapse:collapse">
                <tr><td style="padding:8px 0;color:#555;width:90px">Date</td><td><strong>Saturday, August 15, 2026</strong></td></tr>
                <tr><td style="padding:8px 0;color:#555">Time</td><td><strong>10:00 AM – 5:00 PM</strong></td></tr>
                <tr><td style="padding:8px 0;color:#555">Location</td><td><strong>The Grand Hall, 45 Innovation Drive, Lagos</strong></td></tr>
              </table>
              <p style="color:#555;font-size:0.9rem">Questions? Reply to this email.</p>
            </div>
          </div>
        `,
      })
      .catch((err) => console.error('Email send failed:', err.message));
  }

  res.json({ message: 'RSVP confirmed', attendeeCount: count });
});

app.get('/api/rsvp/status', requireAuth, (req, res) => {
  const row = db.prepare('SELECT plus_one FROM rsvps WHERE user_id = ?').get(req.user.id);
  res.json({ hasRsvped: !!row, plusOne: row ? !!row.plus_one : false });
});

app.get('/api/attendee-count', (req, res) => {
  const { count } = db.prepare('SELECT SUM(1 + plus_one) as count FROM rsvps').get();
  res.json({ count: count || 0 });
});

// ── Catch-all: serve the SPA ─────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
