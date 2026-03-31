import { Collections } from '@app/constants';
import {
  ButtonInteraction,
  CommandInteraction,
  EmbedBuilder,
  User,
  AttachmentBuilder
} from 'discord.js';
import moment from 'moment';
import { Command } from '../../lib/handlers.js';
import { padStart } from '../../util/helper.js';
import { handlePagination } from '../../util/pagination.js';
import { Util } from '../../util/toolkit.js';
import { cluster } from 'radash';

export default class EosTrophiesHistoryCommand extends Command {
  public constructor() {
    super('eos-trophies-history', {
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
    if (args.player) {
      const player = await this.client.resolver.resolvePlayer(interaction, args.player);
      if (!player) return null;
      const playerTags = [player.tag];
      const { embeds, result } = await this.getHistory(interaction, playerTags);

      if (!result.length) {
        return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
      }

      return handlePagination(interaction, embeds);
    }

    if (args.clans) {
      const { clans } = await this.client.storage.handleSearch(interaction, { args: args.clans });
      if (!clans) return;

      const _clans = (
        await Promise.all(clans.slice(0, 1).map((clan) => this.client.coc.getClan(clan.tag)))
      )
        .filter((r) => r.res.ok)
        .map((r) => r.body);
      const playerTags = _clans.flatMap((clan) => clan.memberList.map((member) => member.tag));
      const { embeds, result } = await this.getHistory(interaction, playerTags);
      return handlePagination(interaction, embeds);
    }

    const playerTags = await this.client.resolver.getLinkedPlayerTags(
      args.user?.id ?? interaction.user.id
    );
    const { embeds, result } = await this.getHistory(interaction, playerTags);

    if (!result.length) {
      return interaction.editReply(this.i18n('common.no_data', { lng: interaction.locale }));
    }

    return handlePagination(interaction, embeds);
  }

  private async getHistory(interaction: CommandInteraction<'cached'>, playerTags: string[]) {
    const result = await this.client.db
      .collection(Collections.PLAYER_SEASONS)
      .aggregate<AggregatedResult>([
        { $match: { tag: { $in: playerTags } } },
        {
          $match: {
            createdAt: {
              $gte: moment().startOf('month').subtract(12, 'month').toDate()
            }
          }
        },
        { $sort: { _id: -1 } },
        {
          $group: {
            _id: '$tag',
            name: { $first: '$name' },
            tag: { $first: '$tag' },
            seasons: {
              $push: {
                season: '$season',
                trophies: '$trophies.current'
              }
            }
          }
        }
      ])
      .toArray();

    const embeds: EmbedBuilder[] = [];
    for (const chunk of cluster(result, 15)) {
      const embed = new EmbedBuilder();
      embed.setColor(this.client.embed(interaction));
      embed.setTitle('Season End Trophies (last 12 months)');

      chunk.forEach(({ name, tag, seasons }) => {
        embed.addFields({
          name: `${name} (${tag})`,
          value: [
            '```',
            `\u200eSEASON    TROPHY`,
            seasons
              .map((season) => {
                return `${moment(season.season).format('MMM YYYY')}  ${padStart(season.trophies, 8)}`;
              })
              .join('\n'),
            '```'
          ].join('\n')
        });
      });
      embeds.push(embed);
    }

    return { embeds, result };
  }
}

interface ISeason {
  season: string;
  trophies: number;
}

interface AggregatedResult {
  name: string;
  tag: string;
  seasons: ISeason[];
}
