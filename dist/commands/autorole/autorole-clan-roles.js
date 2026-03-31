import { MessageFlags } from 'discord.js';
import { Command } from '../../lib/handlers.js';
export default class AutoClanRoleCommand extends Command {
    constructor() {
        super('setup-clan-roles', {
            aliases: ['autorole-clan-roles'],
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
        const { everyone_role, member_role, elder_role, co_leader_role, leader_role } = args;
        const roles = [everyone_role, member_role, elder_role, co_leader_role, leader_role];
        const selected = roles.filter((role) => role);
        if (typeof args.only_verified === 'boolean') {
            await this.client.settings.set(interaction.guildId, "verifiedOnlyClanRoles" /* Settings.VERIFIED_ONLY_CLAN_ROLES */, Boolean(args.only_verified));
            if (!selected.length) {
                return interaction.editReply('Clan roles settings updated.');
            }
        }
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
        const rolesSettings = {};
        if (member_role)
            rolesSettings['roles.member'] = member_role.id;
        if (elder_role)
            rolesSettings['roles.admin'] = elder_role.id;
        if (co_leader_role)
            rolesSettings['roles.coLeader'] = co_leader_role.id;
        if (leader_role)
            rolesSettings['roles.leader'] = leader_role.id;
        if (everyone_role)
            rolesSettings['roles.everyone'] = everyone_role.id;
        if (Object.keys(rolesSettings).length) {
            await this.client.db
                .collection("ClanStores" /* Collections.CLAN_STORES */)
                .updateMany({ tag: { $in: clans.map((clan) => clan.tag) }, guild: interaction.guild.id }, { $set: { ...rolesSettings } });
        }
        this.client.storage.updateClanLinks(interaction.guildId);
        // TODO: Refresh Roles
        return interaction.editReply(this.i18n('command.autorole.success_with_count', {
            lng: interaction.locale,
            count: clans.length.toString(),
            clans: `${clans.map((clan) => clan.name).join(', ')}`
        }));
    }
    isSystemRole(role, guild) {
        return role.managed || role.id === guild.id;
    }
    isHigherRole(role, guild) {
        return guild.members.me && role.position > guild.members.me.roles.highest.position;
    }
}
//# sourceMappingURL=autorole-clan-roles.js.map