// ─── Entry Point ─────────────────────────────────────────────────────────

import { config } from './config/index.js';
import { buildApp } from './build-app.js';
import { buildDefaultDeps } from './container.js';
import { logger } from './utils/logger.js';
import { initNseTransport } from './providers/market/nse/transport.js';

async function main(): Promise<void> {
  // Validate outbound-networking config up front and log the active transport
  // mode. Throws on invalid config so we fail fast instead of 403-ing later.
  initNseTransport();

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
