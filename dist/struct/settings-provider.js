import { Guild } from 'discord.js';
import { unique } from 'radash';
export class SettingsProvider {
    constructor(client) {
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
        Object.defineProperty(this, "settings", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "flags", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "settingsCollection", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "featureFlagsCollection", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.settingsCollection = client.db.collection("Settings" /* Collections.SETTINGS */);
        this.featureFlagsCollection = client.db.collection("FeatureFlags" /* Collections.FEATURE_FLAGS */);
        const watchStream = this.settingsCollection.watch([
            {
                $match: {
                    operationType: { $in: ['insert', 'update', 'delete'] }
                }
            }
        ], { fullDocument: 'updateLookup' });
        watchStream.on('change', (change) => {
            if (change.operationType === 'insert' || change.operationType === 'update') {
                this.settings.set(change.fullDocument.guildId, change.fullDocument);
            }
        });
        this.featureFlagsCollection
            .watch([
            {
                $match: {
                    operationType: { $in: ['insert', 'update', 'delete'] }
                }
            }
        ], { fullDocument: 'updateLookup' })
            .on('change', (change) => {
            if (change.operationType === 'insert' || change.operationType === 'update') {
                this.flags.set(change.fullDocument.key, change.fullDocument);
            }
            if (change.operationType === 'delete') {
                this.flags.delete(change.documentKey.key);
            }
        });
    }
    isFeatureEnabled(flagKey, distinctId) {
        const flag = this.flags.get(flagKey);
        if (!flag)
            return false;
        if (distinctId === 'global') {
            return flag.enabled;
        }
        if (flag.limited) {
            return flag.guildIds.includes(distinctId);
        }
        return flag.enabled;
    }
    async init({ globalOnly }) {
        const cursor = this.settingsCollection.find(globalOnly
            ? { guildId: 'global' }
            : {
                guildId: { $in: this.client.guilds.cache.map((guild) => guild.id) }
            }, { projection: { _id: 0 } });
        for await (const data of cursor) {
            this.settings.set(data.guildId, data);
        }
        if (globalOnly) {
            const cursor = this.featureFlagsCollection.find({}, { projection: { _id: 0 } });
            for await (const data of cursor) {
                this.flags.set(data.key, data);
            }
        }
    }
    async loadGuild(guildId) {
        const cursor = this.settingsCollection.find({ guildId }, { projection: { _id: 0 } });
        for await (const data of cursor) {
            this.settings.set(data.guildId, data);
        }
    }
    async addToWhitelist(guild, { userOrRoleId, isRole, commandId }) {
        const guildId = this.constructor.guildId(guild);
        const record = this.settings.get(guildId) || {};
        const whiteList = (record["commandWhitelist" /* SettingsEnum.COMMAND_WHITELIST */] || []);
        whiteList.push({
            key: `${userOrRoleId}-${commandId}`,
            userOrRoleId,
            commandId,
            isRole
        });
        record["commandWhitelist" /* SettingsEnum.COMMAND_WHITELIST */] = unique(whiteList, (list) => list.key);
        this.settings.set(guildId, record);
        return this.settingsCollection.updateOne({ guildId }, { $set: { ["commandWhitelist" /* SettingsEnum.COMMAND_WHITELIST */]: whiteList } }, { upsert: true });
    }
    async clearWhitelist(guild, { userOrRoleId, commandId }) {
        const guildId = this.constructor.guildId(guild);
        const record = this.settings.get(guildId) || {};
        const whiteList = (record["commandWhitelist" /* SettingsEnum.COMMAND_WHITELIST */] || []);
        const key = `${userOrRoleId}-${commandId}`;
        const filtered = whiteList.filter((list) => list.key !== key);
        record["commandWhitelist" /* SettingsEnum.COMMAND_WHITELIST */] = filtered;
        this.settings.set(guildId, record);
        return this.settingsCollection.updateOne({ guildId }, { $set: { ["commandWhitelist" /* SettingsEnum.COMMAND_WHITELIST */]: filtered } });
    }
    get(guild, key, defaultValue) {
        const guildId = this.constructor.guildId(guild);
        if (this.settings.has(guildId)) {
            const value = this.settings.get(guildId)[key];
            return value == null ? defaultValue : value;
        }
        return defaultValue;
    }
    async set(guild, key, value) {
        const guildId = this.constructor.guildId(guild);
        const data = this.settings.get(guildId) || {};
        data[key] = value;
        this.settings.set(guildId, data);
        return this.settingsCollection.updateOne({ guildId }, { $set: { [key]: value } }, { upsert: true });
    }
    async push(guild, key, items) {
        const guildId = this.constructor.guildId(guild);
        const record = this.settings.get(guildId) || {};
        let value = record[key] || [];
        if (Array.isArray(value))
            value = value.concat(items);
        else if (value)
            value = [value, ...items];
        else
            value = items;
        record[key] = unique(value);
        this.settings.set(guildId, record);
        return this.settingsCollection.updateOne({ guildId }, { $set: { [key]: value } }, { upsert: true });
    }
    async delete(guild, key) {
        const guildId = this.constructor.guildId(guild);
        const data = this.settings.get(guildId) || {};
        delete data[key];
        return this.settingsCollection.updateOne({ guildId }, { $unset: { [key]: '' } });
    }
    async clear(guild) {
        const guildId = this.constructor.guildId(guild);
        this.settings.delete(guildId);
        return this.settingsCollection.deleteOne({ guildId });
    }
    flatten() {
        return this.settings.values();
    }
    hasCustomBot(guild) {
        return this.get(guild, "hasCustomBot" /* SettingsEnum.HAS_CUSTOM_BOT */, false);
    }
    setCustomBot(guild) {
        return this.set(guild, "hasCustomBot" /* SettingsEnum.HAS_CUSTOM_BOT */, true);
    }
    deleteCustomBot(guild) {
        return this.delete(guild, "hasCustomBot" /* SettingsEnum.HAS_CUSTOM_BOT */);
    }
    static guildId(guild) {
        if (guild instanceof Guild)
            return guild.id;
        if (guild === 'global' || guild === null)
            return 'global';
        if (/^\d+$/.test(guild))
            return guild;
        throw new TypeError('Invalid guild specified. Must be a Guild instance, guild ID, "global", or null.');
    }
}
//# sourceMappingURL=settings-provider.js.map