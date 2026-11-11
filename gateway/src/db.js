import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';

/**
 * DB_SSL: false (local Docker) | true (TLS, certificate verified; Neon) |
 * no-verify (TLS without verifying the certificate; only for providers whose CA isn't publicly trusted).
 */
export function sslOptions(mode) {
  if (mode === 'true') return { rejectUnauthorized: true };
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  return undefined;
}

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: sslOptions(config.dbSsl),
  max: 10,
});

const here = path.dirname(fileURLToPath(import.meta.url));

/** Idempotent schema bootstrap (CREATE ... IF NOT EXISTS), so a fresh Neon/Supabase DB just works. */
export async function migrate() {
  const sql = await fs.readFile(path.join(here, '..', 'db', 'init.sql'), 'utf8');
  await pool.query(sql);
}
