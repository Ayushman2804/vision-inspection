/**
 * Deletes image files in UPLOAD_DIR that no inspection points to (left over from seed resets,
 * manual DB edits or crashes). Optionally prunes old Live video frame images.
 *
 *   docker compose exec gateway npm run cleanup-uploads -- --dry-run
 *   docker compose exec gateway npm run cleanup-uploads
 *   docker compose exec gateway npm run cleanup-uploads -- --prune-video-days 30
 *
 * Options:
 *   --dry-run               list what would be deleted, delete nothing
 *   --grace-minutes N       skip files newer than N minutes (default 10), so an upload that is
 *                           written to disk but not yet committed to the DB is never touched
 *   --prune-video-days N    also drop the stored image (file + image_path) of video-frame
 *                           inspections older than N days; the inspection rows and defects stay
 *
 * Works across all users on purpose (files are shared storage), so it is a CLI, not an API route.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const dryRun = process.argv.includes('--dry-run');
const graceMinutes = Number(arg('grace-minutes', 10));
const pruneVideoDays = arg('prune-video-days', null);
if (!Number.isFinite(graceMinutes) || graceMinutes < 0) throw new Error('--grace-minutes must be >= 0');
if (pruneVideoDays !== null && !(Number(pruneVideoDays) >= 1)) throw new Error('--prune-video-days must be >= 1');

const verb = dryRun ? 'Would delete' : 'Deleted';

/** Clears image_path on old video inspections; the orphan sweep below then deletes their files. */
async function pruneVideoFrames(days) {
  const old = `SELECT id, image_path FROM inspections
               WHERE source = 'video' AND image_path IS NOT NULL AND created_at < now() - make_interval(days => $1)`;
  const { rows } = dryRun
    ? await pool.query(old, [days])
    : await pool.query(
        `WITH old AS (${old})
         UPDATE inspections i SET image_path = NULL FROM old WHERE i.id = old.id
         RETURNING old.image_path`,
        [days],
      );
  return rows.map((r) => path.basename(r.image_path));
}

async function main() {
  let pruned = [];
  if (pruneVideoDays !== null) {
    pruned = await pruneVideoFrames(Number(pruneVideoDays));
    console.log(
      `${dryRun ? 'Would clear' : 'Cleared'} the image of ${pruned.length} video inspection(s) older than ${pruneVideoDays} day(s)`,
    );
  }

  let names;
  try {
    names = await fs.readdir(config.uploadDir);
  } catch (e) {
    if (e.code === 'ENOENT') return console.log(`No upload dir at ${config.uploadDir}; nothing to do`);
    throw e;
  }

  const { rows } = await pool.query('SELECT image_path FROM inspections WHERE image_path IS NOT NULL');
  const referenced = new Set(rows.map((r) => path.basename(r.image_path)));
  for (const name of pruned) referenced.delete(name); // dry run: rows still point at them
  const cutoff = Date.now() - graceMinutes * 60_000;

  let removed = 0;
  let bytes = 0;
  let skippedNew = 0;
  for (const name of names) {
    if (referenced.has(name)) continue;
    const file = path.join(config.uploadDir, name);
    const st = await fs.stat(file);
    if (!st.isFile()) continue;
    if (st.mtimeMs > cutoff) {
      skippedNew += 1;
      continue;
    }
    if (dryRun) console.log(`  ${name}`);
    else await fs.rm(file, { force: true });
    removed += 1;
    bytes += st.size;
  }

  console.log(
    `${verb} ${removed} orphaned file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB ` +
      `(${names.length} files scanned, ${referenced.size} referenced, ${skippedNew} newer than ${graceMinutes} min skipped)`,
  );
}

try {
  await main();
} finally {
  await pool.end();
}
