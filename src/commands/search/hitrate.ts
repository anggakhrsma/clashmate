import { Collections, WarType } from '@app/constants';
import { APIClanWar } from 'clashofclans.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CommandInteraction,
  EmbedBuilder,
  User
} from 'discord.js';
import { Args, Command } from '../../lib/handlers.js';
import { BLUE_NUMBERS, EMOJIS, ORANGE_NUMBERS, WHITE_NUMBERS } from '../../util/emojis.js';

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
        warType: { $in: [WarType.REGULAR, WarType.FRIENDLY] }
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
    let warsDisplayed = 0;

    for (const war of wars) {
      const isClanMember = war.clan.members.some((m) => m.tag === player.tag);
      const mySide = isClanMember ? war.clan : war.opponent;
      const enemySide = isClanMember ? war.opponent : war.clan;

      const member = mySide.members.find((m) => m.tag === player.tag);
      if (!member) continue;

      const attacks = (member.attacks ?? []).sort((a, b) => a.order - b.order);
      const isWarEnded = war.state === 'warEnded';

      // Skip ongoing wars with no attacks
      if (!isWarEnded && !attacks.length) continue;

      // Header: 2 lines with clan badge, player position/TH, and opponent name
      const clanBadgeUrl = mySide.badgeUrls.small;
      const header1 = `![](${clanBadgeUrl}) **${mySide.name}** (#${member.mapPosition}, TH${member.townhallLevel})`;
      const header2 = `vs ${enemySide.name}`;
      lines.push(header1);
      lines.push(header2);
      warsDisplayed++;

      // Get up to 2 attack slots, pad with nulls
      const rows = [attacks[0] ?? null, attacks[1] ?? null];

      // Render each row
      for (let rowNum = 1; rowNum <= 2; rowNum++) {
        const attack = rows[rowNum - 1];

        // Show "Missed" only for ended wars
        if (!attack) {
          if (isWarEnded) {
            lines.push(`${WHITE_NUMBERS[rowNum]} Missed`);
          }
        } else {
          const defender = enemySide.members.find((m) => m.tag === attack.defenderTag)!;

          // Build star emojis: ★ for earned stars, ☆ for missed stars
          const stars = '★'.repeat(attack.stars) + '☆'.repeat(3 - attack.stars);

          const destruction = attack.destructionPercentage.toFixed(0).padStart(3, ' ');
          const row = `${WHITE_NUMBERS[rowNum]} ${stars} ${destruction}% → ${BLUE_NUMBERS[defender.mapPosition]} ${ORANGE_NUMBERS[defender.townhallLevel.toString()]}`;
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
      .setFooter({ text: `Last ${warsDisplayed} regular wars` })
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

}