import { Collections } from '@app/constants';
import { AttachmentBuilder, ButtonInteraction, CommandInteraction, User } from 'discord.js';
import moment from 'moment';
import { Command } from '../../lib/handlers.js';
import {} from '../../util/helper.js';

export default class JoinLeaveHistoryCommand extends Command {
  public constructor() {
    super('join-leave-history', {
      category: 'none',
      channel: 'guild',
      clientPermissions: ['EmbedLinks'],
      defer: true
    });
  }

  public async exec(
    interaction: CommandInteraction<'cached'>,
    args: { clans?: string; player?: string; user?: User }
  ) {
    if (args.user) {
      const playerTags = await this.client.resolver.getLinkedPlayerTags(args.user.id);
      const { result } = await this.getHistory(interaction, playerTags);
      if (!result.length) {
        return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
      }
    }

    if (args.player) {
      const player = await this.client.resolver.resolvePlayer(interaction, args.player);
      if (!player) return null;
      const playerTags = [player.tag];
      const { result } = await this.getHistory(interaction, playerTags);
      if (!result.length) {
        return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
      }
    }

    const { clans } = await this.client.storage.handleSearch(interaction, { args: args.clans });
    if (!clans) return;

    const { result } = await this.getClanHistory(
      interaction,
      clans.map((clan) => clan.tag)
    );
    if (!result.length) {
      return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
    }
  }

  private async getHistory(interaction: CommandInteraction<'cached'>, playerTags: string[]) {
    const gte = moment().subtract(1, 'month').toDate().toISOString();
    const result = await this.client.db
      .collection(Collections.CLAN_LOGS)
      .find({ tag: { $in: playerTags }, op: { $in: ['JOINED', 'LEFT'] } })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    return { embeds: [], result };
  }

  private async getClanHistory(interaction: CommandInteraction<'cached'>, clanTags: string[]) {
    const gte = moment().subtract(1, 'month').toDate().toISOString();
    const result = await this.client.db
      .collection(Collections.CLAN_LOGS)
      .find({ clanTag: { $in: clanTags }, op: { $in: ['JOINED', 'LEFT'] } })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    return { embeds: [], result };
  }
}

interface AggregatedResult {
  tag: string;
  name: string;
  op: string;
  clan_name: string;
  clan_tag: string;
  created_at: string;
}
