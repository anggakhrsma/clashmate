import { EmbedBuilder, WebhookClient } from 'discord.js';
import { Listener } from '../../lib/handlers.js';
export default class RateLimitListener extends Listener {
    constructor() {
        super('rateLimit', {
            event: 'rateLimited',
            emitter: 'rest',
            category: 'client'
        });
        Object.defineProperty(this, "count", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "embeds", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "webhook", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        this.count = 0;
        this.embeds = [];
        setInterval(async () => {
            this.count = 0;
            if (!this.embeds.length)
                return;
            const webhook = this.getWebhook();
            if (!webhook)
                return (this.embeds = []);
            const embeds = [...this.embeds];
            this.embeds = [];
            return webhook.send({
                embeds: [...embeds],
                username: this.client.user.displayName,
                avatarURL: this.client.user.displayAvatarURL()
            });
        }, 5000);
    }
    getWebhook() {
        if (this.webhook)
            return this.webhook;
        const url = this.client.settings.get('global', "rateLimitWebhookURL" /* Settings.RATE_LIMIT_WEBHOOK_URL */, null);
        if (!url)
            return null;
        this.webhook = new WebhookClient({ url });
        return this.webhook;
    }
    exec({ limit, method, route, global, hash, majorParameter, timeToReset, url }) {
        this.count += 1;
        if (this.count >= 5)
            return this.client.enqueuer.pause(true);
        this.client.logger.warn({ timeToReset, limit, method, url, route, global, hash, majorParameter }, { label: 'RATE_LIMIT' });
        const webhook = this.getWebhook();
        if (webhook && url.includes(webhook.id))
            return;
        const embed = new EmbedBuilder()
            .setAuthor({ name: 'Rate Limit' })
            .setDescription([
            `**Timeout:** ${timeToReset}`,
            `**Global:** ${global.toString()}`,
            `**Limit:** ${limit}`,
            `**Method:** ${method.toUpperCase()}`,
            `**Route:** ${route.replace(/[\w-]{20,}/g, ':token')}`,
            `**URL:** ${decodeURIComponent(new URL(url).pathname).replace(/[\w-]{20,}/g, '-')}`
        ].join('\n'))
            .setFooter({ text: `Shard 0` })
            .setTimestamp();
        return this.embeds.push(embed);
    }
}
//# sourceMappingURL=rate-limit.js.map