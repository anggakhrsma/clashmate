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

type SafeErrorDiagnostics = {
  type: string;
  code?: string;
};

const createTimestamp = () => new Date().toISOString();

const getUptimeSeconds = () => Math.round(process.uptime());

const getDurationMs = (started: bigint) => Number((process.hrtime.bigint() - started) / 1_000_000n);

const getExitCode = () => process.exitCode ?? 0;

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

const hasBuildMetadata = (metadata: BuildMetadata) =>
  Boolean(metadata.commitSha || metadata.repositoryUrl);

const createRuntimeMetadata = (env: NodeJS.ProcessEnv = process.env) => {
  const build = createBuildMetadata(env);

  return {
    uptimeSeconds: getUptimeSeconds(),
    environment: config.NODE_ENV,
    buildMetadataPresent: hasBuildMetadata(build),
    ...build,
  };
};

const createSafeErrorDiagnostics = (error: unknown): SafeErrorDiagnostics => {
  if (error instanceof Error) {
    const diagnostics: SafeErrorDiagnostics = { type: error.name || 'Error' };

    if ('code' in error && typeof error.code === 'string' && error.code.length > 0) {
      diagnostics.code = error.code;
    }

    return diagnostics;
  }

  return { type: typeof error };
};

const createServiceMetadata = (env: NodeJS.ProcessEnv = process.env) => ({
  ok: true,
  ...serviceStatus,
  timestamp: createTimestamp(),
  ...createRuntimeMetadata(env),
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
  let shutdownSignal: NodeJS.Signals | undefined;

  const handleShutdown = (signal: NodeJS.Signals) => {
    if (closing) {
      logger.info(
        { signal, shutdownSignal, exitCode: getExitCode() },
        'API shutdown signal ignored while close is in progress',
      );
      return;
    }

    closing = true;
    shutdownSignal = signal;
    const started = process.hrtime.bigint();

    logger.info({ signal, exitCode: getExitCode() }, 'API shutdown started');

    void fastify
      .close()
      .then(() => {
        process.exitCode = 0;
        logger.info(
          { signal, closeDurationMs: getDurationMs(started), exitCode: process.exitCode },
          'API shutdown completed',
        );
      })
      .catch((error: unknown) => {
        process.exitCode = 1;
        logger.error(
          {
            err: error,
            signal,
            closeDurationMs: getDurationMs(started),
            exitCode: process.exitCode,
          },
          'API shutdown failed',
        );
      });
  };

  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);
};

registerShutdownHandlers(app);

const startApi = async () => {
  const listenOptions = {
    host: '0.0.0.0',
    port: config.PORT,
  } as const;
  const started = process.hrtime.bigint();
  const listenTarget = `${listenOptions.host}:${listenOptions.port}`;

  logger.info({ listenTarget, ...listenOptions, service: serviceStatus.service }, 'API starting');

  try {
    const address = await app.listen(listenOptions);

    logger.info(
      {
        address,
        listenTarget,
        startupDurationMs: getDurationMs(started),
        ...listenOptions,
        service: serviceStatus.service,
      },
      'API started',
    );
  } catch (error) {
    process.exitCode = 1;
    logger.error(
      {
        err: error,
        listenTarget,
        startupDurationMs: getDurationMs(started),
        exitCode: process.exitCode,
        ...listenOptions,
        service: serviceStatus.service,
      },
      'API startup failed',
    );
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
    uptimeSeconds: getUptimeSeconds(),
    environment: config.NODE_ENV,
    buildMetadataPresent: hasBuildMetadata(createBuildMetadata()),
  };
});

app.get('/live', async () => {
  return {
    ok: true,
    ...serviceStatus,
    timestamp: createTimestamp(),
    uptimeSeconds: getUptimeSeconds(),
    environment: config.NODE_ENV,
    buildMetadataPresent: hasBuildMetadata(createBuildMetadata()),
  };
});

app.get('/ready', async (_request, reply) => {
  const timestamp = createTimestamp();
  const started = process.hrtime.bigint();

  try {
    await database.execute('select 1');
    const durationMs = getDurationMs(started);

    return {
      ok: true,
      ...serviceStatus,
      database: 'ready',
      timestamp,
      uptimeSeconds: getUptimeSeconds(),
      environment: config.NODE_ENV,
      buildMetadataPresent: hasBuildMetadata(createBuildMetadata()),
      readyCheckDurationMs: durationMs,
    };
  } catch (error) {
    const durationMs = getDurationMs(started);
    logger.error({ err: error }, 'API readiness check failed');

    return reply.status(503).send({
      ok: false,
      ...serviceStatus,
      database: 'unavailable',
      timestamp,
      uptimeSeconds: getUptimeSeconds(),
      environment: config.NODE_ENV,
      buildMetadataPresent: hasBuildMetadata(createBuildMetadata()),
      readyCheckDurationMs: durationMs,
      error: createSafeErrorDiagnostics(error),
    });
  }
});

await startApi();
