import { ActivityType, ChannelType, Guild, PermissionsBitField } from 'discord.js';
import { FeatureFlags } from './constants.js';
export class ClientUtil {
    constructor(client) {
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
        Object.defineProperty(this, "fetchRecords", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {}
        });
    }
    async setPresence() {
        if (this.client.inMaintenance)
            return null;
        let guilds = 0;
        try {
            const values = [this.client.guilds.cache.size];
            guilds = values.reduce((acc, val) => acc + val, 0);
        }
        catch { }
        if (!guilds)
            return null;
        return this.client.user.setPresence({
            status: 'online',
            activities: [
                {
                    type: ActivityType.Custom,
                    name: `Watching ${guilds.toLocaleString()} servers`
                }
            ]
        });
    }
    async getGuildMembers(interaction) {
        const guild = interaction instanceof Guild ? interaction : interaction.guild;
        if (this.client.cacheOverLimitGuilds.has(guild.id)) {
            return guild.members.cache;
        }
        this.client.cacheOverLimitGuilds.add(guild.id);
        setTimeout(() => {
            this.client.cacheOverLimitGuilds.delete(guild.id);
        }, 45 * 1000);
        try {
            try {
                const members = await guild.members.fetch({ time: 5000 });
                this.fetchRecords[guild.id] = new Date();
                return members;
            }
            catch (error) {
                throw new Error(error.message);
            }
        }
        catch (error) {
            console.error(error);
            this.client.logger.error(error, { label: 'ClientUtil' });
            return guild.members.cache;
        }
    }
    setMaintenanceBreak(cleared = false) {
        if (cleared)
            return this.client.user.setPresence({ status: 'online', activities: [] });
        return this.client.user.setPresence({
            status: 'online',
            activities: [
                {
                    type: ActivityType.Custom,
                    name: 'Maintenance Break!'
                }
            ]
        });
    }
    hasPermissions(channelId, permissions) {
        const channel = this.getTextBasedChannel(channelId);
        if (channel) {
            if (channel.isThread() &&
                channel.permissionsFor(this.client.user.id).has(permissions) &&
                this.hasWebhookPermission(channel.parent)) {
                return { isThread: true, channel, parent: channel.parent };
            }
            if (!channel.isThread() &&
                channel.permissionsFor(this.client.user)?.has(permissions) &&
                this.hasWebhookPermission(channel)) {
                return { isThread: false, channel, parent: channel };
            }
        }
        return null;
    }
    getTextBasedChannel(channelId) {
        const channel = this.client.channels.cache.get(channelId);
        if (channel) {
            if ((channel.isThread() && channel.parent) ||
                channel.type === ChannelType.GuildText ||
                channel.type === ChannelType.GuildAnnouncement) {
                return channel;
            }
        }
        return null;
    }
    createToken({ userId, guildId }) {
        return Buffer.from(JSON.stringify({ userId, guildId, ts: Date.now() })).toString('base64');
    }
    isManager(member, roleKey) {
        if (this.client.isOwner(member.user))
            return true;
        const managerRoleIds = this.client.settings.get(member.guild, "managerRole" /* Settings.MANAGER_ROLE */, []);
        const roleOverrides = roleKey
            ? this.client.settings.get(member.guild, roleKey, [])
            : [];
        return (member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
            member.roles.cache.hasAny(...managerRoleIds) ||
            Boolean(roleOverrides.length && member.roles.cache.hasAny(...roleOverrides)));
    }
    hasWebhookPermission(channel) {
        return channel.permissionsFor(this.client.user.id).has(['ManageWebhooks', 'ViewChannel']);
    }
    async isTrustedGuild(interaction) {
        if (!interaction.inCachedGuild())
            return false;
        const isTrustedFlag = this.client.isFeatureEnabled(FeatureFlags.TRUSTED_GUILD, interaction.guildId);
        const isManager = this.client.util.isManager(interaction.member, "linksManagerRole" /* Settings.LINKS_MANAGER_ROLE */);
        if (!isManager)
            return false;
        return (isTrustedFlag ||
            this.client.settings.get(interaction.guildId, "isTrustedGuild" /* Settings.IS_TRUSTED_GUILD */, false));
    }
}
//# sourceMappingURL=client.util.js.map