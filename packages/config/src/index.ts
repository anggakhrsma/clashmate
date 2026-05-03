import 'dotenv/config';
import { z } from 'zod';

const discordSnowflakePattern = /^\d{17,20}$/;

const commaSeparatedDiscordOwnerIds = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )
  .refine((ids) => ids.every((id) => discordSnowflakePattern.test(id)), {
    message: 'Discord owner IDs must be decimal strings with 17 to 20 digits',
  });

const requiredTrimmedString = z.string().trim().min(1);

const acceptedLogLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

const logLevel = z
  .string()
  .trim()
  .default('info')
  .refine((value) => acceptedLogLevels.includes(value), {
    message: 'Invalid log level. Expected one of: trace, debug, info, warn, error, fatal, silent',
  });

const isValidTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
};

const defaultTimeZone = z
  .string()
  .trim()
  .default('UTC')
  .refine((value) => value.length > 0, {
    message: 'Default timezone must be a non-blank IANA timezone identifier',
  })
  .refine(isValidTimeZone, {
    message: 'Default timezone must be a valid IANA timezone identifier',
  });

const isPostgresqlDatabaseUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  } catch {
    return false;
  }
};

const postgresqlDatabaseUrl = z
  .string()
  .trim()
  .min(1, { message: 'PostgreSQL database URL is required' })
  .refine(isPostgresqlDatabaseUrl, {
    message: 'Expected a valid PostgreSQL database URL using postgres: or postgresql: protocol',
  });

const optionalPostgresqlDatabaseUrl = z.preprocess((value) => {
  if (typeof value !== 'string') return value;

  const trimmedValue = value.trim();
  return trimmedValue.length === 0 ? undefined : trimmedValue;
}, postgresqlDatabaseUrl.optional());

const optionalUrl = z.preprocess((value) => {
  if (typeof value !== 'string') return value;

  const trimmedValue = value.trim();
  return trimmedValue.length === 0 ? undefined : trimmedValue;
}, z.string().url().optional());

const isHttpPublicBaseUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const publicBaseUrl = z
  .string()
  .trim()
  .min(1, { message: 'Public base URL must be a non-blank HTTP/HTTPS URL' })
  .refine(isHttpPublicBaseUrl, {
    message: 'Public base URL must be a valid HTTP/HTTPS URL',
  })
  .default('http://localhost:3000');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: logLevel,
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  PUBLIC_BASE_URL: publicBaseUrl,

  DISCORD_TOKEN: requiredTrimmedString,
  DISCORD_CLIENT_ID: requiredTrimmedString,
  DISCORD_OWNER_IDS: commaSeparatedDiscordOwnerIds,

  CLASH_OF_CLANS_API_TOKEN: requiredTrimmedString,

  DATABASE_URL: postgresqlDatabaseUrl,
  TEST_DATABASE_URL: optionalPostgresqlDatabaseUrl,

  COMMAND_REGISTRATION: z.enum(['global']).default('global'),
  DEFAULT_TIMEZONE: defaultTimeZone,

  POLL_CLAN_SECONDS: z.coerce.number().int().positive().default(300),
  POLL_CLAN_JITTER_SECONDS: z.coerce.number().int().nonnegative().default(60),
  POLL_PLAYER_SECONDS: z.coerce.number().int().positive().default(900),
  POLL_PLAYER_JITTER_SECONDS: z.coerce.number().int().nonnegative().default(180),
  POLL_WAR_SECONDS: z.coerce.number().int().positive().default(120),
  POLL_WAR_JITTER_SECONDS: z.coerce.number().int().nonnegative().default(30),
  NOTIFICATION_FANOUT_SECONDS: z.coerce.number().int().positive().default(30),
  NOTIFICATION_FANOUT_JITTER_SECONDS: z.coerce.number().int().nonnegative().default(10),
  NOTIFICATION_FANOUT_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(100),
  NOTIFICATION_DELIVERY_SECONDS: z.coerce.number().int().positive().default(15),
  NOTIFICATION_DELIVERY_JITTER_SECONDS: z.coerce.number().int().nonnegative().default(5),
  NOTIFICATION_DELIVERY_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(50),
  NOTIFICATION_DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  NOTIFICATION_DELIVERY_RETRY_SECONDS: z.coerce.number().int().positive().default(30),

  SENTRY_DSN: optionalUrl,
});

export type ClashMateConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ClashMateConfig {
  return envSchema.parse(env);
}
