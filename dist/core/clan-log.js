import { COLOR_CODES, DEEP_LINK_TYPES, PLAYER_ROLES_MAP, UNRANKED_TIER_ID } from '../util/constants.js';
import { ClanLogType, LogActions } from '../entities/index.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, WebhookClient, parseEmoji } from 'discord.js';
import moment from 'moment';
import { BLUE_NUMBERS, EMOJIS, HEROES, HOME_BASE_LEAGUES, RED_NUMBERS, TOWN_HALLS } from '../util/emojis.js';
import { unitsFlatten } from '../util/helper.js';
import { Util } from '../util/toolkit.js';
import { RAW_TROOPS_FILTERED } from '../util/troops.js';
import { RootLog } from './root-log.js';
const COLOR_MAPS = {
    [LogActions.NAME_CHANGE]: COLOR_CODES.PEACH,
    [LogActions.TOWN_HALL_UPGRADE]: COLOR_CODES.CYAN,
    [LogActions.PROMOTED]: COLOR_CODES.CYAN,
    [LogActions.DEMOTED]: COLOR_CODES.RED,
    [LogActions.WAR_PREF_CHANGE]: COLOR_CODES.CYAN,
    [LogActions.JOINED]: COLOR_CODES.GREEN,
    [LogActions.LEFT]: COLOR_CODES.RED,
    [LogActions.CAPITAL_GOLD_CONTRIBUTION]: COLOR_CODES.DARK_GREEN,
    [LogActions.CAPITAL_GOLD_RAID]: COLOR_CODES.RED
};
const logActionsMap = {
    [ClanLogType.MEMBER_JOIN_LEAVE_LOG]: [LogActions.JOINED, LogActions.LEFT],
    [ClanLogType.ROLE_CHANGE_LOG]: [LogActions.DEMOTED, LogActions.PROMOTED],
    [ClanLogType.TOWN_HALL_UPGRADE_LOG]: [LogActions.TOWN_HALL_UPGRADE],
    [ClanLogType.WAR_PREFERENCE_LOG]: [LogActions.WAR_PREF_CHANGE],
    [ClanLogType.NAME_CHANGE_LOG]: [LogActions.NAME_CHANGE],
    [ClanLogType.CLAN_ACHIEVEMENTS_LOG]: [
        LogActions.WAR_LEAGUE_CHANGE,
        LogActions.CAPITAL_HALL_LEVEL_UP,
        LogActions.CLAN_LEVEL_UP,
        LogActions.CAPITAL_LEAGUE_CHANGE
    ],
    [ClanLogType.CLAN_CAPITAL_CONTRIBUTION_LOG]: [LogActions.CAPITAL_GOLD_CONTRIBUTION],
    [ClanLogType.CLAN_CAPITAL_RAID_LOG]: [LogActions.CAPITAL_GOLD_RAID]
};
export class ClanLog extends RootLog {
    constructor(enqueuer) {
        super(enqueuer.client);
        this.client = enqueuer.client;
    }
    get permissions() {
        return ['SendMessages', 'EmbedLinks', 'UseExternalEmojis', 'ReadMessageHistory', 'ViewChannel'];
    }
    get collection() {
        return this.client.db.collection("ClanLogs" /* Collections.CLAN_LOGS */);
    }
    async handleMessage(cache, webhook, data) {
        const actions = logActionsMap[cache.logType] ?? [];
        if (data.logType === 'DONATION_LOG') {
            if (cache.logType !== ClanLogType.CONTINUOUS_DONATION_LOG && cache.logType !== 'donation_log')
                return null;
            return this.getDonationLogEmbed(cache, webhook, data);
        }
        if (data.type) {
            if (!actions.includes(data.type))
                return null;
            return this.getClanLogEmbed(cache, webhook, data);
        }
        const members = data.members.filter((member) => Object.values(LogActions).includes(member.op));
        if (!members.length)
            return null;
        const delay = members.length >= 5 ? 2000 : 250;
        for (const member of members) {
            if (!actions.includes(LogActions[member.op]))
                continue;
            const result = await this.getPlayerLogEmbed(cache, member, data);
            if (!result)
                continue;
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
                .setLabel('View Profile')
                .setStyle(ButtonStyle.Secondary)
                .setCustomId(this.client.uuid()));
            await this.send(cache, webhook, {
                content: result.content,
                embeds: [result.embed],
                threadId: cache.threadId,
                components: [row]
            });
            await Util.delay(delay);
        }
        return members.length;
    }
    async getPlayerLogEmbed(cache, member, data) {
        const actions = logActionsMap[cache.logType] ?? [];
        if (!actions.includes(LogActions[member.op]))
            return null;
        const { body: player, res } = await this.client.coc.getPlayer(member.tag);
        if (!res.ok)
            return null;
        let content;
        const embed = new EmbedBuilder();
        if (COLOR_MAPS[member.op])
            embed.setColor(COLOR_MAPS[member.op]);
        embed.setTitle(`\u200e${player.name} (${player.tag})`);
        embed.setTimestamp();
        if (!cache.deepLink || cache.deepLink === DEEP_LINK_TYPES.OPEN_IN_COS) {
            embed.setURL(`https://www.clashofstats.com/players/${player.tag.slice(1)}`);
        }
        else {
            embed.setURL(`https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${encodeURIComponent(player.tag)}`);
        }
        if (member.op === LogActions.NAME_CHANGE) {
            embed.setDescription(`Name changed from **${member.name}**`);
            embed.setFooter({ text: `${data.clan.name}`, iconURL: data.clan.badge });
        }
        if (member.op === LogActions.PROMOTED) {
            embed.setFooter({ text: `${data.clan.name}`, iconURL: data.clan.badge });
            embed.setDescription(`Was Promoted to **${PLAYER_ROLES_MAP[member.role]}**`);
        }
        if (member.op === LogActions.DEMOTED) {
            embed.setFooter({ text: `${data.clan.name}`, iconURL: data.clan.badge });
            embed.setDescription(`Was Demoted to **${PLAYER_ROLES_MAP[member.role]}**`);
        }
        if (member.op === LogActions.TOWN_HALL_UPGRADE) {
            if (cache.role)
                content = `<@&${cache.role}>`;
            const { id } = parseEmoji(TOWN_HALLS[player.townHallLevel]);
            embed.setThumbnail(`https://cdn.discordapp.com/emojis/${id}.png?v=1`);
            embed.setFooter({ text: `${data.clan.name}`, iconURL: data.clan.badge });
            embed.setDescription(`Town Hall was upgraded to ${player.townHallLevel} with ${this.remainingUpgrades(player)}% remaining troop upgrades.`);
        }
        if (member.op === LogActions.WAR_PREF_CHANGE && player.warPreference) {
            const { id } = parseEmoji(TOWN_HALLS[player.townHallLevel]);
            embed.setThumbnail(`https://cdn.discordapp.com/emojis/${id}.png?v=1`);
            embed.setFooter({ text: `${data.clan.name}`, iconURL: data.clan.badge });
            if (player.warPreference === 'in') {
                embed.setDescription(`**Opted in** for clan wars.`);
                embed.setColor(COLOR_CODES.DARK_GREEN);
            }
            if (player.warPreference === 'out') {
                embed.setDescription(`**Opted out** of clan wars.`);
                embed.setColor(COLOR_CODES.DARK_RED);
            }
        }
        if (member.op === LogActions.CAPITAL_GOLD_CONTRIBUTION) {
            embed.setFooter({ text: `${data.clan.name}`, iconURL: data.clan.badgeUrl });
            embed.setDescription(`${EMOJIS.CAPITAL_GOLD} Contributed **${member.contributed.toLocaleString()}** Capital Gold`);
        }
        if (member.op === LogActions.CAPITAL_GOLD_RAID) {
            embed.setFooter({ text: `${data.clan.name}`, iconURL: data.clan.badgeUrl });
            embed.setDescription(`${EMOJIS.CAPITAL_RAID} Raided **${member.looted.toLocaleString()}** Capital Gold (${member.attacks}/${member.attackLimit})`);
        }
        if (member.op === LogActions.LEFT) {
            if (player.clan && player.clan.tag !== data.clan.tag) {
                embed.setFooter({
                    text: `Left ${data.clan.name} [${data.memberList.length}/50] \nJoined ${player.clan.name}`,
                    iconURL: data.clan.badge
                });
            }
            else {
                embed.setFooter({
                    text: `Left ${data.clan.name} [${data.memberList.length}/50]`,
                    iconURL: data.clan.badge
                });
            }
            embed.setDescription([
                `${TOWN_HALLS[player.townHallLevel]} **${player.townHallLevel}**`,
                `${HOME_BASE_LEAGUES[player.leagueTier?.id ?? UNRANKED_TIER_ID]}**${player.trophies}**`,
                `${EMOJIS.TROOPS_DONATE} **${member.donations}**${EMOJIS.UP_KEY} **${member.donationsReceived}**${EMOJIS.DOWN_KEY}`,
                ['admin', 'leader', 'coLeader'].includes(member.role)
                    ? `(${PLAYER_ROLES_MAP[member.role]})`
                    : ''
            ].join(' '));
        }
        if (member.op === LogActions.JOINED) {
            embed.setFooter({
                text: `Joined ${data.clan.name} [${data.memberList.length}/50]`,
                iconURL: data.clan.badge
            });
            const heroes = player.heroes.filter((hero) => hero.village === 'home');
            embed.setDescription([
                `${TOWN_HALLS[player.townHallLevel]}**${player.townHallLevel}**`,
                `${HOME_BASE_LEAGUES[player.leagueTier?.id ?? UNRANKED_TIER_ID]}**${player.trophies}**`,
                `${this.formatHeroes(heroes)}`,
                `${heroes.length >= 2 ? '\n' : ''}${EMOJIS.WAR_STAR}**${player.warStars}**`,
                `${EMOJIS.TROOPS}${this.remainingUpgrades(player)}% Rushed`
            ].join(' '));
            if (!this.client.settings.get(cache.guild, "hasFlagAlertLog" /* Settings.HAS_FLAG_ALERT_LOG */, false)) {
                const flag = await this.client.db.collection("Flags" /* Collections.FLAGS */).findOne({
                    guild: cache.guild,
                    tag: member.tag,
                    flagType: 'ban',
                    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
                });
                if (flag) {
                    const user = await this.client.users.fetch(flag.user, { cache: false }).catch(() => null);
                    if (cache.role)
                        content = `<@&${cache.role}>`;
                    embed.setDescription([
                        embed.data.description,
                        '',
                        '**Flag**',
                        `${flag.reason}`,
                        `\`${user ? user.displayName : 'Unknown'} (${moment.utc(flag.createdAt).format('DD-MM-YYYY kk:mm')})\``
                    ].join('\n'));
                }
            }
        }
        return { embed, content };
    }
    async getClanLogEmbed(cache, webhook, data) {
        const embed = new EmbedBuilder()
            .setColor(COLOR_CODES.CYAN)
            .setTitle(`\u200e${data.clan.name} (${data.clan.tag})`);
        if (data.clan.badge)
            embed.setThumbnail(data.clan.badge);
        if (data.type === LogActions.CLAN_LEVEL_UP) {
            embed.setDescription(`Clan leveled up to **${data.clan.level}**`);
        }
        if (data.type === LogActions.CAPITAL_HALL_LEVEL_UP) {
            embed.setDescription(`Capital Hall leveled up to **${data.clan.capitalHallLevel}**`);
        }
        if (data.type === LogActions.CAPITAL_LEAGUE_CHANGE) {
            const isPromoted = this.isPromoted(data.clan.capitalLeague, data.clan.oldCapitalLeague);
            embed.setColor(isPromoted ? COLOR_CODES.DARK_GREEN : COLOR_CODES.DARK_RED);
            embed.setDescription(`Capital League was ${isPromoted ? 'promoted' : 'demoted'} to **${data.clan.capitalLeague.name}**`);
        }
        if (data.type === LogActions.WAR_LEAGUE_CHANGE) {
            const isPromoted = this.isPromoted(data.clan.warLeague, data.clan.oldWarLeague);
            embed.setColor(isPromoted ? COLOR_CODES.DARK_GREEN : COLOR_CODES.DARK_RED);
            embed.setDescription(`War League was ${isPromoted ? 'promoted' : 'demoted'} to **${data.clan.warLeague.name}**`);
        }
        return this.send(cache, webhook, {
            embeds: [embed],
            threadId: cache.threadId
        });
    }
    async getDonationLogEmbed(cache, webhook, data) {
        const embed = new EmbedBuilder()
            .setTitle(`${data.clan.name} (${data.clan.tag})`)
            .setURL(`https://link.clashofclans.com/en?action=OpenClanProfile&tag=${encodeURIComponent(data.clan.tag)}`);
        if (data.clan.badgeUrl)
            embed.setThumbnail(data.clan.badgeUrl);
        if (data.clan.badgeUrl)
            embed.setFooter({ text: `${data.clan.members}/50`, iconURL: data.clan.badgeUrl });
        else
            embed.setFooter({ text: `${data.clan.members}/50` });
        embed.setTimestamp();
        embed.setColor(COLOR_CODES.PURPLE);
        const donatingMembers = data.members.filter((m) => m.op === LogActions.DONATED);
        if (donatingMembers.length) {
            embed.addFields([
                {
                    name: `${EMOJIS.USER_BLUE} Donated`,
                    value: donatingMembers
                        .map((m) => {
                        const townHall = TOWN_HALLS[m.townHallLevel] ?? '';
                        const amount = m.donations ?? 0;
                        const emoji = BLUE_NUMBERS[amount.toString()] ?? `**${amount}**`;
                        return `\u200e${townHall} ${emoji} ${m.name}`;
                    })
                        .join('\n')
                        .slice(0, 1024)
                }
            ]);
        }
        const receivingMembers = data.members.filter((m) => m.op === LogActions.RECEIVED);
        if (receivingMembers.length) {
            embed.addFields([
                {
                    name: `${EMOJIS.USER_RED} Received`,
                    value: receivingMembers
                        .map((m) => {
                        const townHall = TOWN_HALLS[m.townHallLevel] ?? '';
                        const amount = m.donationsReceived ?? 0;
                        const emoji = RED_NUMBERS[amount.toString()] ?? `**${amount}**`;
                        return `\u200e${townHall} ${emoji} ${m.name}`;
                    })
                        .join('\n')
                        .slice(0, 1024)
                }
            ]);
        }
        return this.send(cache, webhook, {
            embeds: [embed],
            threadId: cache.threadId
        });
    }
    formatHeroes(heroes) {
        return heroes.length
            ? `${heroes.map((hero) => `${HEROES[hero.name]}**${hero.level}**`).join(' ')}`
            : ``;
    }
    divMod(num) {
        return [Math.floor(num / 100) * 100, num % 100];
    }
    isPromoted(current, old) {
        if (!current?.id)
            return false;
        if (!old?.id)
            return true;
        return current.id > old.id;
    }
    remainingUpgrades(data) {
        const apiTroops = unitsFlatten(data, { withEquipment: true });
        const rem = RAW_TROOPS_FILTERED.reduce((prev, unit) => {
            const apiTroop = apiTroops.find((u) => u.name === unit.name && u.village === unit.village && u.type === unit.category);
            if (unit.village === 'home') {
                prev.levels += Math.min(apiTroop?.level ?? 0, unit.levels[data.townHallLevel - 2]);
                prev.total += unit.levels[data.townHallLevel - 2];
            }
            return prev;
        }, { total: 0, levels: 0 });
        if (rem.total === 0)
            return (0).toFixed(2);
        return (100 - (rem.levels * 100) / rem.total).toFixed(2);
    }
    async send(cache, webhook, payload) {
        try {
            return await super.sendMessage(cache, webhook, payload);
        }
        catch (error) {
            this.client.logger.error(`${error.toString()} {${cache._id.toString()}}`, {
                label: ClanLog.name
            });
            return null;
        }
    }
    async init() {
        const guildIds = this.client.guilds.cache.map((guild) => guild.id);
        for await (const data of this.collection.find({
            isEnabled: true,
            logType: { $in: this.logTypes },
            guildId: { $in: guildIds }
        })) {
            this.setCache(data);
        }
    }
    async add(guildId) {
        for await (const data of this.collection.find({
            guildId,
            isEnabled: true,
            logType: { $in: this.logTypes }
        })) {
            this.setCache(data);
        }
    }
    get logTypes() {
        return [
            ClanLogType.MEMBER_JOIN_LEAVE_LOG,
            ClanLogType.TOWN_HALL_UPGRADE_LOG,
            ClanLogType.ROLE_CHANGE_LOG,
            ClanLogType.ROLE_CHANGE_LOG,
            ClanLogType.WAR_PREFERENCE_LOG,
            ClanLogType.NAME_CHANGE_LOG,
            ClanLogType.HERO_UPGRADE_LOG,
            ClanLogType.CONTINUOUS_DONATION_LOG,
            ClanLogType.CLAN_ACHIEVEMENTS_LOG,
            ClanLogType.CLAN_CAPITAL_CONTRIBUTION_LOG,
            ClanLogType.CLAN_CAPITAL_RAID_LOG
        ];
    }
    setCache(data) {
        this.cached.set(data._id.toHexString(), {
            _id: data._id,
            guild: data.guildId,
            channel: data.channelId,
            tag: data.clanTag,
            role: data.roleId,
            deepLink: data.deepLink,
            logType: data.logType,
            retries: 0,
            webhook: data.webhook?.id ? new WebhookClient(data.webhook) : null
        });
    }
}
//# sourceMappingURL=clan-log.js.map