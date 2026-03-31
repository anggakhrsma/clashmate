import { RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';

export const EMOJIS_COMMAND: RESTPostAPIApplicationCommandsJSONBody = {
  name: 'emojis',
  description: 'List all static emojis in this server (owner only)',
  dm_permission: false,
  default_member_permissions: '0'
};
