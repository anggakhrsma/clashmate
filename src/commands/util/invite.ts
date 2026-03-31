import { Settings, getInviteLink } from '@app/constants';
import { CommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from '../../lib/handlers.js';

export default class InviteCommand extends Command {
  public constructor() {
    super('invite', {
      category: 'config',
      channel: 'dm',
      defer: false
    });
  }

  public exec(interaction: CommandInteraction) {
    const additionalTexts: string[] = [];

    const embed = new EmbedBuilder()
      .setAuthor({
        name: this.client.user.displayName,
        iconURL: this.client.user.displayAvatarURL({ extension: 'png' })
      })
      .setDescription(
        [
          'ClashPerk can be added to as many servers as you want! Please share the bot with your friends. Thanks in advance!',
          '',
          `**[Add to Discord](${getInviteLink(this.client.user.id)})**`,
          '',
          '**[Support Server](https://discord.gg/ppuppun)** | **[Subscribe on Patreon](https://www.patreon.com/clashperk)**',
          '',
          additionalTexts.join('\n')
        ].join('\n')
      );
    return interaction.reply(
      interaction.inCachedGuild()
        ? { embeds: [embed], flags: MessageFlags.Ephemeral }
        : { embeds: [embed] }
    );
  }
}
