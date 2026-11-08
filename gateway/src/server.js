import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db.js';

async function main() {
  await migrate();
  const app = createApp();
  app.listen(config.port, () => console.log(`Gateway listening on :${config.port} -> inference ${config.inferenceUrl}`));
}

main().catch((err) => {
  console.error('Failed to start gateway', err);
  process.exit(1);
});
