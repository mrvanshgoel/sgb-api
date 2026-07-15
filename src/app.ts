// ─── Entry Point ─────────────────────────────────────────────────────────

import { config } from './config/index.js';
import { buildApp } from './build-app.js';
import { buildDefaultDeps } from './container.js';

async function main(): Promise<void> {
  const deps = await buildDefaultDeps();
  const app = await buildApp(deps);

  const close = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`SGB API listening on ${config.host}:${config.port} — docs at /docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
