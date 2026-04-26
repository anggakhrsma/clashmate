import 'dotenv/config';
import { z } from 'zod';

const commaSeparatedIds = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),

  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_OWNER_IDS: commaSeparatedIds,

  CLASH_OF_CLANS_API_TOKEN: z.string().min(1),

  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),

  COMMAND_REGISTRATION: z.enum(['global']).default('global'),
  DEFAULT_TIMEZONE: z.string().default('UTC'),

  POLL_CLAN_SECONDS: z.coerce.number().int().positive().default(300),
  POLL_CLAN_JITTER_SECONDS: z.coerce.number().int().nonnegative().default(60),
  POLL_PLAYER_SECONDS: z.coerce.number().int().positive().default(900),
  POLL_PLAYER_JITTER_SECONDS: z.coerce.number().int().nonnegative().default(180),
  POLL_WAR_SECONDS: z.coerce.number().int().positive().default(120),
  POLL_WAR_JITTER_SECONDS: z.coerce.number().int().nonnegative().default(30),

  SUPPORT_GUILD_ID: z.string().optional(),
  SUGGESTIONS_FORUM_CHANNEL_ID: z.string().optional(),

  SENTRY_DSN: z.string().url().optional(),
});

export type ClashMateConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ClashMateConfig {
  return envSchema.parse(env);
}
