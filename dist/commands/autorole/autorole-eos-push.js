import { EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from '../../lib/handlers.js';
export default class EOSPushRoleCommand extends Command {
    constructor() {
        super('autorole-eos-push', {
            category: 'roles',
            channel: 'guild',
            userPermissions: ['ManageGuild'],
            clientPermissions: ['EmbedLinks', 'ManageRoles'],
            defer: true,
            ephemeral: true
        });
    }
    async exec(interaction, args) {
        const { clans } = await this.client.storage.handleSearch(interaction, {
            args: args.clans,
            required: true
        });
        if (!clans)
            return;
        const roles = [args.role];
        const selected = roles.filter((role) => role);
        if (!selected.length) {
            return interaction.followUp({
                content: 'You must select at least one role.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (selected.some((role) => this.isSystemRole(role, interaction.guild))) {
            const systemRoles = selected.filter((role) => this.isSystemRole(role, interaction.guild));
            return interaction.editReply(`${this.i18n('command.autorole.no_system_roles', { lng: interaction.locale })} (${systemRoles
                .map(({ id }) => `<@&${id}>`)
                .join(', ')})`);
        }
        if (selected.some((role) => this.isHigherRole(role, interaction.guild))) {
            return interaction.editReply(this.i18n('command.autorole.no_higher_roles', { lng: interaction.locale }));
        }
        this.client.settings.set(interaction.guildId, "eosPushClanRoles" /* Settings.EOS_PUSH_CLAN_ROLES */, [args.role.id]);
        this.client.settings.set(interaction.guildId, "eosPushClans" /* Settings.EOS_PUSH_CLANS */, clans.map((clan) => clan.tag));
        this.client.storage.updateClanLinks(interaction.guildId);
        // TODO: Refresh Roles
        const embed = new EmbedBuilder()
            .setColor(this.client.embed(interaction))
            .setDescription([
            `## EOS Push Role Settings`,
            `### Clans`,
            `${clans.map((clan) => `${clan.name} (${clan.tag})`).join(', ')}`,
            `### Role`,
            `${this.getRoleOrNone(args.role.id)}`
        ].join('\n'));
        return interaction.editReply({ embeds: [embed] });
    }
    isSystemRole(role, guild) {
        return role.managed || role.id === guild.id;
    }
    isHigherRole(role, guild) {
        return role.position > guild.members.me.roles.highest.position;
    }
    getRoleOrNone(id) {
        return id ? `<@&${id}>` : 'None';
    }
}
//# sourceMappingURL=autorole-eos-push.js.map