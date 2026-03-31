import { DiscordErrorCodes } from '../../util/constants.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, WebhookClient } from 'discord.js';
import { Listener } from '../../lib/handlers.js';
export default class GuildMemberAddListener extends Listener {
    constructor() {
        super('memberJoin', {
            emitter: 'client',
            event: 'guildMemberAdd',
            category: 'client'
        });
    }
    async exec(member) {
        if (member.user.bot)
            return;
        if (this.client.settings.hasCustomBot(member.guild) && !false)
            return;
        const log = this.client.settings.get(member.guild, "welcomeLog" /* Settings.WELCOME_LOG */, {});
        if (!log?.enabled)
            return;
        return this.sendWelcomeMessage(member, log);
    }
    async sendWelcomeMessage(member, log, isRetry = false) {
        const channel = this.client.util.getTextBasedChannel(log.channelId);
        if (!channel)
            return null;
        try {
            const webhook = new WebhookClient({ id: log.webhook.id, token: log.webhook.token });
            const embed = new EmbedBuilder().setDescription(log.description);
            if (log.bannerImage)
                embed.setImage(log.bannerImage);
            const linkConfig = this.client.settings.get(member.guild, "linkEmbeds" /* Settings.LINK_EMBEDS */, {
                token_field: 'optional',
                button_style: ButtonStyle.Primary
            });
            const linkButton = new ButtonBuilder()
                .setCustomId(JSON.stringify({ cmd: 'link-add', token_field: linkConfig.token_field }))
                .setLabel('Link account')
                .setEmoji('🔗')
                .setStyle(linkConfig.button_style || ButtonStyle.Primary);
            const actionRow = new ActionRowBuilder().addComponents(linkButton);
            await webhook.send({
                content: log.welcomeText.replace('{{user}}', member.toString()),
                embeds: [embed],
                components: [actionRow],
                ...(channel.isThread() ? { threadId: channel.id } : {})
            });
        }
        catch (error) {
            if (error.code === DiscordErrorCodes.UNKNOWN_WEBHOOK && !isRetry) {
                await this.retryWebhook(member, log);
                return null;
            }
            throw error;
        }
    }
    async retryWebhook(member, log) {
        const channel = this.client.util.getTextBasedChannel(log.channelId);
        if (!channel)
            return null;
        const webhook = await this.client.storage.getWebhook(channel.isThread() ? channel.parent : channel);
        if (!webhook)
            return null;
        await this.client.settings.set(member.guild.id, "welcomeLog" /* Settings.WELCOME_LOG */, {
            ...log,
            webhook: { token: webhook.token, id: webhook.id }
        });
        await this.sendWelcomeMessage(member, {
            ...log,
            webhook: { id: webhook.id, token: webhook.token }
        }, true);
    }
}
//# sourceMappingURL=member-join.js.map