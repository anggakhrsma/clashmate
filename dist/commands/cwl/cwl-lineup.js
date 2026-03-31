import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { cluster } from 'radash';
import { Command } from '../../lib/handlers.js';
import { BLUE_NUMBERS, EMOJIS, HERO_PETS, WHITE_NUMBERS } from '../../util/emojis.js';
import { padStart } from '../../util/helper.js';
const states = {
    inWar: 'Battle Day',
    preparation: 'Preparation',
    warEnded: 'War Ended'
};
export default class CWLLineupCommand extends Command {
    constructor() {
        super('cwl-lineup', {
            category: 'cwl',
            clientPermissions: ['EmbedLinks', 'UseExternalEmojis'],
            defer: true
        });
    }
    args() {
        return {
            clan: {
                id: 'tag',
                match: 'STRING'
            }
        };
    }
    async exec(interaction, args) {
        const clan = await this.client.resolver.resolveClan(interaction, args.tag ?? args.user?.id);
        if (!clan)
            return;
        const { body, res } = await this.client.coc.getClanWarLeagueGroup(clan.tag);
        if (res.status === 504 || body.state === 'notInWar') {
            return interaction.editReply(this.i18n('command.cwl.still_searching', {
                lng: interaction.locale,
                clan: `${clan.name} (${clan.tag})`
            }));
        }
        if (!res.ok) {
            return interaction.editReply(this.i18n('command.cwl.not_in_season', {
                lng: interaction.locale,
                clan: `${clan.name} (${clan.tag})`
            }));
        }
        return this.rounds(interaction, { body, clan, args });
    }
    async rounds(interaction, { body, clan, args }) {
        const clanTag = clan.tag;
        const rounds = body.rounds.filter((d) => !d.warTags.includes('#0'));
        const chunks = [];
        for (const { warTags } of rounds.slice(-2)) {
            for (const warTag of warTags) {
                const { body, res } = await this.client.coc.getClanWarLeagueRound(warTag);
                if (!res.ok)
                    continue;
                if (body.clan.tag === clanTag || body.opponent.tag === clanTag) {
                    const clan = body.clan.tag === clanTag ? body.clan : body.opponent;
                    const opponent = body.clan.tag === clanTag ? body.opponent : body.clan;
                    const round = rounds.findIndex((en) => en.warTags.includes(warTag)) + 1;
                    chunks.push({ state: body.state, clan, opponent, round });
                }
            }
        }
        if (!chunks.length)
            return interaction.editReply(this.i18n('command.cwl.no_rounds', { lng: interaction.locale }));
        const state = args.state ?? 'preparation';
        const data = chunks.find((ch) => ch.state === state) ?? chunks.slice(-1).at(0);
        const embeds = args.player_list
            ? this.getLineupList(data.state, data.round, { clan: data.clan, opponent: data.opponent })
            : await this.getComparisonLineup(data.state, data.round, data.clan, data.opponent);
        for (const embed of embeds)
            embed.setColor(this.client.embed(interaction));
        const payload = {
            cmd: this.id,
            tag: clanTag,
            player_list: args.player_list
        };
        const customIds = {
            refresh: this.createId(payload),
            round: this.createId({ ...payload, string_key: 'state' }),
            toggle: this.createId({ ...payload, player_list: !args.player_list })
        };
        const buttonRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setEmoji(EMOJIS.REFRESH)
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(customIds.refresh), new ButtonBuilder()
            .setCustomId(customIds.toggle)
            .setLabel(args.player_list ? 'Compare' : 'Player List')
            .setStyle(ButtonStyle.Secondary));
        const menu = new StringSelectMenuBuilder()
            .setCustomId(customIds.round)
            .setPlaceholder('Select War')
            .addOptions([
            {
                label: 'Preparation',
                value: 'preparation',
                description: 'Lineup for the preparation day.'
            },
            {
                label: 'Battle Day',
                value: 'inWar',
                description: 'Lineup for the battle day.'
            }
        ].map((option) => ({ ...option, default: option.value === state })))
            .setDisabled(chunks.length === 1);
        const menuRow = new ActionRowBuilder().addComponents(menu);
        return interaction.editReply({ embeds, components: [buttonRow, menuRow] });
    }
    async rosters(clanMembers, opponentMembers) {
        const clanPlayers = await this.client.coc._getPlayers(clanMembers);
        const a = clanPlayers.map((data, i) => {
            const heroes = data.heroes.filter((en) => en.village === 'home');
            const pets = data.troops.filter((en) => en.village === 'home' && en.name in HERO_PETS);
            return {
                e: 0,
                m: i + 1,
                t: data.townHallLevel,
                p: pets.map((en) => en.level).reduce((prev, en) => en + prev, 0),
                h: heroes.map((en) => en.level).reduce((prev, en) => en + prev, 0)
                // .concat(...Array(4 - heroes.length).fill(' '))
            };
        });
        const opponentPlayers = await this.client.coc._getPlayers(opponentMembers);
        const b = opponentPlayers.map((data, i) => {
            const heroes = data.heroes.filter((en) => en.village === 'home');
            const pets = data.troops.filter((en) => en.village === 'home' && en.name in HERO_PETS);
            return {
                e: 1,
                m: i + 1,
                t: data.townHallLevel,
                p: pets.map((en) => en.level).reduce((prev, en) => en + prev, 0),
                h: heroes.map((en) => en.level).reduce((prev, en) => en + prev, 0)
                // .concat(...Array(4 - heroes.length).fill(' '))
            };
        });
        return cluster([...a, ...b].sort((a, b) => a.e - b.e).sort((a, b) => a.m - b.m), 2);
    }
    async getComparisonLineup(state, round, clan, opponent) {
        const lineups = await this.rosters(clan.members.sort((a, b) => a.mapPosition - b.mapPosition), opponent.members.sort((a, b) => a.mapPosition - b.mapPosition));
        const embed = new EmbedBuilder();
        embed.setAuthor({ name: `\u200e${clan.name} (${clan.tag})`, iconURL: clan.badgeUrls.medium });
        embed.setDescription([
            '**War Against**',
            `**\u200e${opponent.name} (${opponent.tag})**`,
            '',
            `\u200e${EMOJIS.HASH} \`TH HERO \u2002  \u2002 TH HERO \``,
            lineups
                .map((lineup, i) => {
                const desc = lineup
                    .map((en) => `${padStart(en.t, 2)} ${padStart(en.h, 4)}`)
                    .join(' \u2002vs\u2002 ');
                return `${BLUE_NUMBERS[i + 1]} \`${desc} \``;
            })
                .join('\n')
        ].join('\n'));
        embed.setFooter({ text: `Round #${round} (${states[state]})` });
        return [embed];
    }
    getLineupList(state, round, data) {
        const embeds = [
            new EmbedBuilder()
                .setAuthor({
                name: `\u200e${data.clan.name} (${data.clan.tag})`,
                iconURL: data.clan.badgeUrls.medium,
                url: this.clanURL(data.clan.tag)
            })
                .setDescription(data.clan.members
                .sort((a, b) => a.mapPosition - b.mapPosition)
                .map((m, i) => `\u200e${WHITE_NUMBERS[i + 1]} [${m.name}](http://cprk.us/p/${m.tag.replace('#', '')})`)
                .join('\n'))
                .setFooter({ text: `Round #${round} (${states[state]})` }),
            new EmbedBuilder()
                .setAuthor({
                name: `\u200e${data.opponent.name} (${data.opponent.tag})`,
                iconURL: data.opponent.badgeUrls.medium,
                url: this.clanURL(data.opponent.tag)
            })
                .setDescription(data.opponent.members
                .sort((a, b) => a.mapPosition - b.mapPosition)
                .map((m, i) => `\u200e${WHITE_NUMBERS[i + 1]} [${m.name}](http://cprk.us/p/${m.tag.replace('#', '')})`)
                .join('\n'))
                .setFooter({ text: `Round #${round} (${states[state]})` })
        ];
        return embeds;
    }
    clanURL(tag) {
        return `https://link.clashofclans.com/en?action=OpenClanProfile&tag=${encodeURIComponent(tag)}`;
    }
}
//# sourceMappingURL=cwl-lineup.js.map