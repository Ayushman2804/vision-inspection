import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/inspection',
  dbSsl: (process.env.DB_SSL || 'false').trim().toLowerCase(), // false | true (verified) | no-verify
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  // false closes sign-up (POST /api/auth/register returns 403); existing accounts can still sign in.
  allowRegistration: (process.env.ALLOW_REGISTRATION || 'true').trim().toLowerCase() !== 'false',
  inferenceUrl: (process.env.INFERENCE_URL || 'http://localhost:8000').replace(/\/$/, ''),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()),
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  alertWindow: Number(process.env.ALERT_WINDOW || 20),
  alertThreshold: Number(process.env.ALERT_THRESHOLD || 0.5),
  alertCooldownSec: Number(process.env.ALERT_COOLDOWN_SEC || 60),
};

if (isProd && config.jwtSecret === 'dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
