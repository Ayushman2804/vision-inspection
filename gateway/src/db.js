import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

const here = path.dirname(fileURLToPath(import.meta.url));

/** Idempotent schema bootstrap (CREATE ... IF NOT EXISTS), so a fresh Neon/Supabase DB just works. */
export async function migrate() {
  const sql = await fs.readFile(path.join(here, '..', 'db', 'init.sql'), 'utf8');
  await pool.query(sql);
}
