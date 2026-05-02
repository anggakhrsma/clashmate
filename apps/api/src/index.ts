import { loadConfig } from '@clashmate/config';
import { createDatabase } from '@clashmate/database';
import { createLogger } from '@clashmate/logger';
import Fastify from 'fastify';

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

await app.listen({
  host: '0.0.0.0',
  port: config.PORT,
});
