import { STATUS_CODES } from 'node:http';
import { loadConfig } from '@clashmate/config';
import { createDatabase } from '@clashmate/database';
import { createLogger } from '@clashmate/logger';
import Fastify, { type FastifyError } from 'fastify';

const config = loadConfig();
const logger = createLogger('api', config.LOG_LEVEL);
const database = createDatabase(config.DATABASE_URL);

const app = Fastify({
  loggerInstance: logger,
});

const serviceStatus = {
  service: 'api',
  version: '0.0.0',
} as const;

type BuildMetadata = {
  commitSha?: string;
  repositoryUrl?: string;
};

const createTimestamp = () => new Date().toISOString();

const createBuildMetadata = (env: NodeJS.ProcessEnv = process.env): BuildMetadata => {
  const { GIT_SHA: gitSha, SOURCE_REPOSITORY_URL: sourceRepositoryUrl } = env;
  const metadata: BuildMetadata = {};

  if (gitSha) {
    metadata.commitSha = gitSha;
  }

  if (sourceRepositoryUrl) {
    metadata.repositoryUrl = sourceRepositoryUrl;
  }

  return metadata;
};

const createServiceMetadata = (env: NodeJS.ProcessEnv = process.env) => ({
  ok: true,
  ...serviceStatus,
  timestamp: createTimestamp(),
  ...createBuildMetadata(env),
});

const getHttpMessage = (statusCode: number) => STATUS_CODES[statusCode] ?? 'Request failed';

app.setNotFoundHandler((request, reply) => {
  return reply.status(404).send({
    ok: false,
    ...serviceStatus,
    error: 'not_found',
    message: 'Route not found',
    path: request.url,
    timestamp: createTimestamp(),
  });
});

app.setErrorHandler((error: FastifyError, request, reply) => {
  const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  const safeStatusCode = statusCode < 500 ? statusCode : 500;
  const errorCode = safeStatusCode < 500 ? 'request_error' : 'internal_error';

  logger.error({ err: error, path: request.url, statusCode: safeStatusCode }, 'API request failed');

  return reply.status(safeStatusCode).send({
    ok: false,
    ...serviceStatus,
    error: errorCode,
    message: getHttpMessage(safeStatusCode),
    timestamp: createTimestamp(),
  });
});

const registerShutdownHandlers = (fastify: { close: () => Promise<void> }) => {
  let closing = false;

  const handleShutdown = (signal: NodeJS.Signals) => {
    if (closing) {
      logger.info({ signal }, 'API shutdown already in progress');
      return;
    }

    closing = true;
    logger.info({ signal }, 'API shutdown started');

    void fastify
      .close()
      .then(() => {
        logger.info({ signal }, 'API shutdown completed');
        process.exitCode = 0;
      })
      .catch((error: unknown) => {
        logger.error({ err: error, signal }, 'API shutdown failed');
        process.exitCode = 1;
      });
  };

  process.once('SIGTERM', handleShutdown);
  process.once('SIGINT', handleShutdown);
};

registerShutdownHandlers(app);

const startApi = async () => {
  const listenOptions = {
    host: '0.0.0.0',
    port: config.PORT,
  } as const;

  try {
    const address = await app.listen(listenOptions);

    logger.info({ address, ...listenOptions, service: serviceStatus.service }, 'API started');
  } catch (error) {
    logger.error(
      { err: error, ...listenOptions, service: serviceStatus.service },
      'API startup failed',
    );
    process.exitCode = 1;
    throw error;
  }
};

app.get('/', async () => {
  return createServiceMetadata();
});

app.get('/info', async () => {
  return createServiceMetadata();
});

app.get('/health', async () => {
  return {
    ok: true,
    ...serviceStatus,
  };
});

app.get('/live', async () => {
  return {
    ok: true,
    ...serviceStatus,
    timestamp: createTimestamp(),
  };
});

app.get('/ready', async (_request, reply) => {
  const timestamp = createTimestamp();

  try {
    await database.execute('select 1');

    return {
      ok: true,
      ...serviceStatus,
      database: 'ready',
      timestamp,
    };
  } catch (error) {
    logger.error({ err: error }, 'API readiness check failed');

    return reply.status(503).send({
      ok: false,
      ...serviceStatus,
      database: 'unavailable',
      timestamp,
    });
  }
});

await startApi();
