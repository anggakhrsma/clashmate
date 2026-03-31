import Google from './google.js';
import { COLOR_CODES, DiscordErrorCodes, MAX_TOWN_HALL_LEVEL, UNRANKED_TIER_ID, UNRANKED_WAR_LEAGUE_ID } from '../util/constants.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits, WebhookClient, time } from 'discord.js';
import moment from 'moment-timezone';
import { ObjectId } from 'mongodb';
import { EventEmitter } from 'node:events';
import { parallel, unique } from 'radash';
import { EMOJIS, HOME_BASE_LEAGUES, TOWN_HALLS } from '../util/emojis.js';
import { Util } from '../util/toolkit.js';
const roleNames = {
    member: 'Mem',
    admin: 'Eld',
    coLeader: 'Co',
    leader: 'Lead'
};
export const rosterLayoutMap = {
    '#': {
        width: 2,
        label: '#',
        isEmoji: false,
        key: 'index',
        align: 'right',
        name: 'Index',
        description: 'The index of the player in the roster.'
    },
    'TH': {
        width: 2,
        label: 'TH',
        isEmoji: false,
        key: 'townHallLevel',
        align: 'right',
        name: 'Town Hall Level',
        description: 'The Town Hall level of the player.'
    },
    'TH_ICON': {
        width: 1,
        label: EMOJIS.TOWN_HALL,
        isEmoji: true,
        key: 'townHallIcon',
        align: 'left',
        name: 'Town Hall Icon',
        description: 'The Town Hall icon of the player.'
    },
    'DISCORD': {
        width: 12,
        label: 'DISCORD',
        isEmoji: false,
        key: 'displayName',
        align: 'left',
        name: 'Discord Name',
        description: 'The Discord displayName of the player.'
    },
    'USERNAME': {
        width: 12,
        label: 'USERNAME',
        isEmoji: false,
        key: 'username',
        align: 'left',
        name: 'Discord Username',
        description: 'The Discord username of the player.'
    },
    'DISCORD_ID': {
        width: 19,
        label: 'USER ID',
        isEmoji: false,
        key: 'userId',
        align: 'left',
        name: 'Discord User ID',
        description: 'The Discord User ID of the player.'
    },
    'NAME': {
        width: 12,
        label: 'PLAYER',
        isEmoji: false,
        key: 'name',
        align: 'left',
        name: 'Player Name',
        description: 'The name of the player.'
    },
    'TAG': {
        width: 10,
        label: 'TAG',
        isEmoji: false,
        key: 'tag',
        align: 'left',
        name: 'Player Tag',
        description: 'The tag of the player.'
    },
    'CLAN': {
        width: 6,
        label: 'CLAN',
        isEmoji: false,
        key: 'clanName',
        align: 'left',
        name: 'Clan Name / Alias',
        description: 'The clan name of the player.'
    },
    'HERO_LEVEL': {
        width: 4,
        label: 'HERO',
        isEmoji: false,
        key: 'heroes',
        align: 'right',
        name: 'Combined Hero Level',
        description: 'The combined hero level of the player.'
    },
    'ROLE': {
        width: 4,
        label: 'ROLE',
        isEmoji: false,
        key: 'role',
        align: 'left',
        name: 'Role',
        description: 'The role of the player in the clan.'
    },
    'PREF': {
        width: 4,
        label: 'PREF',
        isEmoji: false,
        key: 'warPreference',
        align: 'left',
        name: 'War Preference',
        description: 'The war preference of the player in the clan.'
    },
    'TROPHIES': {
        width: 6,
        label: 'TROPHY',
        isEmoji: false,
        key: 'trophies',
        align: 'right',
        name: 'Trophies',
        description: 'The trophies of the player.'
    },
    'LEAGUE_ICONS': {
        width: 1,
        label: EMOJIS.TROPHY,
        isEmoji: true,
        key: 'leagueIcon',
        align: 'left',
        name: 'League Icon',
        description: 'The league icon of the player.'
    }
};
export const DEFAULT_ROSTER_LAYOUT = '#/TH_ICON/DISCORD/NAME/CLAN';
export const DEFAULT_TROPHY_ROSTER_LAYOUT = '#/TH_ICON/TROPHIES/NAME';
export const RosterEvents = {
    ROSTER_MEMBER_ADDED: 'roster_member_added',
    ROSTER_MEMBER_REMOVED: 'roster_member_removed',
    ROSTER_MEMBER_GROUP_CHANGED: 'roster_member_group_changed'
};
export const ROSTER_MAX_LIMIT = 65;
export class RosterManager {
    constructor(client) {
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
        Object.defineProperty(this, "rosters", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "categories", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "queued", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Set()
        });
        Object.defineProperty(this, "timeoutId", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "_emitter", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new EventEmitter()
        });
        this.rosters = this.client.db.collection("Rosters" /* Collections.ROSTERS */);
        this.categories = this.client.db.collection("RosterCategories" /* Collections.ROSTER_CATEGORIES */);
        this.on(RosterEvents.ROSTER_MEMBER_ADDED, this.onRosterMemberAdded.bind(this));
        this.on(RosterEvents.ROSTER_MEMBER_REMOVED, this.onRosterMemberRemoved.bind(this));
        this.on(RosterEvents.ROSTER_MEMBER_GROUP_CHANGED, this.onRosterMemberGroupChanged.bind(this));
    }
    emit(event, ...args) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - this is fine
        this._emitter.emit(event, ...args);
    }
    on(event, listener) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - this is fine
        this._emitter.on(event, (...args) => listener(...args));
    }
    async onRosterMemberAdded() { }
    async onRosterMemberGroupChanged() { }
    async onRosterMemberRemoved() { }
    async create(roster) {
        const { insertedId } = await this.rosters.insertOne(roster);
        return { ...roster, _id: insertedId };
    }
    async edit(rosterId, data) {
        const value = await this.rosters.findOneAndUpdate({ _id: rosterId }, { $set: data }, { returnDocument: 'after' });
        return value;
    }
    async delete(rosterId) {
        return this.rosters.deleteOne({ _id: rosterId });
    }
    async query(query, withMembers = false) {
        const cursor = this.rosters.aggregate([
            { $match: { ...query } },
            { $set: { memberCount: { $size: '$members' } } },
            ...(withMembers ? [] : [{ $set: { members: [] } }]),
            { $sort: { _id: -1 } }
        ]);
        return cursor.toArray();
    }
    async list(guildId, withMembers = false) {
        return this.query({ guildId }, withMembers);
    }
    async search(guildId, query) {
        return this.query({ guildId, $text: { $search: query } });
    }
    async clear(rosterId) {
        const roster = await this.rosters.findOne({ _id: rosterId });
        return this.clearRoster(roster);
    }
    async close(rosterId) {
        const value = await this.rosters.findOneAndUpdate({ _id: rosterId }, { $set: { closed: true } }, { returnDocument: 'after' });
        return value;
    }
    async open(rosterId) {
        const value = await this.rosters.findOneAndUpdate({ _id: rosterId }, { $set: { closed: false } }, { returnDocument: 'after' });
        return value;
    }
    async attachSheetId(rosterId, sheetId) {
        const value = await this.rosters.findOneAndUpdate({ _id: rosterId }, { $set: { sheetId } }, { returnDocument: 'after' });
        return value;
    }
    async get(rosterId) {
        return this.rosters.findOne({ _id: rosterId });
    }
    async attemptSignup({ roster, player, user, isOwner, isDryRun = false }) {
        if (roster.startTime && roster.startTime > new Date()) {
            return {
                success: false,
                message: `This roster will open on ${time(roster.startTime)} (${time(roster.startTime, 'R')})`
            };
        }
        if (this.isClosed(roster)) {
            return {
                success: false,
                message: 'This roster is closed.'
            };
        }
        if (!user && !roster.allowUnlinked) {
            const linkCommand = this.client.commands.LINK_CREATE;
            return {
                success: false,
                message: isOwner
                    ? `You are not linked to any players. Please link your account with ${linkCommand} or use the \`allow_unlinked\` option to allow unlinked players to signup.`
                    : `This player is not linked to any users. Please link their account with ${linkCommand} or use the \`allow_unlinked\` option to allow unlinked players to signup.`
            };
        }
        const maxMembers = roster.maxMembers ?? ROSTER_MAX_LIMIT;
        if (roster.members.length >= maxMembers) {
            return {
                success: false,
                message: `This roster is full (maximum ${maxMembers} members).`
            };
        }
        if (roster.maxAccountsPerUser && user) {
            const count = roster.members.filter((m) => m.userId === user.id).length;
            if (count >= roster.maxAccountsPerUser) {
                return {
                    success: false,
                    message: `${isOwner ? 'You have' : 'This player has'} reached the maximum number of accounts allowed per user (${roster.maxAccountsPerUser}).`
                };
            }
        }
        if (roster.minTownHall && player.townHallLevel < roster.minTownHall) {
            return {
                success: false,
                message: `This roster requires a minimum Town Hall level of ${roster.minTownHall}.`
            };
        }
        if (roster.maxTownHall && player.townHallLevel > roster.maxTownHall) {
            return {
                success: false,
                message: `This roster requires a maximum Town Hall level of ${roster.maxTownHall}.`
            };
        }
        const heroes = player.heroes.filter((hero) => hero.village === 'home');
        const sumOfHeroLevels = heroes.reduce((total, curr) => total + curr.level, 0);
        if (roster.minHeroLevels && sumOfHeroLevels < roster.minHeroLevels) {
            return {
                success: false,
                message: `This roster requires a minimum combined hero level of ${roster.minHeroLevels}.`
            };
        }
        if (roster.members.some((m) => m.tag === player.tag)) {
            return {
                success: false,
                message: isOwner
                    ? 'You are already signed up for this roster.'
                    : 'This player is already signed up for this roster.'
            };
        }
        if (!roster.allowMultiSignup && !isDryRun) {
            const dup = await this.rosters.findOne({
                '_id': { $ne: roster._id },
                'closed': false,
                'guildId': roster.guildId,
                'members.tag': player.tag,
                'category': roster.category
            }, { projection: { members: 0 } });
            if (dup) {
                return {
                    success: false,
                    message: isOwner
                        ? `You are already signed up for another roster (${rosterLabel(dup)})`
                        : `This player is already signed up for another roster (${rosterLabel(dup)})`
                };
            }
        }
        if (roster.allowMultiSignup && !isDryRun) {
            const dup = await this.rosters.findOne({
                '_id': { $ne: roster._id },
                'closed': false,
                'guildId': roster.guildId,
                'members.tag': player.tag,
                'allowMultiSignup': false,
                'category': roster.category
            }, { projection: { members: 0 } });
            if (dup && !dup.allowMultiSignup) {
                return {
                    success: false,
                    message: isOwner
                        ? `You are already signed up for another roster (${rosterLabel(dup)}) that does not allow multi-signup.`
                        : `This player is already signed up for another roster (${rosterLabel(dup)}) that does not allow multi-signup.`
                };
            }
        }
        return { success: true, message: 'Success!' };
    }
    async signup({ interaction, rosterId, player, user, categoryId, isDryRun = false }) {
        const roster = await this.rosters.findOne({ _id: rosterId });
        if (!roster) {
            await interaction.followUp({
                content: 'This roster no longer exists.',
                flags: MessageFlags.Ephemeral
            });
            return false;
        }
        const isOwner = interaction.user.id === user?.id;
        const attempt = await this.attemptSignup({
            roster,
            player,
            user,
            isOwner,
            isDryRun
        });
        if (!attempt.success) {
            await interaction.followUp({ content: attempt.message, flags: MessageFlags.Ephemeral });
            return false;
        }
        if (isDryRun)
            return roster; // DRY RUN BABY
        const value = await this.signupUser({ roster, player, user, categoryId });
        if (!value) {
            await interaction.followUp({
                content: 'This roster no longer exists.',
                flags: MessageFlags.Ephemeral
            });
            return false;
        }
        return value;
    }
    async selfSignup({ rosterId, player, user, categoryId, isDryRun = false, isOwner = true }) {
        const roster = await this.rosters.findOne({ _id: rosterId });
        if (!roster)
            return { success: false, message: 'This roster no longer exists.' };
        const attempt = await this.attemptSignup({
            roster,
            player,
            user,
            isOwner,
            isDryRun
        });
        if (!attempt.success)
            return attempt;
        if (isDryRun)
            return { success: true, message: 'Success!', roster };
        const value = await this.signupUser({ roster, player, user, categoryId });
        if (!value)
            return { success: false, message: 'This roster no longer exists.' };
        return { success: true, message: 'Success!', roster: value };
    }
    async signupUser({ roster, player, user, categoryId }) {
        const category = categoryId ? await this.getCategory(new ObjectId(categoryId)) : null;
        const heroes = player.heroes.filter((hero) => hero.village === 'home');
        const member = {
            name: player.name,
            tag: player.tag,
            userId: user?.id ?? null,
            username: user?.username ?? null,
            displayName: user?.displayName ?? null,
            warPreference: player.warPreference ?? null,
            role: player.role ?? null,
            trophies: player.trophies,
            leagueId: player.leagueTier?.id ?? UNRANKED_TIER_ID,
            heroes: heroes.reduce((prev, curr) => ({ ...prev, [curr.name]: curr.level }), {}),
            townHallLevel: player.townHallLevel,
            clan: player.clan ? { name: player.clan.name, tag: player.clan.tag } : null,
            categoryId: category ? category._id : null,
            createdAt: new Date()
        };
        const value = await this.rosters.findOneAndUpdate({ _id: roster._id }, { $push: { members: { ...member } } }, { returnDocument: 'after' });
        if (!value)
            return null;
        if (!user)
            return value;
        const roleIds = [];
        if (roster.roleId)
            roleIds.push(roster.roleId);
        if (category?.roleId)
            roleIds.push(category.roleId);
        if (roleIds.length)
            await this.addRole(value.guildId, roleIds, user.id);
        return value;
    }
    async optOut(roster, ...playerTags) {
        const targetedMembers = roster.members.filter((mem) => playerTags.includes(mem.tag));
        if (!targetedMembers.length)
            return roster;
        const value = await this.rosters.findOneAndUpdate({ _id: roster._id }, { $pull: { members: { tag: { $in: playerTags } } } }, { returnDocument: 'after' });
        if (!value)
            return null;
        const affectedUserIds = targetedMembers.filter((mem) => mem.userId).map((mem) => mem.userId);
        const affectedUsers = roster.members.filter((mem) => mem.userId && affectedUserIds.includes(mem.userId));
        const grouped = affectedUsers.reduce((prev, curr) => {
            if (!curr.userId)
                return prev;
            prev[curr.userId] ??= [];
            prev[curr.userId].push(curr);
            return prev;
        }, {});
        const userGroups = Object.entries(grouped);
        const categories = await this.getCategories(value.guildId);
        for (const [userId, members] of userGroups) {
            const roleIds = [];
            if (value.roleId && members.length <= 1)
                roleIds.push(value.roleId);
            // loop through affected members only
            for (const member of members.filter((mem) => playerTags.includes(mem.tag))) {
                if (!member.categoryId)
                    continue;
                const category = categories.find((cat) => cat._id.toHexString() === member.categoryId.toHexString());
                if (!category)
                    continue;
                const categorizedMembers = members.filter((mem) => mem.categoryId && mem.categoryId.toHexString() === category._id.toHexString());
                if (category.roleId && categorizedMembers.length <= 1)
                    roleIds.push(category.roleId);
            }
            if (roleIds.length)
                await this.removeRole(value.guildId, roleIds, userId);
        }
        return value;
    }
    async swapRoster({ oldRoster, player, user, newRosterId, categoryId }) {
        const attempt = await this.selfSignup({
            rosterId: newRosterId,
            player,
            user,
            categoryId,
            isOwner: false,
            isDryRun: true
        });
        if (!attempt.success)
            return attempt;
        await this.optOut(oldRoster, player.tag);
        return this.selfSignup({
            rosterId: newRosterId,
            player,
            user,
            categoryId,
            isOwner: false
        });
    }
    async swapCategory({ roster, player, user, newCategoryId }) {
        const oldCategoryId = roster.members.find((mem) => mem.tag === player.tag)?.categoryId;
        if (oldCategoryId?.toHexString() === newCategoryId?.toHexString())
            return roster;
        if (oldCategoryId) {
            const category = await this.getCategory(oldCategoryId);
            if (category?.roleId && user)
                await this.removeRole(roster.guildId, [category.roleId], user.id);
        }
        if (newCategoryId) {
            const newCategory = await this.getCategory(newCategoryId);
            if (newCategory?.roleId && user)
                await this.addRole(roster.guildId, [newCategory.roleId], user.id);
        }
        const value = await this.rosters.findOneAndUpdate({ '_id': roster._id, 'members.tag': player.tag }, { $set: { 'members.$.categoryId': newCategoryId } }, { returnDocument: 'after' });
        return value;
    }
    async clearRoster(roster) {
        if (!roster)
            return null;
        const _categories = await this.getCategories(roster.guildId);
        const categories = _categories.reduce((prev, curr) => ({ ...prev, [curr._id.toHexString()]: curr }), {});
        const rolesMap = {};
        roster.members.forEach((member) => {
            if (member.userId)
                rolesMap[member.userId] ??= [];
            if (roster.roleId && member.userId)
                rolesMap[member.userId].push(roster.roleId);
            if (member.categoryId && member.userId) {
                const category = categories[member.categoryId.toHexString()];
                if (category?.roleId)
                    rolesMap[member.userId].push(category.roleId);
            }
        });
        const value = await this.rosters.findOneAndUpdate({ _id: roster._id }, { $set: { members: [], lastUpdated: new Date() }, $unset: { sheetId: '' } }, { returnDocument: 'after' });
        if (value)
            this.updateBulkRoles({ roster: value, rolesMap, addRoles: false });
        return value;
    }
    async getClanAliases(guildId, clanTags) {
        const clans = await this.client.db
            .collection("ClanStores" /* Collections.CLAN_STORES */)
            .find({ guild: guildId, tag: { $in: clanTags } })
            .toArray();
        return clans.reduce((prev, curr) => {
            if (!curr.alias)
                return prev;
            return { ...prev, [curr.tag]: curr.alias };
        }, {});
    }
    async updateMembers(roster, members) {
        const aliases = await this.getClanAliases(roster.guildId, [
            ...new Set(members.filter((mem) => mem.clan?.tag).map((mem) => mem.clan.tag))
        ]);
        const players = await Promise.all(members.map((mem) => this.client.coc.getPlayer(mem.tag)));
        const { body, res } = roster.clan
            ? await this.client.coc.getClan(roster.clan.tag)
            : { body: null, res: null };
        const links = await this.client.db
            .collection("PlayerLinks" /* Collections.PLAYER_LINKS */)
            .find({ tag: { $in: members.map((mem) => mem.tag) } })
            .toArray();
        const clan = roster.clan;
        if (res?.ok && body && clan) {
            clan.league = {
                id: body.warLeague?.id ?? UNRANKED_WAR_LEAGUE_ID,
                name: body.warLeague?.name ?? 'Unranked'
            };
            clan.badgeUrl = body.badgeUrls.large;
        }
        const _categories = await this.getCategories(roster.guildId);
        const categories = _categories.reduce((prev, curr) => ({ ...prev, [curr._id.toHexString()]: curr }), {});
        const rolesMap = {};
        members.forEach((member, i) => {
            if (member.userId)
                rolesMap[member.userId] ??= [];
            if (roster.roleId && member.userId)
                rolesMap[member.userId].push(roster.roleId);
            if (member.categoryId && member.userId) {
                const category = categories[member.categoryId.toHexString()];
                if (category?.roleId)
                    rolesMap[member.userId].push(category.roleId);
            }
            const { body: player, res } = players[i];
            if (!res.ok)
                return;
            const link = links.find((link) => link.tag === member.tag);
            if (link && member.userId)
                member.username = link.username;
            if (link && member.userId)
                member.displayName = link.displayName;
            member.name = player.name;
            member.townHallLevel = player.townHallLevel;
            member.warPreference = player.warPreference ?? null;
            member.role = player.role ?? null;
            member.trophies = player.trophies;
            member.leagueId = player.leagueTier?.id ?? UNRANKED_TIER_ID;
            const heroes = player.heroes.filter((hero) => hero.village === 'home');
            member.heroes = heroes.reduce((prev, curr) => ({ ...prev, [curr.name]: curr.level }), {});
            if (player.clan)
                member.clan = {
                    name: player.clan.name,
                    tag: player.clan.tag,
                    alias: aliases[player.clan.tag] || null
                };
            else
                member.clan = null;
        });
        const updated = await this.rosters.findOneAndUpdate({ _id: roster._id }, { $set: { members, clan, lastUpdated: new Date() } }, { returnDocument: 'after' });
        if (updated) {
            this.updateBulkRoles({ roster: updated, rolesMap, addRoles: true });
        }
        return updated;
    }
    getRosterEmbed(roster, categories, multi = false) {
        const categoriesMap = categories.reduce((prev, curr) => ({ ...prev, [curr._id.toHexString()]: curr }), {});
        const sortKey = roster.sortBy ?? 'SIGNUP_TIME';
        roster.members.sort((a, b) => a.name.localeCompare(b.name));
        switch (sortKey) {
            case 'TOWN_HALL_LEVEL':
                roster.members.sort((a, b) => b.townHallLevel - a.townHallLevel);
                break;
            case 'HERO_LEVEL':
                roster.members.sort((a, b) => this.sum(Object.values(a.heroes)) - this.sum(Object.values(b.heroes)));
                break;
            case 'TH_HERO_LEVEL':
                roster.members
                    .sort((a, b) => this.sum(Object.values(b.heroes)) - this.sum(Object.values(a.heroes)))
                    .sort((a, b) => b.townHallLevel - a.townHallLevel);
                break;
            case 'PLAYER_NAME':
                roster.members.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'CLAN_NAME':
                roster.members.sort((a, b) => (a.clan?.name ?? '').localeCompare(b.clan?.name ?? ''));
                break;
            case 'DISCORD_NAME':
                roster.members.sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''));
                break;
            case 'DISCORD_USERNAME':
                roster.members.sort((a, b) => (a.username ?? '').localeCompare(b.username ?? ''));
                break;
            case 'SIGNUP_TIME':
                roster.members.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
                break;
            case 'TROPHIES':
                roster.members.sort((a, b) => b.leagueId - a.leagueId);
                roster.members.sort((a, b) => b.trophies - a.trophies);
                break;
            case 'LEAGUES':
                roster.members.sort((a, b) => b.trophies - a.trophies);
                roster.members.sort((a, b) => b.leagueId - a.leagueId);
                break;
            default:
                roster.members.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
                break;
        }
        const membersGroup = Object.entries(roster.members.reduce((record, mem) => {
            const key = mem.categoryId?.toHexString();
            const categoryId = key && key in categoriesMap ? key : 'none';
            record[categoryId] ??= [];
            record[categoryId].push(mem);
            return record;
        }, {}));
        membersGroup.sort(([a], [b]) => {
            if (a === 'none')
                return 1;
            if (b === 'none')
                return -1;
            return categoriesMap[a].order - categoriesMap[b].order;
        });
        const embed = new EmbedBuilder();
        if (roster.colorCode)
            embed.setColor(roster.colorCode);
        if (roster.clan) {
            embed.setAuthor({
                name: `${roster.clan.name} (${roster.clan.tag})`,
                iconURL: roster.clan.badgeUrl,
                url: this.client.coc.getClanURL(roster.clan.tag)
            });
            embed.setURL(this.client.coc.getClanURL(roster.clan.tag));
        }
        if (roster.category === 'CWL' && roster.clan?.league?.id) {
            embed.setTitle(`${roster.name} (${roster.clan.league.name})`);
        }
        else {
            embed.setTitle(`${roster.name}`);
        }
        const groups = membersGroup.map(([categoryId, members]) => {
            const categoryLabel = categoryId === 'none' ? '**Ungrouped**' : `**${categoriesMap[categoryId].displayName}**`;
            return {
                categoryLabel,
                members: members.map((mem, i) => {
                    const index = `${1 + i}`.padStart(rosterLayoutMap['#'].width, ' ');
                    const name = this.snipe(mem.name, rosterLayoutMap.NAME.width);
                    const tag = this.snipe(mem.tag, rosterLayoutMap.TAG.width);
                    const username = this.snipe(mem.username ?? ' ', rosterLayoutMap.DISCORD.width);
                    const displayName = this.snipe(mem.displayName ?? ' ', rosterLayoutMap.USERNAME.width);
                    const userId = this.snipe(mem.userId ?? ' ', rosterLayoutMap.DISCORD_ID.width);
                    const clanName = roster.useClanAlias
                        ? this.snipe(mem.clan?.alias ?? mem.clan?.name ?? ' ', rosterLayoutMap.CLAN.width)
                        : this.snipe(mem.clan?.name ?? ' ', rosterLayoutMap.CLAN.width);
                    const townHallLevel = `${mem.townHallLevel}`.padStart(rosterLayoutMap.TH.width, ' ');
                    const townHallIcon = TOWN_HALLS[mem.townHallLevel];
                    const leagueIcon = HOME_BASE_LEAGUES[mem.leagueId || UNRANKED_TIER_ID];
                    const trophies = `${mem.trophies}`.padStart(rosterLayoutMap.TROPHIES.width, ' ');
                    const heroes = `${this.sum(Object.values(mem.heroes))}`.padEnd(rosterLayoutMap.HERO_LEVEL.width, ' ');
                    const role = (mem.role ? roleNames[mem.role] : ' ').padEnd(rosterLayoutMap.ROLE.width, ' ');
                    const warPreference = `${mem.warPreference?.toUpperCase() ?? ' '}`.padEnd(rosterLayoutMap.PREF.width, ' ');
                    return {
                        index,
                        name,
                        tag,
                        userId,
                        username,
                        displayName,
                        clanName,
                        townHallLevel,
                        townHallIcon,
                        leagueIcon,
                        heroes,
                        role,
                        trophies,
                        warPreference
                    };
                })
            };
        });
        const layoutId = roster.layout ?? DEFAULT_ROSTER_LAYOUT;
        const layouts = layoutId
            .split('/')
            .filter((k) => k in rosterLayoutMap)
            .map((k) => rosterLayoutMap[k]);
        const heading = layouts
            .map((layout) => {
            const padding = layout.align === 'left' ? 'padEnd' : 'padStart';
            return layout.isEmoji ? layout.label : `\`${layout.label[padding](layout.width, ' ')}\``;
        })
            .join(' ')
            .replace(/` `/g, ' ');
        const rosterContent = [
            heading,
            ...groups.flatMap(({ categoryLabel, members }) => [
                `${categoryLabel} - ${members.length}`,
                ...members.map((member) => {
                    return layouts
                        .map((layout) => (layout.isEmoji ? member[layout.key] : `\`${member[layout.key]}\``))
                        .join(' ')
                        .replace(/` `/g, ' ');
                })
            ])
        ].join('\n');
        const [description, ...rest] = Util.splitMessage(rosterContent, { maxLength: 4096 });
        const total = `Total ${roster.members.length}/${roster.maxMembers || ROSTER_MAX_LIMIT}`;
        const minTownHall = roster.minTownHall ? ` | Min. TH${roster.minTownHall}` : '';
        const maxTownHall = roster.maxTownHall ? ` | Max. TH${roster.maxTownHall}` : '';
        const rosterRole = roster.roleId ? `Role <@&${roster.roleId}>\n` : '';
        const footer = `${rosterRole}${total}${minTownHall}${maxTownHall}`;
        embed.setDescription(description);
        if (roster.rosterImage)
            embed.setImage(roster.rosterImage);
        const embeds = [embed];
        if ((rest.length && roster.members.length >= ROSTER_MAX_LIMIT) ||
            rosterContent.length >= 5800) {
            rest.forEach((value) => {
                const embedBuilder = new EmbedBuilder(embed.toJSON());
                embedBuilder.setDescription(value);
                if (roster.rosterImage) {
                    embedBuilder.setImage(roster.rosterImage);
                }
                embeds.push(embedBuilder);
            });
        }
        else if (rest.length) {
            for (const value of Util.splitMessage(rest.join('\n'), { maxLength: 1024 })) {
                embed.addFields({ name: '\u200e', value });
            }
        }
        if (roster.startTime && roster.startTime > new Date()) {
            embed.addFields({
                name: '\u200e',
                value: [`${footer}`, `Signup opens on ${time(roster.startTime)}`].join('\n')
            });
        }
        else if (roster.endTime) {
            embed.addFields({
                name: '\u200e',
                value: [
                    `${footer}`,
                    `Signup ${this.isClosed(roster) ? '**closed**' : 'closes'} on ${time(roster.endTime)}`
                ].join('\n')
            });
        }
        else if (roster.closed) {
            embed.addFields({
                name: '\u200e',
                value: [`${footer}`, 'Signup is **closed**'].join('\n')
            });
        }
        else {
            embed.addFields({ name: '\u200e', value: `${footer}` });
        }
        return multi ? embeds : embed;
    }
    getRosterInfoEmbed(roster) {
        const embed = new EmbedBuilder();
        embed.setTitle(`${roster.name} ${this.isClosed(roster) ? '[CLOSED]' : ''}`);
        if (roster.clan) {
            embed.setURL(this.client.coc.getClanURL(roster.clan.tag)).setAuthor({
                name: `${roster.clan.name} (${roster.clan.tag})`,
                iconURL: roster.clan.badgeUrl,
                url: this.client.coc.getClanURL(roster.clan.tag)
            });
        }
        embed
            .addFields({
            name: 'Roster Size',
            inline: true,
            value: `${roster.maxMembers ?? ROSTER_MAX_LIMIT} max, ${roster.members.length} signed-up`
        })
            .addFields({
            name: 'Roster Category',
            inline: true,
            value: `${roster.category}`
        })
            .addFields({
            name: 'Town Hall',
            inline: true,
            value: `${roster.minTownHall ?? 2} min, ${roster.maxTownHall ?? MAX_TOWN_HALL_LEVEL} max`
        })
            .addFields({
            name: 'Hero Levels',
            inline: true,
            value: `${roster.minHeroLevels ?? 0} min (combined)`
        })
            .addFields({
            name: 'Allow Multi-Signup',
            inline: true,
            value: roster.allowMultiSignup ? 'Yes' : 'No'
        })
            .addFields({
            name: 'Roster Role',
            inline: true,
            value: roster.roleId ? `<@&${roster.roleId}>` : 'None'
        })
            .addFields({
            name: 'Start Time',
            inline: true,
            value: roster.startTime
                ? `${time(roster.startTime)} ${roster.startTime > new Date() ? `(${time(roster.startTime, 'R')})` : '[STARTED]'}`
                : 'N/A'
        })
            .addFields({
            name: 'End Time',
            inline: true,
            value: roster.endTime
                ? `${time(roster.endTime)} ${this.isClosed(roster) ? '[CLOSED]' : `(${time(roster.endTime, 'R')})`}`
                : 'N/A'
        })
            .addFields({
            name: 'Use Clan Alias',
            inline: true,
            value: roster.useClanAlias ? 'Yes' : 'No'
        })
            .addFields({
            name: 'Allow Unlinked Players',
            inline: true,
            value: roster.allowUnlinked ? 'Yes' : 'No'
        })
            .addFields({
            name: 'Allow Users to Select Group',
            inline: true,
            value: roster.allowCategorySelection ? 'Yes' : 'No'
        })
            .addFields({
            name: 'Sorting Order',
            inline: true,
            value: `\`${roster.sortBy ?? 'SIGNUP_TIME'}\``
        })
            .addFields({
            name: 'Roster Layout',
            inline: true,
            value: `\`${roster.layout ?? DEFAULT_ROSTER_LAYOUT}\``
        });
        if (roster.logChannelId) {
            embed.addFields({
                name: 'Log Channel',
                inline: true,
                value: `<#${roster.logChannelId}>`
            });
        }
        if (roster.colorCode)
            embed.setColor(roster.colorCode);
        return embed;
    }
    getRosterComponents({ roster, signupDisabled }) {
        const isClosed = this.isClosed(roster);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(JSON.stringify({
            cmd: 'roster-post',
            signup_disabled: signupDisabled,
            roster: roster._id.toHexString()
        }))
            .setEmoji(EMOJIS.REFRESH)
            .setStyle(ButtonStyle.Secondary));
        if (!signupDisabled) {
            row.addComponents(new ButtonBuilder()
                .setCustomId(JSON.stringify({ cmd: 'roster-signup', roster: roster._id.toHexString(), signup: true }))
                .setLabel('Signup')
                .setStyle(ButtonStyle.Success)
                .setDisabled(isClosed), new ButtonBuilder()
                .setCustomId(JSON.stringify({
                cmd: 'roster-signup',
                roster: roster._id.toHexString(),
                signup: false
            }))
                .setLabel('Opt-out')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(isClosed));
        }
        row.addComponents(new ButtonBuilder()
            .setCustomId(JSON.stringify({
            cmd: 'roster-settings',
            signup_disabled: signupDisabled,
            roster: roster._id.toHexString()
        }))
            .setEmoji(EMOJIS.GEAR)
            .setStyle(ButtonStyle.Secondary));
        return row;
    }
    async updateBulkRoles({ rolesMap, roster, addRoles }) {
        const rosterId = roster._id.toHexString();
        if (this.queued.has(rosterId))
            return;
        this.queued.add(rosterId);
        try {
            const guild = this.client.guilds.cache.get(roster.guildId);
            if (!guild)
                return null;
            const aggregated = await this.rosters
                .aggregate([
                { $match: { guildId: guild.id, closed: false } },
                { $unwind: { path: '$members', preserveNullAndEmptyArrays: true } },
                { $project: { _id: 1, roleId: 1, members: { userId: 1, categoryId: 1 } } }
            ])
                .toArray();
            const categories = await this.getCategories(guild.id);
            const categoryRolesMap = Object.fromEntries(categories.map((category) => [category._id.toHexString(), category.roleId]));
            const rosterRolesMap = {};
            const rosterSystemRoles = new Set();
            for (const roster of aggregated) {
                if (roster.roleId)
                    rosterSystemRoles.add(roster.roleId);
                if (!roster.members?.userId)
                    continue;
                rosterRolesMap[roster.members.userId] ??= [];
                if (roster.roleId) {
                    rosterRolesMap[roster.members.userId].push(roster.roleId);
                }
                const categoryId = roster.members.categoryId?.toHexString() || null;
                if (categoryId && categoryRolesMap[categoryId]) {
                    rosterRolesMap[roster.members.userId].push(categoryRolesMap[categoryId]);
                }
            }
            for (const category of categories) {
                if (category.roleId)
                    rosterSystemRoles.add(category.roleId);
            }
            const members = await this.client.util.getGuildMembers(guild);
            if (!members.size)
                return null;
            for (const member of members.values()) {
                const _roles = (rolesMap[member.id] ?? []).filter((id) => this.hasPermission(guild, id));
                const included = [];
                const excluded = [];
                const existingRoleIds = member.roles.cache.map((role) => role.id);
                if (addRoles) {
                    const roles = _roles.filter((id) => !member.roles.cache.has(id));
                    if (roles.length)
                        included.push(...roles);
                }
                else {
                    const roles = _roles.filter((id) => member.roles.cache.has(id));
                    if (roles.length)
                        excluded.push(...roles);
                }
                if (!(member.id in rolesMap) && roster.roleId) {
                    const roles = [roster.roleId].filter((id) => this.hasPermission(guild, id) && member.roles.cache.has(id));
                    if (roles.length)
                        excluded.push(...roles);
                }
                const allowedRoles = rosterRolesMap[member.id] || [];
                const excludedRoles = member.roles.cache.filter((role) => this.hasPermission(guild, role.id) &&
                    rosterSystemRoles.has(role.id) &&
                    !allowedRoles.includes(role.id));
                if (excludedRoles)
                    excluded.push(...excludedRoles.map((role) => role.id));
                if (!excluded.length && !included.length)
                    continue;
                const roleIdsToSet = [...existingRoleIds, ...included].filter((id) => !excluded.includes(id));
                await member.edit({ roles: unique(roleIdsToSet, (id) => id) });
                await Util.delay(2000);
            }
        }
        finally {
            this.queued.delete(rosterId);
        }
    }
    async addRole(guildId, roleIds, userId) {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild)
            return null;
        roleIds = roleIds.filter((id) => this.hasPermission(guild, id));
        if (!roleIds.length)
            return null;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member)
            return null;
        roleIds = roleIds.filter((id) => !member.roles.cache.has(id));
        if (!roleIds.length)
            return null;
        return member.roles.add(roleIds);
    }
    async removeRole(guildId, roleIds, userId) {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild)
            return null;
        roleIds = roleIds.filter((id) => this.hasPermission(guild, id));
        if (!roleIds.length)
            return null;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member)
            return null;
        roleIds = roleIds.filter((id) => member.roles.cache.has(id));
        if (!roleIds.length)
            return null;
        return member.roles.remove(roleIds);
    }
    hasPermission(guild, roleId) {
        const role = guild.roles.cache.get(roleId);
        return (role &&
            !role.managed &&
            guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles) &&
            guild.members.me.roles.highest.position > role.position);
    }
    isClosed(roster) {
        return roster.closed || (roster.endTime ? roster.endTime < new Date() : false);
    }
    snipe(str, len = 12) {
        return `\u200e${Util.escapeBackTick(`${str}`).slice(0, len).padEnd(len, ' ')}`;
    }
    sum(arr) {
        return arr.reduce((prev, curr) => prev + curr, 0);
    }
    async getCategories(guildId) {
        return this.categories.find({ guildId }, { sort: { order: 1 } }).toArray();
    }
    async getCategory(categoryId) {
        return this.categories.findOne({ _id: categoryId });
    }
    async searchCategory(guildId, name) {
        return this.categories.findOne({ guildId, name: this.formatCategoryName(name) });
    }
    async createCategory(category) {
        category.name = this.formatCategoryName(category.name);
        const { insertedId } = await this.categories.insertOne(category);
        return { ...category, _id: insertedId };
    }
    formatCategoryName(name) {
        return name.toLowerCase().trim().replace(/\s+/g, '_');
    }
    async deleteCategory(categoryId) {
        return this.categories.deleteOne({ _id: categoryId });
    }
    async createDefaultGroups(guildId) {
        const categories = await this.getCategories(guildId);
        if (categories.length)
            return null;
        const defaultCategories = [
            {
                displayName: 'Confirmed',
                name: 'confirmed',
                order: 10,
                guildId,
                selectable: true,
                roleId: null,
                createdAt: new Date()
            },
            {
                displayName: 'Substitute',
                name: 'substitute',
                order: 20,
                guildId,
                selectable: true,
                roleId: null,
                createdAt: new Date()
            }
        ];
        return this.categories.insertMany(defaultCategories);
    }
    async closeRosters(guildId) {
        return this.rosters.updateMany({
            guildId,
            $and: [
                {
                    endTime: { $ne: null }
                },
                {
                    endTime: { $lt: new Date() }
                }
            ]
        }, {
            $set: { closed: true }
        });
    }
    async editCategory(categoryId, data) {
        if (data.displayName)
            data.name = this.formatCategoryName(data.displayName);
        const value = await this.categories.findOneAndUpdate({ _id: categoryId }, { $set: data }, { returnDocument: 'after' });
        return value;
    }
    async getTimezoneId(interaction, location) {
        const zone = location ? moment.tz.zone(location) : null;
        if (zone)
            return zone.name;
        const user = await this.client.db
            .collection("Users" /* Collections.USERS */)
            .findOne({ userId: interaction.user.id });
        if (!location) {
            if (!user?.timezone)
                return 'UTC';
            return user.timezone.id;
        }
        const raw = await Google.timezone(location);
        if (!raw)
            return 'UTC';
        const offset = Number(raw.timezone.rawOffset) + Number(raw.timezone.dstOffset);
        if (!user?.timezone) {
            await this.client.db.collection("Users" /* Collections.USERS */).updateOne({ userId: interaction.user.id }, {
                $set: {
                    username: interaction.user.username,
                    displayName: interaction.user.displayName,
                    discriminator: interaction.user.discriminator,
                    timezone: {
                        id: raw.timezone.timeZoneId,
                        offset: Number(offset),
                        name: raw.timezone.timeZoneName,
                        location: raw.location.formatted_address
                    }
                },
                $setOnInsert: { createdAt: new Date() }
            }, { upsert: true });
        }
        return raw.timezone.timeZoneId;
    }
    convertTime(time, timezoneId) {
        return moment.tz(time, timezoneId).toDate();
    }
    getDefaultSettings(guildId) {
        return this.client.settings.get(guildId, "rosterDefaultSettings" /* Settings.ROSTER_DEFAULT_SETTINGS */, {});
    }
    async setDefaultSettings(guildId, data) {
        const settings = {
            allowMultiSignup: data.allowMultiSignup,
            allowCategorySelection: data.allowCategorySelection,
            maxMembers: data.maxMembers,
            minHeroLevels: data.minHeroLevels,
            minTownHall: data.minTownHall,
            maxTownHall: data.maxTownHall,
            sortBy: data.sortBy,
            allowUnlinked: data.allowUnlinked,
            layout: data.layout,
            colorCode: data.colorCode,
            useClanAlias: data.useClanAlias
        };
        return this.client.settings.set(guildId, "rosterDefaultSettings" /* Settings.ROSTER_DEFAULT_SETTINGS */, settings);
    }
    async importMembers(roster, memberList) {
        const members = await this.getClanMemberLinks(memberList, roster.allowUnlinked);
        for (const member of members) {
            const attempt = await this.client.rosterManager.attemptSignup({
                roster,
                player: member,
                user: member.user,
                isDryRun: false,
                isOwner: false
            });
            if (attempt.success) {
                await this.client.rosterManager.signupUser({
                    roster,
                    player: member,
                    user: member.user,
                    categoryId: null
                });
            }
        }
    }
    async getClanMembers(memberList, allowUnlinked = false) {
        const links = await this.client.db
            .collection("PlayerLinks" /* Collections.PLAYER_LINKS */)
            .find({ tag: { $in: memberList.map((mem) => mem.tag) } })
            .toArray();
        const fetched = await parallel(25, memberList, async (member) => {
            const { body, res } = await this.client.coc.getPlayer(member.tag);
            if (!res.ok || !body)
                return null;
            return body;
        });
        const players = fetched.filter((_) => _);
        const members = [];
        players.forEach((player) => {
            const link = links.find((link) => link.tag === player.tag);
            if (!link && !allowUnlinked)
                return;
            const heroes = player.heroes.filter((hero) => hero.village === 'home');
            members.push({
                tag: player.tag,
                name: player.name,
                userId: link?.userId ?? null,
                username: link?.username ?? null,
                displayName: link?.displayName ?? null,
                townHallLevel: player.townHallLevel,
                warPreference: player.warPreference ?? null,
                role: player.role ?? null,
                trophies: player.trophies,
                leagueId: player.leagueTier?.id ?? UNRANKED_TIER_ID,
                heroes: heroes.reduce((prev, curr) => ({ ...prev, [curr.name]: curr.level }), {}),
                clan: player.clan ? { tag: player.clan.tag, name: player.clan.name } : null,
                createdAt: new Date()
            });
        });
        return members;
    }
    async getClanMemberLinks(memberList, allowUnlinked = false) {
        const links = await this.client.db
            .collection("PlayerLinks" /* Collections.PLAYER_LINKS */)
            .find({ tag: { $in: memberList.map((mem) => mem.tag) } })
            .toArray();
        const players = await this.client.coc._getPlayers(memberList);
        const members = [];
        players.forEach((player) => {
            const link = links.find((link) => link.tag === player.tag);
            if (!link && !allowUnlinked)
                return;
            members.push({
                user: link
                    ? { id: link.userId, displayName: link.displayName, username: link.username }
                    : null,
                ...player
            });
        });
        return members;
    }
    async exportSheet() {
        return [];
    }
    async init() {
        if (this.timeoutId)
            clearTimeout(this.timeoutId);
        try {
            await this.rosters.updateMany({
                $and: [
                    {
                        endTime: { $ne: null }
                    },
                    {
                        endTime: { $lt: new Date() }
                    }
                ]
            }, {
                $set: { closed: true }
            });
        }
        finally {
            this.timeoutId = setTimeout(this.init.bind(this), 10 * 60 * 1000);
        }
    }
    async getCWLStats(playerTags, seasonId) {
        const members = {};
        if (!playerTags.length)
            return members;
        const wars = this.client.db.collection("ClanWars" /* Collections.CLAN_WARS */).find({
            $or: [
                {
                    'clan.members.tag': { $in: playerTags }
                },
                {
                    'opponent.members.tag': { $in: playerTags }
                }
            ],
            season: seasonId,
            warType: 3 /* WarType.CWL */
        });
        for await (const data of wars) {
            const clanMemberTags = data.opponent.members.map((m) => m.tag);
            const opponentMemberTags = data.clan.members.map((m) => m.tag);
            for (const playerTag of playerTags) {
                if (![...clanMemberTags, ...opponentMemberTags].includes(playerTag))
                    continue;
                const clan = data.clan.members.find((m) => m.tag === playerTag) ? data.clan : data.opponent;
                const opponent = data.clan.tag === clan.tag ? data.opponent : data.clan;
                clan.members.sort((a, b) => a.mapPosition - b.mapPosition);
                opponent.members.sort((a, b) => a.mapPosition - b.mapPosition);
                const __attacks = clan.members.flatMap((m) => m.attacks ?? []);
                for (const m of clan.members) {
                    if (m.tag !== playerTag)
                        continue;
                    members[m.tag] ??= {
                        name: m.name,
                        tag: m.tag,
                        participated: 0,
                        attacks: 0,
                        stars: 0,
                        trueStars: 0,
                        destruction: 0,
                        threeStars: 0,
                        twoStars: 0,
                        oneStar: 0,
                        zeroStars: 0,
                        missedAttacks: 0,
                        defenseStars: 0,
                        defenseDestruction: 0,
                        defenseCount: 0
                    };
                    const member = members[m.tag];
                    member.participated += 1;
                    for (const atk of m.attacks ?? []) {
                        const previousBestAttack = this.client.coc.getPreviousBestAttack(__attacks, atk);
                        member.attacks += 1;
                        member.stars += atk.stars;
                        member.trueStars += previousBestAttack
                            ? Math.max(0, atk.stars - previousBestAttack.stars)
                            : atk.stars;
                        member.destruction += atk.destructionPercentage;
                        member.threeStars += atk.stars === 3 ? 1 : 0;
                        member.twoStars += atk.stars === 2 ? 1 : 0;
                        member.oneStar += atk.stars === 1 ? 1 : 0;
                        member.zeroStars += atk.stars === 0 ? 1 : 0;
                    }
                    member.missedAttacks += m.attacks?.length ? 0 : 1;
                    if (m.bestOpponentAttack) {
                        member.defenseStars += m.bestOpponentAttack.stars;
                        member.defenseDestruction += m.bestOpponentAttack.destructionPercentage;
                        member.defenseCount += 1;
                    }
                }
            }
        }
        return members;
    }
    async rosterChangeLog(options) {
        const { roster, user, action, members, categoryId } = options;
        const categories = await this.getCategories(roster.guildId);
        const categoryMap = categories.reduce((prev, curr) => ({ ...prev, [curr._id.toHexString()]: curr }), {});
        let label = action === RosterLog.SIGNUP ? 'Signed-Up' : 'Opted-Out';
        if (action === RosterLog.ADD_PLAYER)
            label = 'Players Added';
        if (action === RosterLog.REMOVE_PLAYER)
            label = 'Players Removed';
        if (action === RosterLog.CHANGE_GROUP)
            label = 'Group Changed';
        if (action === RosterLog.CHANGE_ROSTER)
            label = 'Roster Changed';
        const colorCodes = {
            [RosterLog.SIGNUP]: COLOR_CODES.GREEN,
            [RosterLog.OPT_OUT]: COLOR_CODES.RED,
            [RosterLog.ADD_PLAYER]: COLOR_CODES.DARK_GREEN,
            [RosterLog.REMOVE_PLAYER]: COLOR_CODES.DARK_RED,
            [RosterLog.CHANGE_GROUP]: COLOR_CODES.CYAN,
            [RosterLog.CHANGE_ROSTER]: COLOR_CODES.YELLOW
        };
        const embed = new EmbedBuilder().setColor(colorCodes[action]).setTitle(`${roster.name}`);
        if (roster.clan) {
            embed.setURL(`http://cprk.us/c/${roster.clan.tag.slice(1)}`).setFooter({
                text: `${roster.clan.name} (${roster.clan.tag})`,
                iconURL: roster.clan.badgeUrl
            });
        }
        embed.setDescription([
            `### ${label}`,
            //
            members
                .map((mem) => `\u200e${mem.name} (${mem.tag}) ${mem.userId ? `<@${mem.userId}>` : ''}`)
                .join('\n')
        ].join('\n'));
        if (action === RosterLog.CHANGE_GROUP) {
            embed.setDescription([
                `### ${label}`,
                //
                members
                    .map((mem) => `\u200e${mem.name} (${mem.tag}) ${mem.categoryId ? `- ${categoryMap[mem.categoryId.toHexString()]?.displayName || 'Ungrouped'}` : ''}`)
                    .join('\n')
            ].join('\n'));
        }
        if (action !== RosterLog.OPT_OUT && action !== RosterLog.REMOVE_PLAYER) {
            embed.addFields({
                name: 'User Group',
                value: categoryId ? categoryMap[categoryId]?.displayName : 'None'
            });
        }
        embed.addFields({ name: 'User', value: `<@${user.id}>` });
        const rosterLog = roster.logChannelId && roster.webhook
            ? {
                fromRoster: true,
                channelId: roster.logChannelId,
                webhook: { token: roster.webhook.token, id: roster.webhook.id }
            }
            : null;
        const defaultConfig = this.client.settings.get(roster.guildId, "rosterChangeLog" /* Settings.ROSTER_CHANGELOG */, rosterLog);
        const config = rosterLog ?? defaultConfig;
        if (!config)
            return null;
        const webhook = new WebhookClient(config.webhook);
        const channel = this.client.util.getTextBasedChannel(config.channelId);
        try {
            return await webhook.send(channel?.isThread() ? { embeds: [embed], threadId: config.channelId } : { embeds: [embed] });
        }
        catch (error) {
            if ([DiscordErrorCodes.UNKNOWN_CHANNEL, DiscordErrorCodes.UNKNOWN_WEBHOOK].includes(error.code)) {
                if (config.fromRoster) {
                    await this.edit(roster._id, { logChannelId: null, webhook: null });
                }
                else {
                    await this.client.settings.delete(roster.guildId, "rosterChangeLog" /* Settings.ROSTER_CHANGELOG */);
                }
                if (error.code === DiscordErrorCodes.UNKNOWN_WEBHOOK && !options.isRetry) {
                    await this.retryWebhook(options, config);
                    return null;
                }
            }
            console.error(error);
            this.client.logger.error(`${error.toString()}`, { label: 'RosterLog' });
        }
    }
    async retryWebhook(options, config) {
        const channel = this.client.util.getTextBasedChannel(config.channelId);
        if (!channel)
            return null;
        const { roster } = options;
        const webhook = await this.client.storage.getWebhook(channel.isThread() ? channel.parent : channel);
        if (!webhook)
            return null;
        if (config.fromRoster) {
            await this.edit(roster._id, {
                logChannelId: channel.id,
                webhook: {
                    token: webhook.token,
                    id: webhook.id
                }
            });
        }
        else {
            await this.client.settings.set(roster.guildId, "rosterChangeLog" /* Settings.ROSTER_CHANGELOG */, {
                channelId: channel.id,
                webhook: { token: webhook.token, id: webhook.id }
            });
        }
        const updatedRoster = await this.get(roster._id);
        if (!updatedRoster)
            return null;
        await this.rosterChangeLog({ ...options, isRetry: true, roster: updatedRoster });
    }
}
export var RosterLog;
(function (RosterLog) {
    RosterLog["SIGNUP"] = "SIGNUP";
    RosterLog["OPT_OUT"] = "OPT_OUT";
    RosterLog["ADD_PLAYER"] = "ADD_PLAYER";
    RosterLog["REMOVE_PLAYER"] = "REMOVE_PLAYER";
    RosterLog["CHANGE_GROUP"] = "CHANGE_GROUP";
    RosterLog["CHANGE_ROSTER"] = "CHANGE_ROSTER";
})(RosterLog || (RosterLog = {}));
export function rosterLabel(roster, hyperlink = false) {
    if (roster.clan && hyperlink) {
        return `${roster.name} ([${roster.clan.name}](http://cprk.us/c/${roster.clan.tag.replace('#', '')}))`;
    }
    if (roster.clan) {
        return `${roster.name} (${roster.clan.name})`;
    }
    return `${roster.name}`;
}
export function rosterClan(roster) {
    if (roster.clan) {
        return `${roster.clan.name} (${roster.clan.tag})`;
    }
    return `All Clans (#00000)`;
}
//# sourceMappingURL=roster-manager.js.map