import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { pool } from '../db.js';
import { config } from '../config.js';
import { HttpError, asyncHandler } from '../utils.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sign = (user) =>
  jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, { expiresIn: '12h' });

function validate(body) {
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Valid email required');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  return { email, password };
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password } = validate(req.body);
    const hash = await bcrypt.hash(password, 10);
    try {
      const { rows } = await pool.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, role',
        [email, hash],
      );
      res.status(201).json({ token: sign(rows[0]), user: rows[0] });
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'Email already registered');
      throw e;
    }
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = validate(req.body);
    const { rows } = await pool.query('SELECT id, email, role, password_hash FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new HttpError(401, 'Invalid email or password');
    }
    res.json({ token: sign(user), user: { id: user.id, email: user.email, role: user.role } });
  }),
);

export default router;
