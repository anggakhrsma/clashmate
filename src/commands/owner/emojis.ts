import { AttachmentBuilder, CommandInteraction } from 'discord.js';
import { Args, Command } from '../../lib/handlers.js';

export default class EmojisCommand extends Command {
  public constructor() {
    super('emojis', {
      category: 'owner',
      ownerOnly: true,
      defer: true,
      ephemeral: true
    });
  }

  public args(): Args {
    return {};
  }

  public async exec(interaction: CommandInteraction<'cached'>) {
    const fetched = await interaction.guild.emojis.fetch();
    const emojis = fetched
      .filter((e) => !e.animated)
      .sort((a, b) => a.name!.localeCompare(b.name!));

    if (!emojis.size) {
      return interaction.editReply('No static emojis found in this server.');
    }

    const lines = emojis.map((e) => `'<:${e.name}:${e.id}>'`).join('\n');
    const content = `// ${interaction.guild.name} — ${emojis.size} emojis\n${lines}`;

    // If small enough, send inline; otherwise attach as file
    if (content.length <= 1900) {
      return interaction.editReply(`\`\`\`ts\n${content}\n\`\`\``);
    }

    const attachment = new AttachmentBuilder(Buffer.from(content, 'utf-8'), {
      name: `emojis-${interaction.guild.id}.txt`
    });

    return interaction.editReply({
      content: `**${emojis.size}** emojis found in **${interaction.guild.name}**`,
      files: [attachment]
    });
  }
}
