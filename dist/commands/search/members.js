import { UP_ARROW } from '../../util/constants.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, escapeMarkdown, time } from 'discord.js';
import moment from 'moment';
import ms from 'ms';
import { Command } from '../../lib/handlers.js';
import { MembersCommandOptions as options } from '../../util/command.options.js';
import { EMOJIS, HERO_PETS } from '../../util/emojis.js';
import { formatLeague, leagueTierSort, makeAbbr, padEnd, padStart } from '../../util/helper.js';
import { Util } from '../../util/toolkit.js';
const roleIds = {
    member: 1,
    admin: 2,
    coLeader: 3,
    leader: 4
};
const roleNames = {
    member: 'Mem',
    admin: 'Eld',
    coLeader: 'Co',
    leader: 'Lead'
};
const PETS = Object.keys(HERO_PETS).reduce((record, item, idx) => {
    record[item] = idx + 1;
    return record;
}, {});
export default class MembersCommand extends Command {
    constructor() {
        super('members', {
            category: 'search',
            channel: 'guild',
            clientPermissions: ['EmbedLinks', 'AttachFiles'],
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
        const command = args.option && this.handler.getCommand(args.option);
        if (command)
            return this.handler.exec(interaction, command, { tag: args.tag, with_options: true });
        const data = await this.client.resolver.resolveClan(interaction, args.tag ?? args.user?.id);
        if (!data)
            return;
        if (!data.members)
            return interaction.editReply(this.i18n('common.no_clan_members', { lng: interaction.locale, clan: data.name }));
        const fetched = await this.client.coc._getPlayers(data.memberList);
        const members = fetched.map((m) => ({
            name: m.name,
            tag: m.tag,
            warPreference: m.warPreference === 'in',
            role: {
                id: roleIds[m.role ?? data.memberList.find((mem) => mem.tag === m.tag).role],
                name: roleNames[m.role ?? data.memberList.find((mem) => mem.tag === m.tag).role]
            },
            townHallLevel: m.townHallLevel,
            heroes: m.heroes.length ? m.heroes.filter((a) => a.village === 'home') : [],
            pets: m.troops
                .filter((troop) => troop.name in PETS)
                .sort((a, b) => PETS[a.name] - PETS[b.name])
        }));
        members
            .sort((a, b) => b.heroes.reduce((x, y) => x + y.level, 0) - a.heroes.reduce((x, y) => x + y.level, 0))
            .sort((a, b) => b.townHallLevel - a.townHallLevel);
        const embed = new EmbedBuilder()
            .setColor(this.client.embed(interaction))
            .setFooter({
            text: `Total ${fetched.length === data.members ? data.members : `${fetched.length}/${data.members}`}/50`
        })
            .setAuthor({ name: `${data.name} (${data.tag})`, iconURL: data.badgeUrls.medium })
            .setDescription([
            `\`TH  BK  AQ GW RC MP \`  **NAME**`,
            ...members.map((mem) => {
                const heroes = this.heroes(mem.heroes)
                    .map((hero, idx) => padStart(hero.level, idx > 1 ? 2 : 3))
                    .join(' ');
                return `\`${padStart(mem.townHallLevel, 2)} ${heroes} \`  \u200e${escapeMarkdown(mem.name)}`;
            })
        ].join('\n'));
        // TAGS AND ROLES
        if (args.option === options.tags.id) {
            members.sort((a, b) => b.role.id - a.role.id);
            embed.setDescription([
                `\`${'ROLE'}  ${'TAG'.padEnd(10, ' ')} \`  ${'**NAME**'}`,
                members
                    .map((mem) => `\`${padEnd(mem.role.name, 4)}  ${padEnd(mem.tag, 10)} \`  \u200e${escapeMarkdown(mem.name)}`)
                    .join('\n')
            ].join('\n'));
        }
        // WAR_PREF
        if (args.option === options.warPref.id) {
            const members = await this.getWarPref(data, fetched);
            const optedIn = members.filter((m) => m.warPreference === 'in');
            const optedOut = members.filter((m) => m.warPreference !== 'in');
            optedIn.sort((a, b) => {
                if (a.joinTime && b.joinTime)
                    return b.joinTime.getTime() - a.joinTime.getTime();
                if (a.joinTime)
                    return -1;
                if (b.joinTime)
                    return 1;
                return 0;
            });
            optedIn.sort((a, b) => b.townHallLevel - a.townHallLevel);
            optedOut.sort((a, b) => {
                if (a.outTime && b.outTime)
                    return b.outTime.getTime() - a.outTime.getTime();
                if (a.outTime)
                    return -1;
                if (b.outTime)
                    return 1;
                return 0;
            });
            optedOut.sort((a, b) => b.townHallLevel - a.townHallLevel);
            embed.setDescription([
                'War Preferences and Last Opted In/Out',
                `### Opted-In - ${optedIn.length}`,
                optedIn
                    .map((m) => {
                    const name = Util.escapeBackTick(m.name).padEnd(15, ' ');
                    const inTime = m.joinTime
                        ? ms(Date.now() - m.joinTime.getTime())
                        : `---`;
                    return `${EMOJIS.WAR_PREF_IN} \`${padStart(m.townHallLevel, 2)}\` \` ${inTime.padStart(4, ' ')} \`  \u200e\` ${name}\u200f\``;
                })
                    .join('\n'),
                `### Opted-Out - ${optedOut.length}`,
                optedOut
                    .map((m) => {
                    const name = Util.escapeBackTick(m.name).padEnd(15, ' ');
                    const outTime = m.outTime ? ms(Date.now() - m.outTime.getTime()) : `---`;
                    return `${EMOJIS.WAR_PREF_OUT} \`${padStart(m.townHallLevel, 2)}\` \` ${outTime.padStart(4, ' ')} \`  \u200e\` ${name}\u200f\``;
                })
                    .join('\n')
            ].join('\n'));
        }
        // JOIN_DATE
        if (args.option === options.joinDate.id) {
            const members = await this.joinLeave(data, fetched);
            members.sort((a, b) => {
                if (a.joinTime && b.joinTime)
                    return b.joinTime.getTime() - a.joinTime.getTime();
                if (a.joinTime)
                    return -1;
                if (b.joinTime)
                    return 1;
                return 0;
            });
            embed.setDescription([
                `\`TH  IN OUT NAME${' '.repeat(13)}\``,
                ...members.map((m) => {
                    const inTime = m.joinTime ? time(m.joinTime, 'R') : '';
                    const hall = m.townHallLevel.toString().padStart(2, ' ');
                    const inCount = (m.in ?? 0).toString().padStart(3, ' ');
                    const outCount = (m.out ?? 0).toString().padStart(3, ' ');
                    const name = Util.escapeBackTick(m.name).slice(0, 13).padEnd(13, ' ');
                    return `\u200e\`${hall} ${inCount} ${outCount} ${name}\u200f\`\u200e ${inTime}`;
                })
            ].join('\n'));
            embed.setFooter({ text: `Last Joining and Leave/Join count` });
        }
        // PROGRESS
        if (args.option === options.progress.id) {
            const members = await this.progress(fetched);
            const upgrades = fetched.map((player) => ({
                name: player.name,
                tag: player.tag,
                hero: members[player.tag]?.HERO ?? 0,
                pet: members[player.tag]?.PET ?? 0,
                troop: members[player.tag]?.TROOP ?? 0,
                spell: members[player.tag]?.SPELL ?? 0
            }));
            upgrades.sort((a, b) => {
                const aTotal = a.hero + a.pet + a.troop + a.spell;
                const bTotal = b.hero + b.pet + b.troop + b.spell;
                return bTotal - aTotal;
            });
            embed.setDescription([
                'Player Progress (Hero, Pet, Troop, Spell)',
                '```',
                `HRO PET TRP SPL  NAME`,
                ...upgrades.map((player) => {
                    const hero = padStart(player.hero || '-', 3);
                    const pet = padStart(player.pet || '-', 3);
                    const troop = padStart(player.troop || '-', 3);
                    const spell = padStart(player.spell || '-', 3);
                    return `${hero} ${pet} ${troop} ${spell}  ${player.name}`;
                }),
                '```'
            ].join('\n'));
            const totalHero = upgrades.reduce((acc, cur) => acc + cur.hero, 0);
            const totalPet = upgrades.reduce((acc, cur) => acc + cur.pet, 0);
            const totalTroop = upgrades.reduce((acc, cur) => acc + cur.troop, 0);
            const totalSpell = upgrades.reduce((acc, cur) => acc + cur.spell, 0);
            const total = totalHero + totalPet + totalTroop + totalSpell;
            embed.setFooter({
                text: [
                    `${UP_ARROW}${total} levels were upgraded in the last 30 days`,
                    `${UP_ARROW}${totalHero} heroes \u2002 ${UP_ARROW}${totalPet} pets \u2002 ${UP_ARROW}${totalTroop} troops \u2002 ${UP_ARROW}${totalSpell} spells`
                ].join('\n')
            });
        }
        // TROPHIES
        if (args.option === options.trophies.id) {
            const members = [...data.memberList];
            members.sort((a, b) => b.trophies - a.trophies);
            members.sort((a, b) => leagueTierSort(a.leagueTier, b.leagueTier));
            embed.setDescription([
                `\`\u200e # TROPHY     LEAGUE \`  ${'NAME'}`,
                ...members.map((member, index) => {
                    const trophies = padStart(member.trophies, 4);
                    const league = padStart(formatLeague(member.leagueTier?.name || 'Unranked'), 11);
                    return `\`${padStart(index + 1, 2)}  ${trophies} ${league} \`  \u200e${escapeMarkdown(member.name)}`;
                })
            ].join('\n'));
        }
        const payload = {
            cmd: this.id,
            tag: data.tag,
            option: args.option
        };
        const customIds = {
            refresh: this.createId(payload),
            option: this.createId({ ...payload, string_key: 'option' })
        };
        const buttonRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setEmoji(EMOJIS.REFRESH)
            .setCustomId(customIds.refresh)
            .setStyle(ButtonStyle.Secondary));
        const menu = new StringSelectMenuBuilder()
            .setPlaceholder('Select an option!')
            .setCustomId(customIds.option)
            .addOptions(Object.values(options).map((option) => ({
            label: option.label,
            value: option.id,
            description: option.description,
            default: option.id === args.option
        })));
        const menuRow = new ActionRowBuilder().addComponents(menu);
        return interaction.editReply({ embeds: [embed], components: [buttonRow, menuRow] });
    }
    heroes(items) {
        const mapped = items.reduce((record, hero) => {
            record[makeAbbr(hero.name)] = hero.level;
            return record;
        }, {});
        return [
            { name: 'BK', level: mapped['BK'] ?? 0 },
            { name: 'AQ', level: mapped['AQ'] ?? 0 },
            { name: 'GW', level: mapped['GW'] ?? 0 },
            { name: 'RC', level: mapped['RC'] ?? 0 },
            { name: 'MP', level: mapped['MP'] ?? 0 }
        ];
    }
    async getWarPref(_clan, players) {
        // War preference history (was Elasticsearch-backed) — returns current preference only
        return players.map((player) => ({
            warPreference: player.warPreference,
            townHallLevel: player.townHallLevel,
            name: player.name,
            joinTime: null,
            outTime: null
        }));
    }
    async joinLeave(clan, players) {
        // Join/leave history from MongoDB clan logs
        const { Collections } = await import('../../util/constants.js');
        const logs = await this.client.db
            .collection("ClanLogs" /* Collections.CLAN_LOGS */)
            .find({
            clanTag: clan.tag,
            tag: { $in: players.map((p) => p.tag) },
            op: { $in: ['JOINED', 'LEFT'] }
        })
            .sort({ createdAt: -1 })
            .toArray();
        const logsMap = logs.reduce((acc, log) => {
            if (!acc[log.tag])
                acc[log.tag] = {};
            if (log.op === 'JOINED' && !acc[log.tag]?.joinTime)
                acc[log.tag] = { ...(acc[log.tag] || {}), joinTime: log.createdAt };
            if (log.op === 'LEFT' && !acc[log.tag]?.leaveTime)
                acc[log.tag] = { ...(acc[log.tag] || {}), leaveTime: log.createdAt };
            return acc;
        }, {});
        return players.map((player) => ({
            townHallLevel: player.townHallLevel,
            name: player.name,
            joinTime: logsMap[player.tag]?.joinTime ?? null,
            leaveTime: logsMap[player.tag]?.leaveTime ?? null
        }));
    }
    async progress(players) {
        const timestamp = moment().subtract(30, 'day').toDate().getTime();
        const rows = { data: [] }; // ClickHouse removed
        const playersMap = {};
        for (const row of rows.data ?? []) {
            if (!playersMap[row.tag])
                playersMap[row.tag] = {};
            playersMap[row.tag][row.type] = Number(row.count);
        }
        return playersMap;
    }
}
//# sourceMappingURL=members.js.map