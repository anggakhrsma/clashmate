import { RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';

export const MYIP_COMMAND: RESTPostAPIApplicationCommandsJSONBody = {
  name: 'myip',
  description: 'Show the bot outbound IP (owner only)',
  dm_permission: true,
  default_member_permissions: '0'
};
