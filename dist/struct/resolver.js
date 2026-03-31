import { DISCORD_ID_REGEX, DISCORD_MENTION_REGEX, ESCAPE_CHAR_REGEX, TAG_REGEX, getHttpStatusText } from '../util/constants.js';
import { MessageFlags } from 'discord.js';
import { ObjectId } from 'mongodb';
import { i18n } from '../util/i18n.js';
export class Resolver {
    constructor(client) {
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
    }
    async resolvePlayer(interaction, args) {
        args = (args?.replace(ESCAPE_CHAR_REGEX, '') ?? '').trim();
        const parsed = await this.parseArgument(interaction, args);
        if (parsed.isTag)
            return this.getPlayer(interaction, args);
        if (!parsed.user) {
            return this.fail(interaction, `**${getHttpStatusText(404, interaction.locale)}**`);
        }
        const { user } = parsed;
        const linkedPlayerTag = await this.getLinkedPlayerTag(user.id);
        if (linkedPlayerTag)
            return this.getPlayer(interaction, linkedPlayerTag, user);
        if (interaction.user.id === user.id) {
            return this.fail(interaction, i18n('common.no_player_tag', {
                lng: interaction.locale,
                command: this.client.commands.LINK_CREATE
            }));
        }
        return this.fail(interaction, i18n('common.player_not_linked', {
            lng: interaction.locale,
            user: parsed.user.displayName,
            command: this.client.commands.LINK_CREATE
        }));
    }
    async clanAlias(guildId, alias) {
        if (!guildId)
            return null;
        return this.client.db
            .collection("ClanStores" /* Collections.CLAN_STORES */)
            .findOne({ guild: guildId, alias }, { collation: { strength: 2, locale: 'en' }, projection: { tag: 1, name: 1 } });
    }
    async resolveClan(interaction, args) {
        args = (args?.replace(ESCAPE_CHAR_REGEX, '') ?? '').trim();
        const parsed = await this.parseArgument(interaction, args);
        const clan = await this.clanAlias(interaction.guildId, args.trim());
        if (parsed.isTag)
            return this.getClan(interaction, clan && !args.startsWith('#') ? clan.tag : args, true);
        if (!parsed.user) {
            if (clan)
                return this.getClan(interaction, clan.tag);
            return this.fail(interaction, `**${getHttpStatusText(404, interaction.locale)}**`);
        }
        if (parsed.matched) {
            const linkedClanTag = await this.getLinkedUserClan(parsed.user.id, false);
            if (linkedClanTag)
                return this.getClan(interaction, linkedClanTag);
        }
        else {
            const linkedClanTag = await this.getLinkedClanTag(interaction, parsed.user.id);
            if (linkedClanTag)
                return this.getClan(interaction, linkedClanTag);
        }
        if (interaction.user.id === parsed.user.id) {
            return this.fail(interaction, i18n('common.no_clan_tag', {
                lng: interaction.locale,
                command: this.client.commands.LINK_CREATE
            }));
        }
        return this.fail(interaction, i18n('common.clan_not_linked', {
            lng: interaction.locale,
            user: parsed.user.displayName,
            command: this.client.commands.LINK_CREATE
        }));
    }
    async getPlayer(interaction, tag, user) {
        const { body, res } = await this.client.coc.getPlayer(tag);
        if (res.ok)
            this.updateLastSearchedPlayer(interaction.user, body);
        if (res.ok)
            return { ...body, user };
        return this.fail(interaction, `**${getHttpStatusText(res.status, interaction.locale)}**`);
    }
    async getClan(interaction, tag, checkAlias = false) {
        const { body, res } = await this.client.coc.getClan(tag);
        if (res.ok)
            this.updateLastSearchedClan(interaction.user, body);
        if (res.ok)
            return body;
        if (checkAlias && res.status === 404 && !tag.startsWith('#')) {
            const clan = await this.clanAlias(interaction.guildId, tag);
            if (clan)
                return this.getClan(interaction, clan.tag);
        }
        return this.fail(interaction, `**${getHttpStatusText(res.status, interaction.locale)}**`);
    }
    async updateLastSearchedPlayer(user, player) {
        await this.client.db.collection("Users" /* Collections.USERS */).updateOne({ userId: user.id }, {
            $set: {
                lastSearchedPlayerTag: player.tag,
                discriminator: user.discriminator,
                displayName: user.displayName,
                username: user.username
            }
        }, { upsert: true });
    }
    async updateLastSearchedClan(user, clan) {
        await this.client.db.collection("Users" /* Collections.USERS */).updateOne({ userId: user.id }, {
            $set: {
                lastSearchedClanTag: clan.tag,
                discriminator: user.discriminator,
                displayName: user.displayName,
                username: user.username
            }
        }, { upsert: true });
    }
    async fail(interaction, content) {
        if (interaction.isCommand()) {
            return interaction.editReply({ content }).then(() => null);
        }
        else if (interaction.isMessageComponent()) {
            return interaction.followUp({ content, flags: MessageFlags.Ephemeral }).then(() => null);
        }
        return null;
    }
    async parseArgument(interaction, args) {
        if (!args)
            return { user: interaction.user, matched: false, isTag: false };
        const id = DISCORD_MENTION_REGEX.exec(args)?.[1] ?? DISCORD_ID_REGEX.exec(args)?.[0];
        if (id) {
            const user = this.client.users.cache.get(id) ?? (await this.client.users.fetch(id).catch(() => null));
            if (user)
                return { user, matched: true, isTag: false };
            return { user: null, matched: true, isTag: false };
        }
        return { user: null, matched: false, isTag: TAG_REGEX.test(args) };
    }
    async getLinkedClanTag(interaction, userId) {
        const [guildLinkedClan, userLinkedClanTag] = await Promise.all([
            interaction.guildId && interaction.channelId
                ? this.client.db
                    .collection("ClanStores" /* Collections.CLAN_STORES */)
                    .findOne({ channels: interaction.channelId, guild: interaction.guildId })
                : null,
            this.getLinkedUserClan(userId, true)
        ]);
        return guildLinkedClan?.tag ?? userLinkedClanTag;
    }
    async getLinkedPlayerTag(userId) {
        const [linkedPlayer, lastSearchedPlayerTag] = await Promise.all([
            this.client.db
                .collection("PlayerLinks" /* Collections.PLAYER_LINKS */)
                .findOne({ userId }, { sort: { order: 1 } }),
            this.getLastSearchedPlayerTag(userId)
        ]);
        if (!linkedPlayer) {
            const externalLinks = await this.client.coc.getPlayerTags(userId);
            return externalLinks.at(0) ?? lastSearchedPlayerTag;
        }
        return linkedPlayer?.tag ?? lastSearchedPlayerTag;
    }
    async getLinkedUserClan(userId, withLastSearchedClan = false) {
        const user = await this.client.db.collection("Users" /* Collections.USERS */).findOne({ userId });
        return user?.clan?.tag ?? (withLastSearchedClan ? user?.lastSearchedClanTag : null) ?? null;
    }
    async getLastSearchedPlayerTag(userId) {
        const user = await this.client.db.collection("Users" /* Collections.USERS */).findOne({ userId });
        return user?.lastSearchedPlayerTag ?? null;
    }
    async getLinkedPlayerTags(userId) {
        const [players, others] = await Promise.all([
            this.client.db.collection("PlayerLinks" /* Collections.PLAYER_LINKS */).find({ userId }).toArray(),
            this.client.coc.getPlayerTags(userId)
        ]);
        return Array.from(new Set([...players.map((en) => en.tag), ...others.map((tag) => tag)]));
    }
    async getLinkedUsersMap(players) {
        const fetched = await Promise.all([
            this.client.coc.getDiscordLinks(players),
            this.client.db
                .collection("PlayerLinks" /* Collections.PLAYER_LINKS */)
                .find({ tag: { $in: players.map((player) => player.tag) } })
                .toArray()
        ]);
        const result = fetched.flat().map((link) => ({
            tag: link.tag,
            userId: link.userId,
            verified: link.verified,
            username: link.username,
            displayName: link.displayName || link.username
        }));
        return result.reduce((acc, link) => {
            acc[link.tag] ??= link;
            const prev = acc[link.tag];
            if (!prev.verified && link.verified)
                acc[link.tag].verified = true;
            if (prev.username === 'unknown' && link.username !== 'unknown') {
                acc[link.tag].username = link.username;
                acc[link.tag].displayName = link.displayName;
            }
            if (prev.userId !== link.userId)
                acc[link.tag] = link;
            return acc;
        }, {});
    }
    async getLinkedUsers(players) {
        const users = await this.getLinkedUsersMap(players);
        return Object.values(users);
    }
    async getUser(playerTag) {
        const link = await this.client.db
            .collection("PlayerLinks" /* Collections.PLAYER_LINKS */)
            .findOne({ tag: playerTag });
        if (!link)
            return null;
        return this.client.users.fetch(link.userId).catch(() => null);
    }
    async getPlayers(userId, limit = 25) {
        const [players, others] = await Promise.all([
            this.client.db
                .collection("PlayerLinks" /* Collections.PLAYER_LINKS */)
                .find({ userId })
                .sort({ order: 1 })
                .toArray(),
            this.client.coc.getPlayerTags(userId)
        ]);
        const verifiedPlayersMap = players.reduce((prev, curr) => {
            prev[curr.tag] = Boolean(curr.verified);
            return prev;
        }, {});
        const playerTagSet = new Set([...players.map((en) => en.tag), ...others.map((tag) => tag)]);
        const playerTags = Array.from(playerTagSet)
            .slice(0, limit)
            .map((tag) => this.client.coc.getPlayer(tag));
        const result = (await Promise.all(playerTags))
            .filter(({ res }) => res.ok)
            .map(({ body }) => body);
        return result.map((player) => ({ ...player, verified: verifiedPlayersMap[player.tag] }));
    }
    async getClansFromCategory(guildId, categoryId) {
        const clans = await this.client.db
            .collection("ClanStores" /* Collections.CLAN_STORES */)
            .find({
            guild: guildId,
            categoryId: ObjectId.isValid(categoryId) ? new ObjectId(categoryId) : null
        })
            .toArray();
        return clans.map((clan) => clan.tag);
    }
    async resolveArgs(args) {
        if (!args || args === '*')
            return [];
        if (/^CATEGORY:/.test(args)) {
            const [, guildId, categoryId] = args.split(':');
            return this.getClansFromCategory(guildId, categoryId);
        }
        return args
            .split(/\W+/)
            .map((tag) => (TAG_REGEX.test(tag) ? this.client.coc.fixTag(tag) : tag));
    }
    async enforceSecurity(interaction, { collection, tag }) {
        if (!tag) {
            await interaction.editReply(i18n('common.no_clan_tag_first_time', { lng: interaction.locale }));
            return null;
        }
        const data = await this.getClan(interaction, tag, true);
        if (!data)
            return null;
        // Patreon gating removed — all clans are permitted, no subscriber check needed.
        // Clan verification (leader/co-leader ownership proof) is still enforced for new clans
        // that are popular (appear in >10 servers) to prevent abuse.
        const memberCount = interaction.guild.memberCount;
        const [clans] = await Promise.all([this.client.storage.find(interaction.guildId)]);
        const links = await this.client.db
            .collection("PlayerLinks" /* Collections.PLAYER_LINKS */)
            .find({ userId: interaction.user.id })
            .toArray();
        const count = await this.client.db
            .collection("ClanStores" /* Collections.CLAN_STORES */)
            .countDocuments({ tag: data.tag, guild: { $ne: interaction.guildId } });
        const code = ['CM', interaction.guild.id.slice(-2)].join(''); // CM = clashmate
        const clan = clans.find((clan) => clan.tag === data.tag);
        if (collection !== "ClanStores" /* Collections.CLAN_STORES */ &&
            count > 10 &&
            !clan?.verified &&
            !this.verifyClan(code, data, links) &&
            !this.client.isOwner(interaction.user) &&
            !this.client.isOwner(interaction.guild.ownerId)) {
            await interaction.editReply({
                content: i18n('common.clan_verification', {
                    lng: interaction.locale,
                    code,
                    command: this.client.commands.VERIFY
                })
            });
            return null;
        }
        return data;
    }
    verifyClan(code, clan, tags) {
        const verifiedTags = tags.filter((en) => en.verified).map((en) => en.tag);
        return (clan.memberList
            .filter((m) => ['coLeader', 'leader'].includes(m.role))
            .some((m) => verifiedTags.includes(m.tag)) || clan.description.toUpperCase().includes(code));
    }
}
//# sourceMappingURL=resolver.js.map