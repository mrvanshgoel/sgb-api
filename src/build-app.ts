// ─── Fastify App (buildApp) ──────────────────────────────────────────────
// App factory with dependency injection: every provider is swappable.
// Self-hosters can call buildApp() with their own implementations.

import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import type {
  SeriesProvider,
  LookupProvider,
  MarketPriceProvider,
  GoldProvider,
  SearchProvider,
} from './providers/interfaces.js';
import type { CacheProvider } from './cache/index.js';
import { registerRoutes } from './routes/index.js';

export interface AppDeps {
  seriesProvider: SeriesProvider;
  lookupProvider: LookupProvider;
  goldProvider: GoldProvider;
  searchProvider: SearchProvider;
  cacheProvider: CacheProvider;
}

import { logger, isDebug } from './utils/logger.js';

export async function buildApp(deps: AppDeps, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger !== undefined ? opts.logger : (isDebug ? true : false),
    disableRequestLogging: !isDebug,
    ajv: { customOptions: { coerceTypes: true, useDefaults: true } },
  });

  await app.register(helmet, {
    // Swagger UI needs inline scripts/styles
    contentSecurityPolicy: false,
  });
  await app.register(cors, { origin: true, methods: ['GET'] });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'SGB API',
        description:
          'Open-source Sovereign Gold Bond (SGB) API for India. ' +
          'Every value is traceable to an official source or explicitly null with a reason. ' +
          'No fabricated data, no price predictions.',
        version: '1.0.0',
        license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
      },
      tags: [
        { name: 'series', description: 'Static, verified SGB series data' },
        { name: 'lookup', description: 'Search and universal identifier lookup' },
        { name: 'market', description: 'Live market data (null-shaped when no source configured)' },
        { name: 'gold', description: 'Live gold price data (null-shaped when no source configured)' },
        { name: 'meta', description: 'Service metadata' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // Malformed request → structured 4xx; anything else → structured 500.
  // Missing DATA is never an error (null-shaped 200s handled in routes).
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) logger.error(error);
    reply.status(status).send({
      error: status >= 500 ? 'Internal Server Error' : error.name || 'Bad Request',
      message: status >= 500 ? 'An unexpected error occurred' : error.message,
      statusCode: status,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
      statusCode: 404,
    });
  });

  await registerRoutes(app, deps);

  return app;
}
