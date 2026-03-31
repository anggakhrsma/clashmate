import { ChannelType, EmbedBuilder, PermissionFlagsBits, WebhookClient } from 'discord.js';
import { welcomeEmbedMaker } from '../../helper/welcome.helper.js';
import { Listener } from '../../lib/handlers.js';
import { EMOJIS } from '../../util/emojis.js';
export default class GuildCreateListener extends Listener {
    constructor() {
        super('guildCreate', {
            emitter: 'client',
            event: 'guildCreate',
            category: 'client'
        });
        Object.defineProperty(this, "webhook", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
    }
    getWebhook() {
        if (this.webhook)
            return this.webhook;
        const url = this.client.settings.get('global', "guildLogWebhookURL" /* Settings.GUILD_LOG_WEBHOOK_URL */, null);
        if (!url)
            return null;
        this.webhook = new WebhookClient({ url });
        return this.webhook;
    }
    async exec(guild) {
        if (!guild.available)
            return;
        this.client.util.setPresence();
        this.client.logger.log(`${guild.name} (${guild.id})`, { label: 'GUILD_CREATE' });
        await this.client.settings.loadGuild(guild.id);
        await this.intro(guild).catch(() => null);
        if (!this.client.isOwner(guild.ownerId)) {
            await this.client.stats.post();
            await this.client.stats.addition(guild.id);
        }
        await this.restore(guild);
        await this.client.stats.guilds(guild, 0);
        const user = await this.client.users.fetch(guild.ownerId);
        const webhook = this.getWebhook();
        if (webhook) {
            const embed = new EmbedBuilder()
                .setColor(0x38d863)
                .setAuthor({
                name: `${guild.name} (${guild.id})`,
                iconURL: guild.iconURL({ forceStatic: false })
            })
                .setTitle(`${EMOJIS.OWNER} ${user.displayName} (${user.id})`)
                .setFooter({
                text: `${guild.memberCount} members`,
                iconURL: user.displayAvatarURL()
            })
                .setTimestamp();
            return webhook.send({
                embeds: [embed],
                username: this.client.user.displayName,
                avatarURL: this.client.user.displayAvatarURL({ extension: 'png' })
            });
        }
    }
    async intro(guild) {
        const embed = welcomeEmbedMaker();
        if (guild.systemChannelId) {
            const channel = guild.channels.cache.get(guild.systemChannelId);
            if (channel
                .permissionsFor(this.client.user.id)
                ?.has([
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.ViewChannel
            ])) {
                return channel.send({ embeds: [embed] });
            }
        }
        const channel = guild.channels.cache
            .filter((channel) => channel.type === ChannelType.GuildText)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .filter((channel) => channel
            .permissionsFor(this.client.user.id)
            .has([
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ViewChannel
        ]))
            .first();
        if (channel)
            return channel.send({ embeds: [embed] });
        return this.client.logger.info(`Failed on ${guild.name} (${guild.id})`, {
            label: 'INTRO_MESSAGE'
        });
    }
    async restore(guild) {
        const db = this.client.db.collection("ClanStores" /* Collections.CLAN_STORES */);
        for await (const data of db.find({ guild: guild.id, active: true })) {
            this.client.enqueuer.add({ tag: data.tag, guild: guild.id });
        }
        await db.updateMany({ guild: guild.id }, { $set: { paused: false } });
    }
}
//# sourceMappingURL=guild-create.js.map