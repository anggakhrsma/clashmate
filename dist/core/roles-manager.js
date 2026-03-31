import { BUILDER_BASE_LEAGUE_MAPS, LEGEND_LEAGUE_ID, PLAYER_LEAGUE_MAPS, SUPER_SCRIPTS, UNRANKED_TIER_ID } from '../util/constants.js';
import { Collection, PermissionFlagsBits, Role, User } from 'discord.js';
import { parallel, sift, unique } from 'radash';
import { makeAbbr, sumHeroes } from '../util/helper.js';
const roles = {
    member: 1,
    admin: 2,
    coLeader: 3,
    leader: 4
};
const defaultRoleLabels = {
    leader: 'Lead',
    coLeader: 'Co-Lead',
    admin: 'Eld',
    member: 'Mem'
};
const NickActions = {
    DECLINED: 'declined',
    UNSET: 'unset',
    NO_ACTION: 'no-action',
    SET_NAME: 'set-name'
};
export var NicknamingAccountPreference;
(function (NicknamingAccountPreference) {
    NicknamingAccountPreference["DEFAULT_ACCOUNT"] = "default-account";
    NicknamingAccountPreference["BEST_ACCOUNT"] = "best-account";
    NicknamingAccountPreference["DEFAULT_OR_BEST_ACCOUNT"] = "default-or-best-account";
})(NicknamingAccountPreference || (NicknamingAccountPreference = {}));
const OpTypes = [
    'PROMOTED',
    'DEMOTED',
    'JOINED',
    'LEFT',
    'LEAGUE_CHANGE',
    'TOWN_HALL_UPGRADE',
    'NAME_CHANGE',
    'WAR',
    'WAR_REMOVED',
    'BUILDER_LEAGUE_CHANGE'
];
const EMPTY_GUILD_MEMBER_COLLECTION = new Collection();
export class RolesManager {
    constructor(client) {
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
        Object.defineProperty(this, "queues", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "changeLogs", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {}
        });
        Object.defineProperty(this, "interval", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 1 * 60 * 60 * 1000
        });
        setTimeout(this._roleRefresh.bind(this), 5 * 60 * 1000);
    }
    async exec(clanTag, pollingInput) {
        if (pollingInput.state && pollingInput.state === 'inWar')
            return;
        const members = (pollingInput?.members ?? []).filter((mem) => OpTypes.includes(mem.op));
        const memberTags = members.map((mem) => mem.tag);
        if (!memberTags.length)
            return;
        const opTypes = Array.from(new Set(members.map((mem) => mem.op)));
        const guildIds = await this.client.db
            .collection("ClanStores" /* Collections.CLAN_STORES */)
            .distinct('guild', { tag: clanTag });
        for (const guildId of guildIds) {
            if (!this.client.settings.get(guildId, "useAutoRole" /* Settings.USE_AUTO_ROLE */, true))
                continue;
            if (this.client.settings.hasCustomBot(guildId) && !false)
                continue;
            if (!this.client.guilds.cache.has(guildId))
                continue;
            if (this.queues.has(guildId)) {
                this.queues.set(guildId, [...(this.queues.get(guildId) ?? []), ...memberTags]);
                continue; // a queue is already being processed
            }
            this.queues.set(guildId, []);
            await this.trigger({ memberTags, guildId, opTypes: `${opTypes.join(',')},${clanTag}` });
        }
    }
    async trigger({ guildId, memberTags, opTypes }) {
        try {
            await this.updateMany(guildId, {
                isDryRun: false,
                logging: false,
                forced: false,
                memberTags,
                reason: 'automatically updated'
            });
        }
        finally {
            await this.postTriggerAction(guildId, opTypes);
        }
    }
    async postTriggerAction(guildId, opTypes) {
        const queuedMemberTags = this.queues.get(guildId);
        if (queuedMemberTags && queuedMemberTags.length) {
            // reset the queue
            this.queues.set(guildId, []);
            await this.delay(1000);
            this.client.logger.log(`Completing remaining ${queuedMemberTags.length} queues (${opTypes})`, {
                label: RolesManager.name
            });
            await this.trigger({ guildId, memberTags: queuedMemberTags, opTypes: `RE:[${opTypes}]` });
        }
        else {
            this.queues.delete(guildId);
        }
    }
    async getGuildRolesMap(guildId) {
        const clans = await this.client.db
            .collection("ClanStores" /* Collections.CLAN_STORES */)
            .find({ guild: guildId })
            .toArray();
        const allowNonFamilyLeagueRoles = this.client.settings.get(guildId, "allowExternalAccountsLeague" /* Settings.ALLOW_EXTERNAL_ACCOUNTS_LEAGUE */, false);
        const allowNonFamilyTownHallRoles = this.client.settings.get(guildId, "allowExternalAccounts" /* Settings.ALLOW_EXTERNAL_ACCOUNTS */, false);
        const townHallRoles = this.client.settings.get(guildId, "townHallRoles" /* Settings.TOWN_HALL_ROLES */, {});
        const builderHallRoles = this.client.settings.get(guildId, "builderHallRoles" /* Settings.BUILDER_HALL_ROLES */, {});
        const leagueRoles = this.client.settings.get(guildId, "leagueRoles" /* Settings.LEAGUE_ROLES */, {});
        const builderLeagueRoles = this.client.settings.get(guildId, "builderLeagueRoles" /* Settings.BUILDER_LEAGUE_ROLES */, {});
        const familyRoleId = this.client.settings.get(guildId, "familyRole" /* Settings.FAMILY_ROLE */, null);
        const exclusiveFamilyRoleId = this.client.settings.get(guildId, "exclusiveFamilyRole" /* Settings.EXCLUSIVE_FAMILY_ROLE */, null);
        const familyLeadersRoles = this.client.settings.get(guildId, "familyLeadersRole" /* Settings.FAMILY_LEADERS_ROLE */, []);
        const verifiedRoleId = this.client.settings.get(guildId, "accountVerifiedRole" /* Settings.ACCOUNT_VERIFIED_ROLE */, null);
        const accountLinkedRoleId = this.client.settings.get(guildId, "accountLinkedRole" /* Settings.ACCOUNT_LINKED_ROLE */, null);
        const guestRoleId = this.client.settings.get(guildId, "guestRole" /* Settings.GUEST_ROLE */, null);
        const trophyRoles = this.client.settings.get(guildId, "trophyRoles" /* Settings.TROPHY_ROLES */, {});
        const clanRoles = clans.reduce((prev, curr) => {
            const roles = curr.roles ?? {};
            prev[curr.tag] ??= {
                roles,
                warRoleId: curr.warRole,
                alias: curr.alias ?? null,
                order: curr.order || 0
            };
            return prev;
        }, {});
        if (typeof this.client.settings.get(guildId, "verifiedOnlyClanRoles" /* Settings.VERIFIED_ONLY_CLAN_ROLES */) !== 'boolean') {
            await this.client.settings.set(guildId, "verifiedOnlyClanRoles" /* Settings.VERIFIED_ONLY_CLAN_ROLES */, clans.some((clan) => clan.secureRole));
        }
        const verifiedOnlyClanRoles = this.client.settings.get(guildId, "verifiedOnlyClanRoles" /* Settings.VERIFIED_ONLY_CLAN_ROLES */, false);
        const eosPushClans = this.client.settings.get(guildId, "eosPushClans" /* Settings.EOS_PUSH_CLANS */, []);
        const eosPushClanRoles = this.client.settings.get(guildId, "eosPushClanRoles" /* Settings.EOS_PUSH_CLAN_ROLES */, []);
        const clanTags = clans.map((clan) => clan.tag);
        const warClanTags = clans.filter((clan) => clan.warRole).map((clan) => clan.tag);
        return {
            guildId,
            clanTags,
            warClanTags,
            allowNonFamilyLeagueRoles,
            allowNonFamilyTownHallRoles,
            familyRoleId,
            exclusiveFamilyRoleId,
            familyLeadersRoles,
            verifiedRoleId,
            accountLinkedRoleId,
            guestRoleId,
            leagueRoles,
            builderLeagueRoles,
            townHallRoles,
            builderHallRoles,
            clanRoles,
            eosPushClans,
            trophyRoles: Object.values(trophyRoles),
            eosPushClanRoles,
            verifiedOnlyClanRoles
        };
    }
    getTargetedRoles(rolesMap) {
        const leagueRoles = Object.values(rolesMap.leagueRoles).filter((id) => id);
        const builderLeagueRoles = Object.values(rolesMap.builderLeagueRoles).filter((id) => id);
        const townHallRoles = Object.values(rolesMap.townHallRoles).filter((id) => id);
        const builderHallRoles = Object.values(rolesMap.builderHallRoles).filter((id) => id);
        const clanRoles = Object.values(rolesMap.clanRoles ?? {})
            .map((_rMap) => Object.values(_rMap.roles))
            .flat()
            .filter((id) => id);
        const warRoles = Object.values(rolesMap.clanRoles ?? {})
            .map((_rMap) => _rMap.warRoleId)
            .flat()
            .filter((id) => id);
        const targetedRoles = [
            rolesMap.familyRoleId,
            rolesMap.exclusiveFamilyRoleId,
            rolesMap.guestRoleId,
            rolesMap.verifiedRoleId,
            rolesMap.accountLinkedRoleId,
            ...rolesMap.familyLeadersRoles,
            ...builderHallRoles,
            ...builderLeagueRoles,
            ...warRoles,
            ...leagueRoles,
            ...townHallRoles,
            ...clanRoles,
            ...rolesMap.eosPushClanRoles,
            ...rolesMap.trophyRoles.map((range) => range.roleId)
        ].filter((id) => id);
        return {
            targetedRoles: [...new Set(targetedRoles)],
            warRoles: [...new Set(warRoles)]
        };
    }
    getPlayerRoles(players, rolesMap) {
        const { targetedRoles } = this.getTargetedRoles(rolesMap);
        let rolesToInclude = [];
        const playerClanTags = players
            .filter((player) => player.clanTag)
            .map((player) => player.clanTag);
        const inFamily = rolesMap.clanTags.some((clanTag) => playerClanTags.includes(clanTag));
        const isFamilyLeader = players.some((player) => player.clanTag &&
            player.clanRole &&
            ['leader', 'coLeader'].includes(player.clanRole) &&
            rolesMap.clanTags.includes(player.clanTag));
        const isExclusiveFamily = players.length > 0 &&
            players.every((player) => player.clanTag && player.clanRole && rolesMap.clanTags.includes(player.clanTag));
        for (const player of players) {
            for (const clanTag in rolesMap.clanRoles) {
                const targetClan = rolesMap.clanRoles[clanTag];
                if (player.warClanTags.includes(clanTag) && targetClan.warRoleId) {
                    rolesToInclude.push(targetClan.warRoleId);
                }
                if (rolesMap.verifiedOnlyClanRoles && !player.isVerified)
                    continue;
                const targetClanRolesMap = targetClan.roles ?? {};
                const highestRole = this.getHighestRole(players, clanTag, targetClanRolesMap);
                if (highestRole) {
                    rolesToInclude.push(targetClanRolesMap[highestRole], targetClanRolesMap['everyone']);
                }
            }
            // EOS Push Role
            if (player.clanTag &&
                (player.leagueId === LEGEND_LEAGUE_ID || player.trophies >= 5000) &&
                rolesMap.eosPushClans.includes(player.clanTag)) {
                rolesToInclude.push(...rolesMap.eosPushClanRoles);
            }
            // Town Hall Roles
            if (rolesMap.allowNonFamilyTownHallRoles ||
                (inFamily && !rolesMap.allowNonFamilyTownHallRoles)) {
                rolesToInclude.push(rolesMap.townHallRoles[player.townHallLevel]);
            }
            // Builder Hall Roles
            if (rolesMap.allowNonFamilyTownHallRoles ||
                (inFamily && !rolesMap.allowNonFamilyTownHallRoles)) {
                rolesToInclude.push(rolesMap.builderHallRoles[player.builderHallLevel]);
            }
            // League Roles
            if (rolesMap.allowNonFamilyLeagueRoles || (inFamily && !rolesMap.allowNonFamilyLeagueRoles)) {
                rolesToInclude.push(rolesMap.leagueRoles[PLAYER_LEAGUE_MAPS[player.leagueId]]);
            }
            // Builder League Roles
            if (rolesMap.allowNonFamilyLeagueRoles || (inFamily && !rolesMap.allowNonFamilyLeagueRoles)) {
                rolesToInclude.push(rolesMap.builderLeagueRoles[BUILDER_BASE_LEAGUE_MAPS[player.builderLeagueId]]);
            }
            // Trophy Ranges
            if (rolesMap.trophyRoles.length && player.trophies >= 5000) {
                const trophyRange = rolesMap.trophyRoles.find((range) => player.trophies >= range.min && player.trophies <= range.max);
                if (trophyRange) {
                    rolesToInclude.push(trophyRange.roleId);
                }
            }
            if (player.isVerified)
                rolesToInclude.push(rolesMap.verifiedRoleId);
            rolesToInclude.push(rolesMap.accountLinkedRoleId);
        }
        if (inFamily)
            rolesToInclude.push(rolesMap.familyRoleId);
        else
            rolesToInclude.push(rolesMap.guestRoleId);
        if (isFamilyLeader)
            rolesToInclude.push(...rolesMap.familyLeadersRoles);
        if (isExclusiveFamily)
            rolesToInclude.push(rolesMap.exclusiveFamilyRoleId);
        rolesToInclude = rolesToInclude.filter((id) => id);
        const rolesToExclude = targetedRoles.filter((id) => !rolesToInclude.includes(id));
        return {
            targetedRoles: [...new Set(targetedRoles)],
            rolesToInclude: [...new Set(rolesToInclude)],
            rolesToExclude: [...new Set(rolesToExclude)]
        };
    }
    async getTargetedGuildMembers(guild, memberTags) {
        const guildMembers = await this.client.util.getGuildMembers(guild);
        if (!memberTags) {
            const linkedPlayers = await this.getLinkedPlayersByUserId(guildMembers.map((m) => m.id));
            const linkedUserIds = Object.keys(linkedPlayers);
            return { linkedPlayers, linkedUserIds, guildMembers };
        }
        const linkedPlayers = await this.getLinkedPlayersByPlayerTag(memberTags);
        const linkedUserIds = Object.keys(linkedPlayers);
        return {
            linkedPlayers,
            linkedUserIds,
            guildMembers: guildMembers.filter((member) => linkedUserIds.includes(member.id))
        };
    }
    async getTargetedGuildMembersForUserOrRole(guild, userOrRole) {
        let guildMembers = EMPTY_GUILD_MEMBER_COLLECTION;
        if (userOrRole instanceof Role) {
            const members = await this.client.util.getGuildMembers(guild);
            guildMembers = members.filter((member) => member.roles.cache.has(userOrRole.id));
        }
        else {
            const guildMember = await guild.members.fetch(userOrRole.id).catch(() => null);
            guildMembers = guildMember
                ? EMPTY_GUILD_MEMBER_COLLECTION.clone().set(guildMember.id, guildMember)
                : EMPTY_GUILD_MEMBER_COLLECTION;
        }
        const linkedPlayers = await this.getLinkedPlayersByUserId(guildMembers.map((m) => m.id));
        const linkedUserIds = Object.keys(linkedPlayers);
        return { linkedPlayers, linkedUserIds, guildMembers };
    }
    async updateMany(guildId, { isDryRun = false, memberTags, userOrRole, logging, reason, forced = false, nicknameOnly = false, rolesOnly = false, allowNotLinked = true }) {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild)
            return null;
        const rolesMap = await this.getGuildRolesMap(guildId);
        const { targetedRoles, warRoles } = this.getTargetedRoles(rolesMap);
        const inWarMap = warRoles.length ? await this.getWarRolesMap(rolesMap.warClanTags) : {};
        const isEosRole = userOrRole instanceof Role && rolesMap.eosPushClanRoles.includes(userOrRole.id);
        const { guildMembers, linkedPlayers, linkedUserIds } = userOrRole && !isEosRole
            ? await this.getTargetedGuildMembersForUserOrRole(guild, userOrRole)
            : await this.getTargetedGuildMembers(guild, memberTags);
        const targetedMembers = guildMembers.filter((m) => !m.user.bot &&
            (m.roles.cache.hasAny(...targetedRoles) ||
                linkedUserIds.includes(m.id) ||
                (userOrRole && userOrRole instanceof User)));
        if (!targetedMembers.size)
            return null;
        if (logging) {
            this.changeLogs[guildId] ??= {
                changes: [],
                progress: 0,
                memberCount: targetedMembers.size
            };
        }
        for (const member of targetedMembers.values()) {
            if (this.client.inMaintenance)
                continue;
            const links = linkedPlayers[member.id] ?? [];
            if (!links.length && !allowNotLinked)
                continue;
            const [players, hasFailed] = await this.getPlayers(links);
            if (hasFailed)
                continue;
            const roleUpdate = await this.preRoleUpdateAction({
                forced,
                isDryRun,
                member,
                rolesMap,
                players,
                inWarMap
            });
            const nickUpdate = this.preNicknameUpdate(players, member, rolesMap);
            if (isEosRole) {
                roleUpdate.included = roleUpdate.included.filter((id) => id === userOrRole.id);
                roleUpdate.excluded = roleUpdate.excluded.filter((id) => id === userOrRole.id);
                rolesOnly = true;
            }
            // skipping non-eos roles
            if (isEosRole && !roleUpdate.included.length && !roleUpdate.excluded.length)
                continue;
            const changeLog = {
                ...roleUpdate,
                nickname: null,
                userId: member.id,
                displayName: member.user.displayName
            };
            const editOptions = {
                reason: `${reason} ${players.length !== links.length ? `(${players.length}/${links.length} links)` : ''}`
            };
            if (!nicknameOnly && (roleUpdate.excluded.length || roleUpdate.included.length)) {
                const existingRoleIds = member.roles.cache.map((role) => role.id);
                const roleIdsToSet = [...existingRoleIds, ...roleUpdate.included].filter((id) => !roleUpdate.excluded.includes(id));
                editOptions._updated = true;
                editOptions.roles = roleIdsToSet;
            }
            if (!rolesOnly && nickUpdate.action === NickActions.SET_NAME) {
                editOptions._updated = true;
                editOptions.nick = nickUpdate.nickname;
                changeLog.nickname = `**+** \`${nickUpdate.nickname}\``;
            }
            if (!rolesOnly && nickUpdate.action === NickActions.UNSET && member.nickname) {
                editOptions.nick = null;
                editOptions._updated = true;
                changeLog.nickname = `**-** ~~\`${member.nickname}\`~~`;
            }
            if (editOptions._updated && !isDryRun) {
                const _nickname = member.nickname;
                const editedMember = await member.edit(editOptions);
                if (!rolesOnly &&
                    nickUpdate.action === NickActions.SET_NAME &&
                    _nickname &&
                    _nickname === editedMember.nickname) {
                    changeLog.nickname = null;
                }
            }
            const logEntry = this.changeLogs[guildId];
            if (logEntry && logging) {
                logEntry.changes.push(changeLog);
                logEntry.progress += 1;
            }
            if (!logEntry && logging)
                break;
            if ((roleUpdate.excluded.length || roleUpdate.included.length || nickUpdate.nickname) &&
                !isDryRun)
                await this.delay(1000);
        }
        return this.changeLogs[guildId] ?? null;
    }
    async updateOne(user, guildId, forced = false, allowNotLinked = true) {
        return this.updateMany(guildId, {
            logging: false,
            isDryRun: false,
            forced,
            allowNotLinked,
            userOrRole: user,
            reason: 'account linked or updated'
        });
    }
    async getWarRolesMap(clanTags) {
        const result = await Promise.all(clanTags.map((clanTag) => this.client.coc.getCurrentWars(clanTag)));
        const membersMap = {};
        for (const war of result.flat()) {
            if (war.state === 'notInWar')
                continue;
            for (const member of war.clan.members) {
                const inWar = ['preparation', 'inWar'].includes(war.state);
                if (!inWar)
                    continue;
                membersMap[member.tag] ??= [];
                membersMap[member.tag].push(war.clan.tag);
            }
        }
        return membersMap;
    }
    async getPlayers(playerLinks) {
        const verifiedPlayersMap = Object.fromEntries(playerLinks.map((player) => [player.tag, player.verified]));
        const fetched = await parallel(25, playerLinks, async (link) => {
            const { body, res } = await this.client.coc.getPlayer(link.tag);
            return res.status === 404 ? 'deleted' : !res.ok || !body ? 'failed' : body;
        });
        const filtered = fetched.filter((result) => result !== 'deleted' && result !== 'failed');
        const players = filtered.map((player) => ({
            ...player,
            verified: verifiedPlayersMap[player.tag]
        }));
        const hasFailed = fetched.some((result) => result === 'failed');
        return [players, hasFailed];
    }
    async getLinkedPlayersByUserId(userIds) {
        const players = await this.client.db
            .collection("PlayerLinks" /* Collections.PLAYER_LINKS */)
            .find({ userId: { $in: userIds } })
            .sort({ order: 1 })
            .toArray();
        return players.reduce((record, link) => {
            if (link.deleted)
                return record;
            record[link.userId] ??= [];
            record[link.userId].push(link);
            return record;
        }, {});
    }
    async getLinkedPlayersByPlayerTag(playerTags) {
        const players = await this.client.db
            .collection("PlayerLinks" /* Collections.PLAYER_LINKS */)
            .aggregate([
            {
                $match: { tag: { $in: playerTags } }
            },
            {
                $lookup: {
                    from: "PlayerLinks" /* Collections.PLAYER_LINKS */,
                    localField: 'userId',
                    foreignField: 'userId',
                    as: 'links'
                }
            },
            {
                $unwind: {
                    path: '$links'
                }
            },
            {
                $replaceRoot: {
                    newRoot: '$links'
                }
            },
            {
                $sort: { order: 1 }
            }
        ])
            .toArray();
        return players.reduce((record, link) => {
            if (link.deleted)
                return record;
            record[link.userId] ??= [];
            record[link.userId].push(link);
            return record;
        }, {});
    }
    async preRoleUpdateAction({ isDryRun, forced, member, rolesMap, inWarMap, players }) {
        const playerList = players.map((player) => ({
            name: player.name,
            tag: player.tag,
            townHallLevel: player.townHallLevel,
            builderHallLevel: player.builderHallLevel ?? 0,
            leagueId: player.leagueTier?.id ?? UNRANKED_TIER_ID,
            builderLeagueId: player.builderBaseLeague?.id ?? 0,
            clanRole: player.role ?? null,
            clanName: player.clan?.name ?? null,
            clanTag: player.clan?.tag ?? null,
            trophies: player.trophies,
            isVerified: player.verified,
            warClanTags: inWarMap[player.tag] ?? []
        }));
        const exclusion = this.client.settings.get(member.guild, "delayExclusionList" /* Settings.DELAY_EXCLUSION_LIST */, {});
        const playerRolesMap = this.getPlayerRoles(playerList, rolesMap);
        return this.handleRoleDeletionDelays({
            isDryRun,
            forced,
            member,
            rolesToExclude: playerRolesMap.rolesToExclude,
            rolesToInclude: playerRolesMap.rolesToInclude,
            rolesExcludedFromDelays: sift([
                rolesMap.verifiedRoleId,
                rolesMap.accountLinkedRoleId,
                ...(exclusion.guestRole ? [rolesMap.guestRoleId] : []),
                ...(exclusion.townHallRoles ? Object.values(rolesMap.townHallRoles) : []),
                ...(exclusion.builderHallRoles ? Object.values(rolesMap.builderHallRoles) : []),
                ...(exclusion.leagueRoles ? Object.values(rolesMap.leagueRoles) : []),
                ...(exclusion.builderLeagueRoles ? Object.values(rolesMap.builderLeagueRoles) : [])
            ])
        });
    }
    async handleRoleDeletionDelays({ member, rolesToExclude, rolesToInclude, isDryRun, forced, rolesExcludedFromDelays }) {
        const deletionDelay = this.client.settings.get(member.guild, "roleRemovalDelays" /* Settings.ROLE_REMOVAL_DELAYS */, 0);
        const additionDelay = this.client.settings.get(member.guild, "roleAdditionDelays" /* Settings.ROLE_ADDITION_DELAYS */, 0);
        if ((!deletionDelay && !additionDelay) || forced) {
            return this.checkRoles({ member, rolesToExclude, rolesToInclude });
        }
        const collection = this.client.db.collection("AutoRoleDelays" /* Collections.AUTO_ROLE_DELAYS */);
        const delay = await collection.findOne({ guildId: member.guild.id, userId: member.user.id });
        const freeToDelete = [...rolesExcludedFromDelays];
        const freeToAdd = [...rolesExcludedFromDelays];
        const update = {};
        if (deletionDelay) {
            const delayedFor = new Date(Date.now() + deletionDelay).getTime();
            for (const [roleId, _delayed] of Object.entries(delay?.deletionDelays ?? {})) {
                // if the time is right or the player is back
                if (Date.now() > _delayed || rolesToInclude.includes(roleId)) {
                    update.$unset = { ...update.$unset, [`deletionDelays.${roleId}`]: '' };
                }
                if (Date.now() > _delayed) {
                    freeToDelete.push(roleId);
                }
            }
            for (const roleId of rolesToExclude.filter((id) => member.roles.cache.has(id))) {
                if (delay && delay.deletionDelays?.[roleId])
                    continue;
                if (rolesExcludedFromDelays.includes(roleId))
                    continue;
                update.$min = { ...update.$min, [`deletionDelays.${roleId}`]: delayedFor };
            }
        }
        if (additionDelay) {
            const delayedFor = new Date(Date.now() + additionDelay).getTime();
            for (const [roleId, _delayed] of Object.entries(delay?.additionDelays ?? {})) {
                // if the time is right or the player is gone again
                if (Date.now() > _delayed || rolesToExclude.includes(roleId)) {
                    update.$unset = { ...update.$unset, [`additionDelays.${roleId}`]: '' };
                }
                if (Date.now() > _delayed) {
                    freeToAdd.push(roleId);
                }
            }
            for (const roleId of rolesToInclude.filter((id) => !member.roles.cache.has(id))) {
                if (delay && delay.additionDelays?.[roleId])
                    continue;
                if (rolesExcludedFromDelays.includes(roleId))
                    continue;
                update.$min = { ...update.$min, [`additionDelays.${roleId}`]: delayedFor };
            }
        }
        if (Object.getOwnPropertyNames(update).length && !isDryRun) {
            await collection.updateOne({ guildId: member.guild.id, userId: member.user.id }, { ...update, $setOnInsert: { createdAt: new Date() }, $set: { updatedAt: new Date() } }, { upsert: true });
        }
        return this.checkRoles({
            member,
            rolesToInclude: additionDelay
                ? rolesToInclude.filter((id) => freeToAdd.includes(id))
                : rolesToInclude,
            rolesToExclude: deletionDelay
                ? rolesToExclude.filter((id) => freeToDelete.includes(id))
                : rolesToExclude
        });
    }
    getPreferredPlayer(players, rolesMap) {
        const accountPreference = this.client.settings.get(rolesMap.guildId, "nicknamingAccountPreference" /* Settings.NICKNAMING_ACCOUNT_PREFERENCE */, NicknamingAccountPreference.DEFAULT_OR_BEST_ACCOUNT);
        const defaultAccount = players.at(0);
        const inFamilyPlayers = players.filter((player) => player.clan && rolesMap.clanTags.includes(player.clan.tag));
        inFamilyPlayers.sort((a, b) => b.townHallLevel ** (b.townHallWeaponLevel ?? 1) -
            a.townHallLevel ** (a.townHallWeaponLevel ?? 1));
        inFamilyPlayers.sort((a, b) => sumHeroes(b) - sumHeroes(a));
        inFamilyPlayers.sort((a, b) => b.townHallLevel - a.townHallLevel);
        const bestAccount = inFamilyPlayers.at(0);
        if (accountPreference === NicknamingAccountPreference.DEFAULT_OR_BEST_ACCOUNT) {
            if (defaultAccount?.clan && rolesMap.clanTags.includes(defaultAccount.clan.tag)) {
                return {
                    player: defaultAccount,
                    inFamilyPlayers
                };
            }
            return {
                player: bestAccount || defaultAccount,
                inFamilyPlayers
            };
        }
        if (accountPreference === NicknamingAccountPreference.BEST_ACCOUNT) {
            return {
                player: bestAccount || defaultAccount,
                inFamilyPlayers
            };
        }
        return {
            player: defaultAccount,
            inFamilyPlayers
        };
    }
    preNicknameUpdate(players, member, rolesMap) {
        if (member.id === member.guild.ownerId)
            return { action: NickActions.DECLINED };
        if (!member.guild.members.me?.permissions.has(PermissionFlagsBits.ManageNicknames))
            return { action: NickActions.DECLINED };
        if (member.guild.members.me.roles.highest.position <= member.roles.highest.position)
            return { action: NickActions.DECLINED };
        const isNickNamingEnabled = this.client.settings.get(rolesMap.guildId, "autoNickname" /* Settings.AUTO_NICKNAME */, false);
        if (!isNickNamingEnabled)
            return { action: NickActions.NO_ACTION };
        if (!players.length)
            return { action: NickActions.UNSET };
        const { player, inFamilyPlayers } = this.getPreferredPlayer(players, rolesMap);
        if (!player)
            return { action: NickActions.UNSET };
        const familyFormat = this.client.settings.get(rolesMap.guildId, "familyNicknameFormat" /* Settings.FAMILY_NICKNAME_FORMAT */);
        const nonFamilyFormat = this.client.settings.get(rolesMap.guildId, "nonFamilyNicknameFormat" /* Settings.NON_FAMILY_NICKNAME_FORMAT */);
        const inFamily = player.clan && rolesMap.clanTags.includes(player.clan.tag);
        const clanAlias = player.clan && inFamily
            ? rolesMap.clanRoles[player.clan.tag]?.alias || makeAbbr(player.clan.name)
            : null;
        const sortedClanAliases = inFamilyPlayers
            .map((player) => ({
            alias: rolesMap.clanRoles[player.clan.tag]?.alias,
            order: rolesMap.clanRoles[player.clan.tag]?.order
        }))
            .filter((_record) => _record.alias)
            .sort((a, b) => a.order - b.order)
            .map((_record) => _record.alias);
        const clanAliases = inFamily ? unique([clanAlias, ...sortedClanAliases]) : null;
        const format = inFamily ? familyFormat : nonFamilyFormat;
        if (!format)
            return { action: NickActions.UNSET };
        const nickname = this.getFormattedNickname(member.guild.id, {
            name: player.name,
            displayName: member.user.displayName,
            username: member.user.username,
            townHallLevel: player.townHallLevel,
            alias: clanAlias,
            aliases: clanAliases?.join(' | ') ?? null,
            clan: player.clan && inFamily ? player.clan.name : null,
            role: player.role && inFamily ? player.role : null
        }, format).slice(0, 32);
        if (!nickname)
            return { action: NickActions.UNSET };
        if (member.nickname === nickname)
            return { action: NickActions.NO_ACTION };
        return { action: NickActions.SET_NAME, nickname };
    }
    checkRoles({ member, rolesToExclude, rolesToInclude }) {
        if (member.user.bot)
            return { included: [], excluded: [] };
        if (!rolesToExclude.length && !rolesToInclude.length)
            return { included: [], excluded: [] };
        if (!member.guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles))
            return { included: [], excluded: [] };
        const excluded = rolesToExclude.filter((id) => this.checkRole(member.guild, id) && member.roles.cache.has(id));
        const included = rolesToInclude.filter((id) => this.checkRole(member.guild, id) && !member.roles.cache.has(id));
        return { included, excluded };
    }
    checkRole(guild, roleId) {
        const role = guild.roles.cache.get(roleId);
        return (guild.members.me &&
            role &&
            !role.managed &&
            guild.members.me.roles.highest.position > role.position &&
            role.id !== guild.id);
    }
    getHighestRole(players, clanTag, 
    /** Clan specific roles map. If a specific role is not set, skip it; */
    clanRoles) {
        const playerRoles = players
            .filter((player) => player.clanTag && player.clanTag === clanTag && player.clanRole)
            .map((player) => player.clanRole);
        return (playerRoles
            // making sure the highest roles are actually set
            .filter((role) => clanRoles[role])
            .sort((a, b) => roles[b] - roles[a])
            // if none of the in-game roles are set and player is in the clan, return everyone role;
            .at(0) ?? (playerRoles.length ? 'everyone' : null));
    }
    getFormattedNickname(guildId, player, format) {
        const roleLabels = this.client.settings.get(guildId, "roleReplacementLabels" /* Settings.ROLE_REPLACEMENT_LABELS */, {});
        return format
            .replace(/{NAME}|{PLAYER_NAME}/gi, player.name)
            .replace(/{TH}|{TOWN_HALL}/gi, player.townHallLevel.toString())
            .replace(/{TH_SMALL}|{TOWN_HALL_SMALL}/gi, this.getTownHallSuperScript(player.townHallLevel))
            .replace(/{ROLE}|{CLAN_ROLE}/gi, player.role ? roleLabels[player.role] || defaultRoleLabels[player.role] : '')
            .replace(/{ALIAS}|{CLAN_ALIAS}/gi, player.alias ?? '')
            .replace(/{ALIASES}|{CLAN_ALIASES}/gi, player.aliases ?? '')
            .replace(/{CLAN}|{CLAN_NAME}/gi, player.clan ?? '')
            .replace(/{DISCORD}|{DISCORD_NAME}/gi, player.displayName)
            .replace(/{USERNAME}|{DISCORD_USERNAME}/gi, player.username)
            .trim();
    }
    getTownHallSuperScript(num) {
        if (num >= 0 && num <= 9) {
            return SUPER_SCRIPTS[num];
        }
        return num
            .toString()
            .split('')
            .map((num) => SUPER_SCRIPTS[num])
            .join('');
    }
    getFilteredChangeLogs(queue) {
        const roleChanges = queue?.changes.filter(({ excluded, included, nickname }) => included.length || excluded.length || nickname) ?? [];
        return roleChanges;
    }
    getChangeLogs(guildId) {
        return this.changeLogs[guildId] ?? null;
    }
    clearChangeLogs(guildId) {
        delete this.changeLogs[guildId];
    }
    delay(ms) {
        return new Promise((res) => setTimeout(res, ms));
    }
    async _roleRefresh() {
        const collection = this.client.db.collection("AutoRoleDelays" /* Collections.AUTO_ROLE_DELAYS */);
        const cursor = collection.aggregate([
            {
                $match: {
                    guildId: {
                        $in: this.client.guilds.cache.map((guild) => guild.id)
                    }
                }
            },
            {
                $group: {
                    _id: '$guildId',
                    delays: {
                        $push: '$$ROOT'
                    }
                }
            }
        ]);
        try {
            for await (const { delays, _id: guildId } of cursor) {
                if (!this.client.guilds.cache.has(guildId))
                    continue;
                if (!this.client.settings.get(guildId, "useAutoRole" /* Settings.USE_AUTO_ROLE */, true))
                    continue;
                if (this.client.settings.hasCustomBot(guildId) && !false)
                    continue;
                const deletionDelay = this.client.settings.get(guildId, "roleRemovalDelays" /* Settings.ROLE_REMOVAL_DELAYS */, 0);
                const additionDelay = this.client.settings.get(guildId, "roleAdditionDelays" /* Settings.ROLE_ADDITION_DELAYS */, 0);
                if (!deletionDelay && !additionDelay)
                    continue;
                const invalidDelays = delays.filter((delay) => {
                    const roles = [
                        ...Object.values(delay.deletionDelays ?? {}),
                        ...Object.values(delay.additionDelays ?? {})
                    ];
                    return !roles.length;
                });
                if (invalidDelays.length) {
                    await collection.deleteOne({ _id: { $in: invalidDelays.map((_delay) => _delay._id) } });
                }
                const expiredDelays = delays.filter((delay) => {
                    const roles = [
                        ...Object.values(delay.deletionDelays ?? {}),
                        ...Object.values(delay.additionDelays ?? {})
                    ];
                    return roles.filter((_delayed) => Date.now() > _delayed).length;
                });
                if (!expiredDelays.length)
                    continue;
                const memberTags = await this.client.db
                    .collection("PlayerLinks" /* Collections.PLAYER_LINKS */)
                    .distinct('tag', { userId: { $in: expiredDelays.map((_delay) => _delay.userId) } });
                if (!memberTags.length)
                    continue;
                if (this.queues.has(guildId)) {
                    this.queues.set(guildId, [...(this.queues.get(guildId) ?? []), ...memberTags]);
                    continue; // a queue is already being processed
                }
                this.queues.set(guildId, []);
                await this.trigger({ memberTags, guildId, opTypes: 'ROLE_REFRESH' });
            }
        }
        finally {
            setTimeout(this._roleRefresh.bind(this), this.interval);
        }
    }
}
//# sourceMappingURL=roles-manager.js.map