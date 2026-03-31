import { ObjectId } from 'mongodb';
import { createHash } from 'node:crypto';
import { cluster, unique } from 'radash';
import { i18n } from '../util/i18n.js';
import { Season } from '../util/toolkit.js';
const defaultCategories = ['War', 'CWL', 'Farming', 'Esports', 'Events'];
export class StorageHandler {
    constructor(client) {
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
        Object.defineProperty(this, "collection", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.collection = client.db.collection("ClanStores" /* Collections.CLAN_STORES */);
    }
    async find(guildId) {
        const key = this.client.settings.get(guildId, "clansSortingKey" /* Settings.CLANS_SORTING_KEY */, 'name');
        return this.collection.find({ guild: guildId }, { sort: { [key]: 1 } }).toArray();
    }
    async getTotalClans(guildId) {
        return this.collection.countDocuments({ guild: guildId });
    }
    async getClan(params) {
        return this.collection.findOne({ guild: params.guildId, tag: params.clanTag });
    }
    async getEnabledFeatures(guildId) {
        return this.client.db
            .collection("ClanLogs" /* Collections.CLAN_LOGS */)
            .aggregate([
            { $match: { guildId } },
            {
                $lookup: {
                    from: "ClanStores" /* Collections.CLAN_STORES */,
                    localField: 'clanId',
                    foreignField: '_id',
                    as: 'root'
                }
            },
            { $unwind: { path: '$root', preserveNullAndEmptyArrays: true } },
            { $match: { root: { $exists: true } } },
            { $project: { clanTag: 1 } }
        ])
            .toArray();
    }
    async cleanUpDeletedLogs(collection) {
        const result = await this.client.db
            .collection(collection)
            .aggregate([
            {
                $lookup: {
                    from: "ClanStores" /* Collections.CLAN_STORES */,
                    localField: 'clanId',
                    foreignField: '_id',
                    as: 'root'
                }
            },
            { $unwind: { path: '$root', preserveNullAndEmptyArrays: true } },
            { $match: { root: { $exists: false } } }
        ])
            .toArray();
        await this.client.db
            .collection(collection)
            .deleteMany({ _id: { $in: result.map((doc) => doc._id) } });
    }
    async search(guildId, query) {
        if (!query.length)
            return [];
        return this.collection
            .find({
            $or: [
                {
                    tag: { $in: query.map((tag) => this.fixTag(tag)) }
                },
                {
                    alias: { $in: query.map((alias) => alias) }
                }
            ],
            guild: guildId
        }, { collation: { locale: 'en', strength: 2 }, sort: { name: 1 } })
            .toArray();
    }
    async getNickname(guildId, clanTag, defaultName) {
        const clan = await this.collection.findOne({ guild: guildId, tag: clanTag });
        return clan?.nickname ?? defaultName;
    }
    async handleSearch(interaction, { args, required }) {
        const tags = args === '*' ? [] : await this.client.resolver.resolveArgs(args);
        const isTotal = args === '*' || !args;
        if (!args && required) {
            await interaction.editReply(i18n('common.no_clan_tag', {
                lng: interaction.locale,
                command: this.client.commands.SETUP_CLAN
            }));
            return { clans: null };
        }
        const clans = args === '*' || !args
            ? await this.client.storage.find(interaction.guildId)
            : await this.client.storage.search(interaction.guildId, tags);
        if (!clans.length && tags.length) {
            await interaction.editReply(i18n('common.no_clans_found', {
                lng: interaction.locale,
                command: this.client.commands.SETUP_CLAN
            }));
            return { clans: null, isTotal };
        }
        if (!clans.length) {
            await interaction.editReply(i18n('common.no_clans_linked', {
                lng: interaction.locale,
                command: this.client.commands.SETUP_CLAN
            }));
            return { clans: null, isTotal };
        }
        return { clans, isTotal, resolvedArgs: args === '*' ? '*' : tags.join(',') };
    }
    formatCategoryName(name) {
        return name.toLowerCase().trim().replace(/\s+/g, '_');
    }
    async findOrCreateCategory({ guildId, category }) {
        if (!category)
            return null;
        const collection = this.client.db.collection("ClanCategories" /* Collections.CLAN_CATEGORIES */);
        const formattedName = this.formatCategoryName(category);
        if (ObjectId.isValid(category)) {
            const result = await collection.findOne({ guildId, _id: new ObjectId(category) });
            return result;
        }
        const lastCategory = await collection.findOne({ guildId }, { sort: { order: -1 } });
        const value = await collection.findOneAndUpdate({ guildId, name: formattedName }, {
            $set: {
                displayName: category.trim(),
                guildId,
                name: formattedName,
                order: (lastCategory?.order ?? 0) + 1
            }
        }, { upsert: true, returnDocument: 'after' });
        return value;
    }
    async getOrCreateDefaultCategories(guildId) {
        const categories = await this.client.db
            .collection("ClanCategories" /* Collections.CLAN_CATEGORIES */)
            .find({ guildId })
            .sort({ order: 1 })
            .toArray();
        if (!categories.length) {
            const payload = defaultCategories.map((name, i) => ({
                _id: new ObjectId(),
                guildId,
                order: i + 1,
                name: name.toLowerCase(),
                displayName: name
            }));
            await this.client.db
                .collection("ClanCategories" /* Collections.CLAN_CATEGORIES */)
                .insertMany(payload);
            return payload.map((result) => ({
                value: result._id.toHexString(),
                name: result.displayName,
                order: result.order
            }));
        }
        return categories.map((result) => ({
            value: result._id.toHexString(),
            name: result.displayName,
            order: result.order
        }));
    }
    fixTag(tag) {
        return `#${tag.toUpperCase().replace(/^#/g, '').replace(/O/g, '0')}`;
    }
    async register(interaction, data) {
        const [_total, _clan, _lastClan] = await Promise.all([
            this.collection.countDocuments({ guild: interaction.guildId }),
            this.collection.findOne({ tag: data.tag }),
            this.collection.find().sort({ uniqueId: -1 }).limit(1).next()
        ]);
        const clan = await this.collection.findOneAndUpdate({ tag: data.tag, guild: data.guild }, {
            $set: {
                name: data.name,
                tag: data.tag,
                guild: interaction.guildId,
                paused: false,
                active: true,
                verified: true,
                order: _clan?.order ?? _total + 1,
                ...(data.hexCode ? { color: data.hexCode } : {}),
                ...(data.categoryId ? { categoryId: data.categoryId } : {}),
                patron: false // Patreon removed
            },
            $setOnInsert: {
                uniqueId: _clan?.uniqueId ?? (_lastClan?.uniqueId ?? 1000) + 1,
                createdAt: new Date()
            }
        }, { upsert: true, returnDocument: 'after' });
        return clan._id.toHexString();
    }
    async delete(clanId) {
        await Promise.all([
            this.client.db.collection("ClanStores" /* Collections.CLAN_STORES */).deleteOne({ _id: new ObjectId(clanId) }),
            this.client.db.collection("ClanLogs" /* Collections.CLAN_LOGS */).deleteMany({ clanId: new ObjectId(clanId) })
        ]);
    }
    async deleteReminders(clanTag, guild) {
        const reminders = [
            {
                reminder: "Reminders" /* Collections.WAR_REMINDERS */,
                scheduler: "Schedulers" /* Collections.WAR_SCHEDULERS */
            },
            {
                reminder: "RaidReminders" /* Collections.RAID_REMINDERS */,
                scheduler: "RaidSchedulers" /* Collections.RAID_SCHEDULERS */
            },
            {
                reminder: "ClanGamesReminders" /* Collections.CLAN_GAMES_REMINDERS */,
                scheduler: "ClanGamesSchedulers" /* Collections.CLAN_GAMES_SCHEDULERS */
            }
        ];
        for (const { reminder, scheduler } of reminders) {
            const reminders = await this.client.db
                .collection(reminder)
                .find({ guild, clans: clanTag })
                .toArray();
            for (const rem of reminders) {
                if (rem.clans.length === 1) {
                    await this.client.db.collection(reminder).deleteOne({ _id: rem._id });
                }
                else {
                    await this.client.db
                        .collection(reminder)
                        .updateOne({ _id: rem._id }, { $pull: { clans: clanTag } });
                }
                await this.client.db
                    .collection(scheduler)
                    .deleteMany({ guild, tag: clanTag });
            }
        }
    }
    async getWebhookWorkloads(guildId) {
        const [result] = await this.client.db
            .collection("ClanStores" /* Collections.CLAN_STORES */)
            .aggregate([
            { $match: { guild: guildId } },
            {
                $facet: {
                    ["ClanLogs" /* Collections.CLAN_LOGS */]: [
                        {
                            $lookup: {
                                from: "ClanLogs" /* Collections.CLAN_LOGS */,
                                localField: '_id',
                                foreignField: 'clanId',
                                as: 'webhook'
                            }
                        },
                        {
                            $unwind: '$webhook'
                        },
                        {
                            $project: {
                                tag: 1,
                                name: 1,
                                webhook: 1
                            }
                        }
                    ]
                }
            }
        ])
            .toArray();
        return Object.values(result ?? {}).flat();
    }
    async getWebhook(channel) {
        const channelWebhooks = await channel.fetchWebhooks();
        const clans = await this.getWebhookWorkloads(channel.guild.id);
        const estimated = channelWebhooks
            .filter((webhook) => webhook.applicationId === this.client.user.id)
            .map((webhook) => webhook.id)
            .map((webhookId) => {
            const count = clans.reduce((counter, clan) => {
                if (clan.webhook.id === webhookId)
                    counter += 1;
                return counter;
            }, 0);
            return { webhookId, count };
        })
            .sort((a, b) => a.count - b.count)
            .at(0);
        const webhookLimit = this.client.settings.get(channel.guildId, "webhookLimit" /* Settings.WEBHOOK_LIMIT */, 8);
        if (estimated &&
            (estimated.count <= 6 || channelWebhooks.size >= Math.max(3, Math.min(8, webhookLimit)))) {
            return channelWebhooks.get(estimated.webhookId);
        }
        if (channelWebhooks.size >= 10)
            return null;
        const webhook = await channel.createWebhook({
            name: this.client.user.displayName,
            avatar: this.client.user.displayAvatarURL({ extension: 'png', size: 512, forceStatic: true })
        });
        this.client.logger.log(`Created webhook for ${channel.guild.name}#${channel.name}`, {
            label: 'HOOK'
        });
        return webhook;
    }
    async getWarTags(tag, season = Season.monthId) {
        return this.client.db
            .collection("CWLGroups" /* Collections.CWL_GROUPS */)
            .findOne(season ? { 'clans.tag': tag, season } : { 'clans.tag': tag }, { sort: { _id: -1 } });
    }
    async pushWarTags(tag, body) {
        const rounds = body.rounds.filter((r) => !r.warTags.includes('#0'));
        if (rounds.length !== body.clans.length - 1)
            return null;
        const data = await this.client.db
            .collection("CWLGroups" /* Collections.CWL_GROUPS */)
            .findOne({ 'clans.tag': tag }, { sort: { _id: -1 } });
        if (data?.season === Season.monthId)
            return null;
        if (data && new Date().getMonth() <= new Date(data.season).getMonth())
            return null;
        const warTags = body.clans.reduce((pre, clan) => {
            pre[clan.tag] = [];
            return pre;
        }, {});
        for (const round of rounds) {
            for (const warTag of round.warTags) {
                const { body: data, res } = await this.client.coc.getClanWarLeagueRound(warTag);
                if (!res.ok)
                    continue;
                if (!warTags[data.clan.tag].includes(warTag))
                    warTags[data.clan.tag].push(warTag);
                if (!warTags[data.opponent.tag].includes(warTag))
                    warTags[data.opponent.tag].push(warTag);
            }
        }
        // return this.pushToDB(tag, body.clans, warTags, rounds, body.season);
    }
    md5(id) {
        return createHash('md5').update(id).digest('hex');
    }
    async pushToDB(clanTag, clans, warTags, rounds, season) {
        const uid = this.md5(`${season}-${clans
            .map((clan) => clan.tag)
            .sort((a, b) => a.localeCompare(b))
            .join('-')}`);
        const result = await this.leagueIds(clanTag, season);
        if (!result)
            return null;
        const { leagues, clans: _clans } = result;
        if (clans.length !== _clans.length)
            return null;
        return this.client.db.collection("CWLGroups" /* Collections.CWL_GROUPS */).updateOne({ uid }, {
            $set: {
                warTags,
                rounds
            },
            $setOnInsert: {
                uid,
                season,
                id: await this.uuid(),
                clans: clans.map((clan) => ({
                    tag: clan.tag,
                    name: clan.name,
                    leagueId: leagues[clan.tag]
                })),
                leagues,
                createdAt: new Date()
            }
        }, { upsert: true });
    }
    async restoreLeagueGroup(clanTag, season) {
        const result = await this.leagueIds(clanTag, season);
        if (!result)
            return null;
        const { leagues, clans, warTags, rounds } = result;
        const uid = this.md5(`${season}-${clans
            .map((clan) => clan.tag)
            .sort((a, b) => a.localeCompare(b))
            .join('-')}`);
        return this.client.db.collection("CWLGroups" /* Collections.CWL_GROUPS */).updateOne({ uid }, {
            $setOnInsert: {
                uid,
                season,
                id: await this.uuid(),
                clans: clans.map((clan) => ({
                    name: clan.name,
                    tag: clan.tag,
                    leagueId: leagues[clan.tag]
                })),
                leagues,
                warTags,
                rounds,
                isDelayed: true,
                createdAt: new Date()
            }
        }, { upsert: true });
    }
    async leagueIds(clanTag, seasonId) {
        const group = await this.client.coc.getDataFromArchive(clanTag, seasonId);
        if (!group)
            return null;
        const leagues = {};
        for (const clan of group.clans) {
            const res = await fetch(`https://clan-war-league-api-production.up.railway.app/clans/${encodeURIComponent(clan.tag)}/cwl/seasons`);
            const seasons = (await res.json());
            const season = seasons.find((season) => season.seasonId === seasonId);
            if (!season?.leagueId)
                continue;
            leagues[clan.tag] = Number(season.leagueId);
        }
        Object.assign(Object.fromEntries(group.clans.map((clan) => [clan.tag, group.leagueId])), leagues);
        const rounds = [];
        for (const _rounds of cluster(group.wars, 4)) {
            const warTags = _rounds.map((round) => round.warTag);
            rounds.push({ warTags });
        }
        const warTags = {};
        for (const round of group.wars) {
            warTags[round.clan.tag] ??= [];
            warTags[round.opponent.tag] ??= [];
            warTags[round.clan.tag].push(round.warTag);
            warTags[round.opponent.tag].push(round.warTag);
        }
        const clans = group.clans.map((clan) => ({
            name: clan.name,
            tag: clan.tag,
            leagueId: leagues[clan.tag]
        }));
        return { clans, leagues, rounds, warTags, season: seasonId };
    }
    async makeAutoBoard({ channelId, guild, boardType, props = {} }) {
        const value = await this.client.db.collection("AutoBoardLogs" /* Collections.AUTO_BOARDS */).findOneAndUpdate({ guildId: guild.id, boardType }, {
            $set: {
                name: guild.name,
                channelId,
                color: this.client.embed(guild.id),
                updatedAt: new Date(),
                ...props
            },
            $unset: {
                disabled: '',
                webhook: '',
                messageId: ''
            },
            $setOnInsert: {
                createdAt: new Date()
            }
        }, { returnDocument: 'after', upsert: true });
        return this.client.enqueuer.addAutoBoard(value._id.toHexString());
    }
    async updateClanLinks(guildId) {
        const conflicts = [];
        const clans = await this.find(guildId);
        for (const clan of clans) {
            const { res, body: data } = await this.client.coc.getClan(clan.tag);
            if (!res.ok)
                continue;
            const result = await this.updatePlayerLinks(data.memberList);
            conflicts.push(...result);
        }
        if (conflicts.length) {
            this.client.logger.log(conflicts.map(({ playerTag }) => playerTag), { label: 'AccountConflicts' });
        }
    }
    async updatePlayerLinks(players) {
        const conflicts = [];
        const collection = this.client.db.collection("PlayerLinks" /* Collections.PLAYER_LINKS */);
        const _links = await collection.find({ tag: { $in: players.map((mem) => mem.tag) } }).toArray();
        const _discordLinks = await this.client.coc.getDiscordLinks(players);
        const userIds = unique([
            ..._links.map((link) => link.userId),
            ..._discordLinks.map((link) => link.userId)
        ]);
        const links = await collection.find({ userId: { $in: userIds } }).toArray();
        const discordLinks = await this.client.coc.getDiscordLinks(userIds.map((id) => ({ tag: id })));
        for (const { userId, tag } of discordLinks) {
            if (links.find((mem) => mem.tag === tag && mem.userId === userId))
                continue;
            const lastAccount = await collection.findOne({ userId }, { sort: { order: -1 } });
            const player = players.find((mem) => mem.tag === tag && mem.name) ??
                (await this.client.coc.getPlayer(tag).then(({ body }) => body));
            if (!player?.name)
                continue;
            const user = await this.client.users.fetch(userId).catch(() => null);
            if (!user || user.bot)
                continue;
            const dirtyLink = links.find((link) => link.tag === tag && link.userId !== userId && link.source === 'api');
            try {
                if (dirtyLink)
                    await collection.deleteOne({ tag: dirtyLink.tag });
                await collection.insertOne({
                    userId: user.id,
                    username: user.username,
                    displayName: user.displayName,
                    discriminator: user.discriminator,
                    tag,
                    name: player.name,
                    verified: false,
                    order: (lastAccount?.order ?? 0) + 1,
                    source: 'api',
                    linkedBy: 'bot',
                    createdAt: new Date()
                });
            }
            catch {
                conflicts.push({ userId: user.id, playerTag: tag });
            }
        }
        return conflicts;
    }
    async uuid() {
        const cursor = this.client.db
            .collection("CWLGroups" /* Collections.CWL_GROUPS */)
            .find()
            .sort({ id: -1 })
            .limit(1);
        const uuid = (await cursor.next())?.id ?? 0;
        return uuid + 1;
    }
}
//# sourceMappingURL=storage-handler.js.map