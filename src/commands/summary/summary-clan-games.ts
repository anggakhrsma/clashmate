import { Collections } from '@app/constants';
import {
  ActionRowBuilder,
  BaseInteraction,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  EmbedBuilder
} from 'discord.js';
import moment from 'moment';
import { Command } from '../../lib/handlers.js';
import { EMOJIS } from '../../util/emojis.js';
import { clanGamesSortingAlgorithm, padStart } from '../../util/helper.js';
import { Util } from '../../util/toolkit.js';

export default class SummaryClanGamesCommand extends Command {
  public constructor() {
    super('summary-clan-games', {
      category: 'none',
      channel: 'guild',
      clientPermissions: ['EmbedLinks', 'UseExternalEmojis'],
      defer: true
    });
  }

  public async exec(
    interaction: CommandInteraction<'cached'> | ButtonInteraction<'cached'>,
    args: {
      season?: string;
      clans?: string;
      max_points?: boolean;
      clans_only?: boolean;
      show_time?: boolean;
    }
  ) {
    const { clans, resolvedArgs } = await this.client.storage.handleSearch(interaction, {
      args: args.clans
    });
    if (!clans) return;

    const seasonId = this.getSeasonId(args.season);
    const queried = await this.query(
      clans.map((clan) => clan.tag),
      seasonId
    );

    const clansEmbed = this.clanScoreboard({
      clans: queried?.clans ?? [],
      seasonId
    });
    const playersEmbed = this.playerScoreboard(interaction, {
      members: queried?.members ?? [],
      maxPoints: args.max_points,
      seasonId,
      showTime: args.show_time
    });
    const embed = args.clans_only ? clansEmbed : playersEmbed;

    const payload = {
      cmd: this.id,
      clans: resolvedArgs,
      season: args.season,
      max_points: args.max_points,
      clans_only: args.clans_only,
      show_time: args.show_time
    };

    const customIds = {
      refresh: this.createId({ ...payload, export_disabled: false }),
      toggle: this.createId({ ...payload, clans_only: !args.clans_only }),
      show_time: this.createId({ ...payload, show_time: !args.show_time })
    };

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setEmoji(EMOJIS.REFRESH)
        .setStyle(ButtonStyle.Secondary)
        .setCustomId(customIds.refresh),
      new ButtonBuilder()
        .setLabel(args.clans_only ? 'Players Summary' : 'Clans Summary')
        .setStyle(ButtonStyle.Secondary)
        .setCustomId(customIds.toggle)
    );

    const optionalRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel(args.show_time ? 'Scoreboard' : 'Fastest Completion')
        .setStyle(ButtonStyle.Secondary)
        .setCustomId(customIds.show_time)
    );
    const components = args.clans_only ? [] : [optionalRow];

    await interaction.editReply({ embeds: [embed], components: [...components, row] });
  }

  private clanScoreboard({
    clans,
    seasonId
  }: {
    clans: { name: string; tag: string; points: number; players: number }[];
    seasonId: string;
  }) {
    const embed = new EmbedBuilder();
    embed.setAuthor({ name: `Clan Games Scoreboard (${seasonId})` });
    embed.setDescription(
      [
        `\` # PLAYERS POINTS\` \u200b **CLANS**`,
        ...clans.slice(0, 99).map((clan, idx) => {
          const points = padStart(clan.points, 6);
          const players = padStart(`${Math.min(clan.players, 50)}/50`, 6);
          return `\`${padStart(++idx, 2)} ${players}  ${points}\` \u200b \u200e[${clan.name}](http://cprk.us/c/${clan.tag.replace('#', '')})`;
        })
      ].join('\n')
    );
    embed.setFooter({ text: `Season ${seasonId}` });
    embed.setTimestamp();
    return embed;
  }

  private playerScoreboard(
    interaction: BaseInteraction,
    {
      members,
      maxPoints = false,
      seasonId,
      showTime
    }: {
      members: {
        name: string;
        tag: string;
        points: number;
        completedAt?: Date;
        timeTaken?: number;
      }[];
      maxPoints?: boolean;
      seasonId: string;
      showTime?: boolean;
    }
  ) {
    const total = members.reduce(
      (prev, mem) => prev + (maxPoints ? mem.points : Math.min(mem.points, this.MAX)),
      0
    );
    members
      .sort((a, b) => b.points - a.points)
      .sort((a, b) =>
        clanGamesSortingAlgorithm(a.completedAt?.getTime() ?? 0, b.completedAt?.getTime() ?? 0)
      );

    const embed = new EmbedBuilder()
      .setAuthor({
        name: `${interaction.guild!.name} Clan Games Scoreboard`,
        iconURL: interaction.guild!.iconURL()!
      })
      .setDescription(
        [
          `**[${this.i18n('command.clan_games.title', { lng: interaction.locale })} (${seasonId})](https://clashperk.com/faq)**`,
          showTime
            ? `\`\`\`\n\u200e\u2002# ${' '.padEnd(7, ' ')}  ${'NAME'.padEnd(20, ' ')}`
            : `\`\`\`\n\u200e\u2002# POINTS  ${'NAME'.padEnd(20, ' ')}`,
          members
            .slice(0, 99)
            // TODO: fix timing issues
            .filter((d) =>
              showTime ? d.points >= this.MAX && d.timeTaken && d.timeTaken > 0 : true
            )
            .map((m, i) => {
              const completionTime = this._formatTime(m.timeTaken).padStart(7, ' ');
              const points = m.points.toString().padStart(5, ' ');
              if (showTime) {
                return `\u200e${(++i).toString().padStart(2, '\u2002')} ${completionTime}  ${m.name}`;
              }
              return `\u200e${(++i).toString().padStart(2, '\u2002')}  ${points}  ${m.name}`;
            })
            .join('\n'),
          '```'
        ].join('\n')
      );

    embed.setFooter({ text: `Points: ${total} [Avg: ${(total / members.length).toFixed(2)}]` });
    embed.setTimestamp();
    return embed;
  }

  private get MAX() {
    if (new Date().getDate() >= 22) return Util.getClanGamesMaxPoints();
    return 4000;
  }

  private getSeasonId(seasonId?: string) {
    if (seasonId) return seasonId;
    return this.latestSeason;
  }

  private get latestSeason() {
    const now = new Date();
    if (now.getDate() < 20) now.setMonth(now.getMonth() - 1);
    return now.toISOString().slice(0, 7);
  }

  private query(clanTags: string[], seasonId: string) {
    const _clanGamesStartTimestamp = moment(seasonId).add(21, 'days').hour(8).toDate().getTime();
    const cursor = this.client.db.collection(Collections.CLAN_GAMES_POINTS).aggregate<{
      clans: { name: string; tag: string; points: number; players: number }[];
      members: ClanGamesMember[];
    }>([
      {
        $match: { __clans: { $in: clanTags }, season: seasonId }
      },
      {
        $set: {
          clan: {
            $arrayElemAt: ['$clans', 0]
          }
        }
      },
      {
        $project: {
          points: {
            $subtract: ['$current', '$initial']
          },
          timeTaken: {
            $dateDiff: {
              startDate: '$completedAt',
              endDate: '$$NOW',
              unit: 'millisecond'
            }
          },
          completedAt: '$completedAt',
          name: 1,
          tag: 1,
          clan: { name: 1, tag: 1 }
        }
      },
      {
        $facet: {
          clans: [
            {
              $group: {
                _id: '$clan.tag',
                name: {
                  $first: '$clan.name'
                },
                tag: {
                  $first: '$clan.tag'
                },
                points: {
                  $sum: {
                    $min: ['$points', this.MAX]
                  }
                },
                players: {
                  $sum: {
                    $cond: {
                      if: { $gte: ['$points', 1] },
                      then: 1,
                      else: 0
                    }
                  }
                }
              }
            },
            {
              $match: {
                _id: { $in: clanTags }
              }
            },
            {
              $sort: {
                points: -1
              }
            }
          ],
          members: [
            {
              $sort: {
                points: -1
              }
            },
            {
              $set: {
                timeTaken: {
                  $dateDiff: {
                    startDate: new Date(_clanGamesStartTimestamp),
                    endDate: '$completedAt',
                    unit: 'millisecond'
                  }
                }
              }
            }
          ]
        }
      }
    ]);

    return cursor.next()!;
  }

  private _formatTime(diff?: number) {
    if (!diff) return '';
    if (diff >= 24 * 60 * 60 * 1000) {
      return moment.duration(diff).format('d[d] h[h]', { trim: 'both mid' });
    }
    return moment.duration(diff).format('h[h] m[m]', { trim: 'both mid' });
  }
}

interface ClanGamesMember {
  name: string;
  tag: string;
  points: number;
  completedAt?: Date;
  timeTaken?: number;
  clan: {
    name: string;
    tag: string;
  };
}
