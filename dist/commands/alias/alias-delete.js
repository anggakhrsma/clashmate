import { Command } from '../../lib/handlers.js';
export default class AliasDeleteCommand extends Command {
    constructor() {
        super('alias-delete', {
            category: 'setup',
            channel: 'guild',
            userPermissions: ['ManageGuild'],
            ephemeral: true,
            defer: true
        });
    }
    parseTag(tag) {
        return tag ? `#${tag.toUpperCase().replace(/O/g, '0').replace(/^#/g, '')}` : null;
    }
    async exec(interaction, args) {
        if (!args.alias)
            return interaction.editReply(this.i18n('command.alias.delete.no_name', { lng: interaction.locale }));
        const deleted = await this.client.db.collection("ClanStores" /* Collections.CLAN_STORES */).findOneAndUpdate({
            guild: interaction.guild.id,
            alias: { $exists: true },
            $or: [{ tag: this.parseTag(args.alias) }, { alias: args.alias.trim() }]
        }, { $unset: { alias: true } });
        if (!deleted) {
            return interaction.editReply(this.i18n('command.alias.delete.no_result', { lng: interaction.locale, name: args.alias }));
        }
        return interaction.editReply(this.i18n('command.alias.delete.success', { lng: interaction.locale, name: deleted.alias }));
    }
}
//# sourceMappingURL=alias-delete.js.map