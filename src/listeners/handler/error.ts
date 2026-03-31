import {
  ActionRowBuilder,
  AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  Interaction,
  MessageFlags
} from 'discord.js';
import { inspect } from 'node:util';
import { Command, Listener } from '../../lib/handlers.js';

export default class ErrorListener extends Listener {
  public constructor() {
    super('commandHandlerError', {
      event: 'error',
      emitter: 'commandHandler',
      category: 'commandHandler'
    });
  }

  public async exec(
    error: Error,
    interaction: Exclude<Interaction, AutocompleteInteraction>,
    command: Command
  ) {
    const label = interaction.guild
      ? `${interaction.guild.name}/${interaction.user.displayName}`
      : `${interaction.user.displayName}`;

    this.client.logger.error(`${command?.id ?? 'unknown'} ~ ${error.toString()}`, { label });
    console.error(inspect(error, { depth: Infinity }));

    const content =
      interaction.inCachedGuild() && !interaction.channel
        ? 'Something went wrong while executing this command. (most likely the bot is missing **View Channel** permission in this channel)'
        : `${this.i18n('common.something_went_wrong', { lng: interaction.locale })}`;

    const message = {
      content,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(this.i18n('common.contact_support', { lng: interaction.locale }))
            .setURL(process.env.SUPPORT_SERVER_URL ?? 'https://discord.gg/clashmate')
        )
      ],
      flags: MessageFlags.Ephemeral
    } as const;

    try {
      if (!interaction.deferred) return await interaction.reply(message);
      return await interaction.followUp(message);
    } catch (err) {
      this.client.logger.error(`${(err as Error).toString()}`, { label: 'ERRORED' });
    }
  }
}
