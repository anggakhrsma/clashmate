import { Collections, WarType } from '@app/constants';
import { APIClanWar, APIClanWarAttack } from 'clashofclans.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CommandInteraction,
  EmbedBuilder,
  User
} from 'discord.js';
import moment from 'moment';
import { Args, Command } from '../../lib/handlers.js';
import { BLUE_NUMBERS, EMOJIS, ORANGE_NUMBERS, WAR_STARS, WHITE_NUMBERS } from '../../util/emojis.js';

export default class HitrateCommand extends Command {
  public constructor() {
    super('hitrate', {
      category: 'search',
      channel: 'guild',
      clientPermissions: ['EmbedLinks', 'UseExternalEmojis'],
      defer: true
    });
  }

  public args(): Args {
    return {
      player: {
        id: 'tag',
        match: 'STRING'
      }
    };
  }

  public async exec(
    interaction: CommandInteraction<'cached'>,
    args: { tag?: string; user?: User }
  ) {
    const player = await this.client.resolver.resolvePlayer(interaction, args.tag ?? args.user?.id);
    if (!player) return;

    const wars = await this.client.db
      .collection<APIClanWar>(Collections.CLAN_WARS)
      .find({
        $or: [{ 'clan.members.tag': player.tag }, { 'opponent.members.tag': player.tag }],
        warType: WarType.REGULAR
      })
      .sort({ _id: -1 })
      .limit(10)
      .toArray();

    if (!wars.length) {
      return interaction.editReply({
        content: 'No war history found.'
      });
    }

    const lines: string[] = [];

    for (const war of wars) {
      const isClanMember = war.clan.members.some((m) => m.tag === player.tag);
      const mySide = isClanMember ? war.clan : war.opponent;
      const enemySide = isClanMember ? war.opponent : war.clan;

      const member = mySide.members.find((m) => m.tag === player.tag);
      if (!member) continue;

      // Header
      const warDate = moment(war.startTime).format('DD/MM/YYYY');
      const header = `${warDate} - ${mySide.name} (#${mySide.tag}) vs ${enemySide.name} (#${enemySide.tag}) - (#${member.mapPosition}, TH${member.townhallLevel})`;
      lines.push(header);

      // Collect all attacks from player's side for fresh/cleanup detection
      const allSideAttacks = mySide.members
        .flatMap((m) => m.attacks ?? []);

      // Get up to 2 attacks (sorted ascending by order), pad to 2 with nulls
      const attacks = (member.attacks ?? []).sort((a, b) => a.order - b.order);
      const rows = [attacks[0] ?? null, attacks[1] ?? null];

      // Render each row
      for (let rowNum = 1; rowNum <= 2; rowNum++) {
        const attack = rows[rowNum - 1];

        if (!attack) {
          lines.push(`${WHITE_NUMBERS[rowNum]} Missed`);
        } else {
          const defender = enemySide.members.find((m) => m.tag === attack.defenderTag)!;
          const prevBestStars = this.prevBestStars(allSideAttacks, attack.defenderTag, attack.order);
          const newStars = Math.max(0, attack.stars - prevBestStars);

          // Build star emojis: new stars = YELLOW_NEW, old stars = YELLOW_EMPTY, remaining = EMPTY
          const starEmojis = [
            ...Array(newStars).fill(WAR_STARS.YELLOW_NEW),
            ...Array(prevBestStars).fill(WAR_STARS.YELLOW_EMPTY),
            ...Array(3 - attack.stars).fill(WAR_STARS.EMPTY)
          ].join('');

          const row = `${WHITE_NUMBERS[rowNum]} ${starEmojis} ${attack.destructionPercentage.toFixed(0)}% ➞ ${BLUE_NUMBERS[defender.mapPosition]} ${ORANGE_NUMBERS[defender.townhallLevel]}`;
          lines.push(row);
        }
      }

      lines.push('');
    }

    // Remove trailing empty line
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }

    const embed = new EmbedBuilder()
      .setColor(this.client.embed(interaction))
      .setAuthor({ name: `${player.name} (${player.tag})` })
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Last ${wars.length} regular wars` })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(this.createId({ cmd: this.id, tag: player.tag }))
        .setEmoji(EMOJIS.REFRESH)
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.editReply({
      embeds: [embed],
      components: [row]
    });
  }

  private prevBestStars(allAttacks: APIClanWarAttack[], defenderTag: string, order: number): number {
    const prior = allAttacks.filter((a) => a.defenderTag === defenderTag && a.order < order);
    return prior.length ? Math.max(...prior.map((a) => a.stars)) : 0;
  }
}