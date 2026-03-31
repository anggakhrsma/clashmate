export class StatsHandler {
    constructor(client) {
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
        Object.defineProperty(this, "messages", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
    }
    get key() {
        return new Date(Date.now() + 198e5).toISOString().slice(0, 10);
    }
    async post() {
        if (false || !true)
            return;
        const values = [this.client.guilds.cache.size];
        const guilds = values.reduce((prev, curr) => prev + curr, 0);
        if (!guilds)
            return;
        const [clans, players] = await Promise.all([
            this.client.db.collection("ClanStores" /* Collections.CLAN_STORES */).estimatedDocumentCount(),
            this.client.db.collection("Players" /* Collections.PLAYERS */).estimatedDocumentCount()
        ]);
        await this.client.db
            .collection("BotStats" /* Collections.BOT_STATS */)
            .bulkWrite([
            { updateOne: { filter: { name: 'GUILDS' }, update: { $set: { count: guilds } } } },
            { updateOne: { filter: { name: 'PLAYERS' }, update: { $set: { count: players } } } },
            { updateOne: { filter: { name: 'CLANS' }, update: { $set: { count: clans } } } }
        ], { ordered: false });
    }
    async interactions(interaction, command) {
        await this.client.db.collection("BotInteractions" /* Collections.BOT_INTERACTIONS */).updateOne({ user: interaction.user.id, guild: interaction.guild.id }, {
            $inc: { usage: 1 },
            $set: {
                isAdmin: interaction.member.permissions.has('ManageGuild'),
                locale: interaction.locale,
                guildLocale: interaction.guildLocale,
                lastUpdated: new Date()
            }
        }, { upsert: true });
        await this.client.db
            .collection("BotCommands" /* Collections.BOT_COMMANDS */)
            .updateOne({ command }, { $inc: { total: 1, uses: 1 } }, { upsert: true });
    }
    historic(command) {
        return this.client.db.collection("BotUsage" /* Collections.BOT_USAGE */).updateOne({ key: this.key }, {
            $inc: {
                usage: 1,
                [`commands.${command}`]: 1
            },
            $set: {
                key: this.key
            },
            $min: {
                createdAt: new Date()
            }
        }, { upsert: true });
    }
    async commands(command) {
        await this.client.db
            .collection("BotStats" /* Collections.BOT_STATS */)
            .updateOne({ name: 'COMMANDS_USED' }, { $inc: { count: 1 } }, { upsert: true });
        return this.historic(command);
    }
    deletion() {
        return this.client.db.collection("BotGrowth" /* Collections.BOT_GROWTH */).updateOne({ key: this.key }, {
            $inc: {
                addition: 0,
                deletion: 1,
                retention: 0
            },
            $set: {
                key: this.key
            },
            $min: {
                createdAt: new Date()
            }
        }, { upsert: true });
    }
    async addition(guild) {
        const old = await this.client.db.collection("BotGuilds" /* Collections.BOT_GUILDS */).countDocuments({ guild });
        return this.client.db.collection("BotGrowth" /* Collections.BOT_GROWTH */).updateOne({ key: this.key }, {
            $inc: {
                addition: 1,
                deletion: 0,
                retention: old ? 1 : 0
            },
            $set: {
                key: this.key
            },
            $min: {
                createdAt: new Date()
            },
            $max: {
                updatedAt: new Date()
            }
        }, { upsert: true });
    }
    users(interaction) {
        return this.client.db.collection("BotUsers" /* Collections.BOT_USERS */).updateOne({ user: interaction.user.id }, {
            $set: {
                user: interaction.user.id,
                username: interaction.user.username,
                displayName: interaction.user.displayName,
                locale: interaction.locale
            },
            $inc: { usage: 1 },
            $min: { createdAt: new Date() }
        }, { upsert: true });
    }
    guilds(guild, usage = 1) {
        return this.client.db.collection("BotGuilds" /* Collections.BOT_GUILDS */).updateOne({ guild: guild.id }, {
            $setOnInsert: {
                createdAt: new Date()
            },
            $set: {
                guild: guild.id,
                name: guild.name,
                iconUrl: guild.iconURL(),
                updatedAt: new Date(),
                locale: guild.preferredLocale,
                memberCount: guild.approximateMemberCount || guild.memberCount
            },
            $inc: { usage }
        }, { upsert: true });
    }
}
//# sourceMappingURL=stats-handler.js.map