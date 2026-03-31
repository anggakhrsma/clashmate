import { RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';

export const SYNC_EMOJIS_COMMAND: RESTPostAPIApplicationCommandsJSONBody = {
  name: 'sync-emojis',
  description: 'Scan all servers and sync emoji IDs into emojis.ts (owner only)',
  dm_permission: true,
  default_member_permissions: '0'
};
