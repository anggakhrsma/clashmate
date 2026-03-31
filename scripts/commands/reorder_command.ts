import { ApplicationCommandOptionType, RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';

export const REORDER_COMMAND: RESTPostAPIApplicationCommandsJSONBody = {
  name: 'reorder',
  description: 'Reorder clans or categories for this server',
  dm_permission: false,
  default_member_permissions: '32', // ManageGuild
  options: [
    {
      name: 'type',
      description: 'What to reorder',
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: [
        { name: 'Clans', value: 'clans' },
        { name: 'Categories', value: 'categories' }
      ]
    }
  ]
};
