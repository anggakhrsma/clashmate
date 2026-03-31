import { Collections, Settings } from '@app/constants';
import {
  ActionRowBuilder,
  CommandInteraction,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction
} from 'discord.js';
import { Args, Command } from '../../lib/handlers.js';

export default class ReorderCommand extends Command {
  public constructor() {
    super('reorder', {
      category: 'setup',
      channel: 'guild',
      userPermissions: ['ManageGuild'],
      clientPermissions: ['EmbedLinks'],
      defer: true,
      ephemeral: true
    });
  }

  public args(): Args {
    return {
      type: { match: 'STRING' }
    };
  }

  public async exec(
    interaction: CommandInteraction<'cached'> | StringSelectMenuInteraction<'cached'>,
    args: { type?: string; first?: string; second?: string }
  ) {
    const type = args.type ?? 'clans';
    if (type === 'clans') return this.reorderClans(interaction, args);
    if (type === 'categories') return this.reorderCategories(interaction, args);
  }

  // ── Clans ──────────────────────────────────────────────────────────────────

  private async reorderClans(
    interaction: CommandInteraction<'cached'> | StringSelectMenuInteraction<'cached'>,
    args: { first?: string; second?: string }
  ) {
    const col = this.client.db.collection(Collections.CLAN_STORES);

    // first = clan tag being moved, second = target position (as string number)
    if (args.first && args.second) {
      const clans = await col
        .find({ guild: interaction.guildId })
        .sort({ order: 1, name: 1 })
        .toArray();

      const fromIdx = clans.findIndex((c) => c.tag === args.first);
      const toIdx = parseInt(args.second) - 1;

      if (fromIdx === -1 || toIdx < 0 || toIdx >= clans.length) {
        return interaction.editReply('Invalid selection.');
      }

      // Remove from current position and insert at target
      const [moved] = clans.splice(fromIdx, 1);
      clans.splice(toIdx, 0, moved);

      // Save new order
      await Promise.all(
        clans.map((c, i) => col.updateOne({ _id: c._id }, { $set: { order: i + 1 } }))
      );
      await this.client.settings.set(interaction.guildId, Settings.CLANS_SORTING_KEY, 'order');
      args.first = undefined; // reset to step 1
    }

    const updated = await col
      .find({ guild: interaction.guildId })
      .sort({ order: 1, name: 1 })
      .toArray();

    if (!updated.length) return interaction.editReply('No clans linked to this server.');

    const footer = 'Step 1: Select a clan to move.';

    const embed = new EmbedBuilder()
      .setTitle('Reorder Clans')
      .setDescription(updated.map((c, i) => `**${i + 1}.** ${c.name} \`${c.tag}\``).join('\n'))
      .setFooter({ text: footer });

    if (!args.first) {
      // Step 1 — pick clan
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(this.createId({ cmd: this.id, type: 'clans', string_key: 'first' }))
          .setPlaceholder('Select a clan to move...')
          .setOptions(
            updated.slice(0, 25).map((c, i) => ({
              label: `${i + 1}. ${c.name}`,
              value: c.tag,
              description: c.tag
            }))
          )
      );
      return interaction.editReply({ embeds: [embed], components: [row] });
    }

    // Step 2 — pick position
    const clanName = updated.find((c) => c.tag === args.first)?.name ?? args.first;
    embed.setFooter({ text: `Step 2: Where should "${clanName}" go?` });

    const positions = updated.map((c, i) => ({
      label: `Position ${i + 1}${c.tag === args.first ? ' (current)' : ` — before ${c.name}`}`,
      value: String(i + 1)
    }));

    // Also add last position
    positions[positions.length - 1] = {
      label: `Position ${updated.length} — last`,
      value: String(updated.length)
    };

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(
          this.createId({ cmd: this.id, type: 'clans', first: args.first, string_key: 'second' })
        )
        .setPlaceholder(`Move "${clanName}" to position...`)
        .setOptions(positions.slice(0, 25))
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  }

  // ── Categories ─────────────────────────────────────────────────────────────

  private async reorderCategories(
    interaction: CommandInteraction<'cached'> | StringSelectMenuInteraction<'cached'>,
    args: { first?: string; second?: string }
  ) {
    const col = this.client.db.collection(Collections.CLAN_CATEGORIES);

    if (args.first && args.second) {
      const cats = await col.find({ guildId: interaction.guildId }).sort({ order: 1 }).toArray();

      const fromIdx = cats.findIndex((c) => c._id.toHexString() === args.first);
      const toIdx = parseInt(args.second) - 1;

      if (fromIdx === -1 || toIdx < 0 || toIdx >= cats.length) {
        return interaction.editReply('Invalid selection.');
      }

      const [moved] = cats.splice(fromIdx, 1);
      cats.splice(toIdx, 0, moved);

      await Promise.all(
        cats.map((c, i) => col.updateOne({ _id: c._id }, { $set: { order: i + 1 } }))
      );
      args.first = undefined; // reset to step 1
    }

    const updated = await col.find({ guildId: interaction.guildId }).sort({ order: 1 }).toArray();

    if (!updated.length) return interaction.editReply('No categories found.');

    const footer = 'Step 1: Select a category to move.';

    const embed = new EmbedBuilder()
      .setTitle('Reorder Categories')
      .setDescription(updated.map((c, i) => `**${i + 1}.** ${c.name}`).join('\n'))
      .setFooter({ text: footer });

    if (!args.first) {
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(this.createId({ cmd: this.id, type: 'categories', string_key: 'first' }))
          .setPlaceholder('Select a category to move...')
          .setOptions(
            updated.slice(0, 25).map((c, i) => ({
              label: `${i + 1}. ${c.name}`,
              value: c._id.toHexString()
            }))
          )
      );
      return interaction.editReply({ embeds: [embed], components: [row] });
    }

    const catName = updated.find((c) => c._id.toHexString() === args.first)?.name ?? args.first;
    embed.setFooter({ text: `Step 2: Where should "${catName}" go?` });

    const positions = updated.map((c, i) => ({
      label: `Position ${i + 1}${c._id.toHexString() === args.first ? ' (current)' : ` — before ${c.name}`}`,
      value: String(i + 1)
    }));
    positions[positions.length - 1] = {
      label: `Position ${updated.length} — last`,
      value: String(updated.length)
    };

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(
          this.createId({
            cmd: this.id,
            type: 'categories',
            first: args.first,
            string_key: 'second'
          })
        )
        .setPlaceholder(`Move "${catName}" to position...`)
        .setOptions(positions.slice(0, 25))
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  }
}
