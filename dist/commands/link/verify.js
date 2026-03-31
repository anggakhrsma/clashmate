import { Command } from '../../lib/handlers.js';
import { EMOJIS } from '../../util/emojis.js';
export default class VerifyPlayerCommand extends Command {
    constructor() {
        super('verify', {
            category: 'link',
            channel: 'guild',
            clientPermissions: ['EmbedLinks'],
            defer: true,
            ephemeral: true
        });
    }
    args() {
        return {
            player: {
                id: 'tag',
                match: 'STRING'
            }
        };
    }
    async exec(interaction, { tag, token }) {
        const data = await this.client.resolver.resolvePlayer(interaction, tag);
        if (!data)
            return;
        const { body } = await this.client.coc.verifyPlayerToken(data.tag, token);
        if (body.status !== 'ok') {
            return interaction.editReply({
                content: [
                    this.i18n('command.verify.invalid_token', { lng: interaction.locale }),
                    'https://media.clashperk.com/assets/How_to_get_API_Token.gif'
                ].join('\n')
            });
        }
        const collection = this.client.db.collection("PlayerLinks" /* Collections.PLAYER_LINKS */);
        await collection.deleteOne({ userId: { $ne: interaction.user.id }, tag: data.tag });
        const lastAccount = await collection.findOne({ userId: interaction.user.id }, { sort: { order: -1 } });
        await collection.updateOne({ tag: data.tag }, {
            $set: {
                tag: data.tag,
                name: data.name,
                userId: interaction.user.id,
                username: interaction.user.username,
                displayName: interaction.user.displayName,
                discriminator: interaction.user.discriminator,
                verified: true,
                source: 'bot',
                linkedBy: interaction.user.id,
                updatedAt: new Date()
            },
            $setOnInsert: {
                order: lastAccount ? lastAccount.order + 1 : 0,
                createdAt: new Date()
            }
        }, { upsert: true });
        this.resetLinkAPI(interaction.user.id, data.tag);
        this.client.rolesManager.updateOne(interaction.user, interaction.guildId, !lastAccount);
        return interaction.editReply(this.i18n('command.verify.success', {
            lng: interaction.locale,
            info: `${data.name} (${data.tag}) ${EMOJIS.VERIFIED}`
        }));
    }
    async resetLinkAPI(userId, tag) {
        await this.client.coc.linkPlayerTag(userId, tag, { force: true });
    }
}
//# sourceMappingURL=verify.js.map