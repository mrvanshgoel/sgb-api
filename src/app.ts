// ─── Entry Point ─────────────────────────────────────────────────────────

import { config } from './config/index.js';
import { buildApp } from './build-app.js';
import { buildDefaultDeps } from './container.js';
import { logger } from './utils/logger.js';

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
    logger.info(`Server started on port ${config.port}`);
  } catch (err) {
    logger.error(err as Error);
    process.exit(1);
  }
}

main();
