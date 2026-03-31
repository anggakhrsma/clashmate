import { EmbedBuilder, WebhookClient } from 'discord.js';
import { Listener } from '../../lib/handlers.js';
import { EMOJIS } from '../../util/emojis.js';
export default class GuildDeleteListener extends Listener {
    constructor() {
        super('guildDelete', {
            emitter: 'client',
            event: 'guildDelete',
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
        this.client.logger.log(`${guild.name} (${guild.id})`, { label: 'GUILD_DELETE' });
        await this.client.settings.loadGuild(guild.id);
        await this.delete(guild);
        if (!this.client.isOwner(guild.ownerId)) {
            await this.client.stats.post();
            await this.client.stats.deletion();
        }
        await this.client.stats.guilds(guild, 0);
        const user = await this.client.users.fetch(guild.ownerId);
        const webhook = this.getWebhook();
        if (webhook) {
            const embed = new EmbedBuilder()
                .setColor(0xeb3508)
                .setAuthor({ name: `${guild.name} (${guild.id})`, iconURL: guild.iconURL() })
                .setTitle(`${EMOJIS.OWNER} ${user.displayName} (${user.id})`)
                .setFooter({
                text: `${guild.memberCount} members`,
                iconURL: user.displayAvatarURL()
            })
                .setTimestamp();
            return webhook.send({
                embeds: [embed],
                username: this.client.user.displayName,
                avatarURL: this.client.user.displayAvatarURL({ forceStatic: false })
            });
        }
    }
    async delete(guild) {
        const db = this.client.db.collection("ClanStores" /* Collections.CLAN_STORES */);
        for await (const data of db.find({ guild: guild.id })) {
            this.client.enqueuer.delete({ tag: data.tag, guild: guild.id });
        }
        await db.updateMany({ guild: guild.id }, { $set: { paused: true } });
    }
}
//# sourceMappingURL=guild-delete.js.map