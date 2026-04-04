import { ApplicationCommandOptionType, RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import { command, common } from '../../src/util/locales.js';
import { translation, userInstallable } from './@helper.js';

export const HITRATE_COMMAND: RESTPostAPIApplicationCommandsJSONBody = {
  name: 'hitrate',
  description: 'View war attack history for a player (last 10 regular wars)',
  dm_permission: false,
  description_localizations: translation('command.hitrate.description'),
  options: [
    {
      name: 'tag',
      description: 'Player tag',
      description_localizations: translation('common.options.player.tag.description'),
      required: false,
      autocomplete: true,
      type: ApplicationCommandOptionType.String
    },
    {
      name: 'user',
      description: 'Discord user',
      description_localizations: translation('common.options.player.user.description'),
      type: ApplicationCommandOptionType.User,
      required: false
    }
  ],
  ...userInstallable
};