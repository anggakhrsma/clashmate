import { BUILDER_HALL_LEVELS_FOR_ROLES } from '../../util/constants.js';
import { MessageFlags } from 'discord.js';
import { Command } from '../../lib/handlers.js';
import { ORANGE_NUMBERS } from '../../util/emojis.js';
export default class AutoBuilderHallRoleCommand extends Command {
    constructor() {
        super('setup-builder-hall-roles', {
            aliases: ['autorole-builder-hall'],
            category: 'roles',
            channel: 'guild',
            userPermissions: ['ManageGuild'],
            clientPermissions: ['EmbedLinks', 'ManageRoles'],
            defer: true,
            ephemeral: true
        });
    }
    args() {
        return {
            allow_non_family_accounts: {
                id: 'allowExternal',
                match: 'BOOLEAN'
            }
        };
    }
    async exec(interaction, args) {
        const clans = await this.client.storage.find(interaction.guildId);
        if (!clans.length) {
            return interaction.editReply(this.i18n('common.no_clans_linked', {
                lng: interaction.locale,
                command: this.client.commands.SETUP_CLAN
            }));
        }
        const BUILDER_HALL_KEYS = BUILDER_HALL_LEVELS_FOR_ROLES.map((level) => `bh_${level}`);
        const rolesMap = {};
        for (const key in args) {
            if (!BUILDER_HALL_KEYS.includes(key))
                continue;
            rolesMap[key.replace(/^bh_/, '')] = args[key];
        }
        const selected = Object.entries(rolesMap).map(([hall, role]) => ({ hall, role }));
        if (typeof args.allowExternal === 'boolean') {
            await this.client.settings.set(interaction.guildId, "allowExternalAccounts" /* Settings.ALLOW_EXTERNAL_ACCOUNTS */, Boolean(args.allowExternal));
            if (!selected.length) {
                return interaction.editReply('Builder Hall roles settings updated.');
            }
        }
        if (!selected.length) {
            return interaction.followUp({
                content: 'You must select at least one role.',
                flags: MessageFlags.Ephemeral
            });
        }
        if (selected.some((r) => this.isSystemRole(r.role, interaction.guild))) {
            const systemRoles = selected.filter(({ role }) => this.isSystemRole(role, interaction.guild));
            return interaction.editReply(`${this.i18n('command.autorole.no_system_roles', { lng: interaction.locale })} (${systemRoles
                .map((r) => `<@&${r.role.id}>`)
                .join(', ')})`);
        }
        if (selected.some((r) => this.isHigherRole(r.role, interaction.guild))) {
            return interaction.editReply(this.i18n('command.autorole.no_higher_roles', { lng: interaction.locale }));
        }
        const rolesConfig = this.client.settings.get(interaction.guildId, "builderHallRoles" /* Settings.BUILDER_HALL_ROLES */, {});
        Object.assign(rolesConfig, Object.fromEntries(selected.map((s) => [s.hall, s.role.id])));
        await this.client.settings.set(interaction.guildId, "builderHallRoles" /* Settings.BUILDER_HALL_ROLES */, rolesConfig);
        this.client.storage.updateClanLinks(interaction.guildId);
        // TODO: Refresh Roles
        const roles = BUILDER_HALL_LEVELS_FOR_ROLES.map((hall) => ({
            hall,
            role: rolesConfig[hall]
        }));
        return interaction.editReply({
            allowedMentions: { parse: [] },
            content: [
                roles
                    .map(({ role, hall }) => `${ORANGE_NUMBERS[hall]} ${role ? `<@&${role}>` : ''}`)
                    .join('\n'),
                '',
                args.allowExternal ? '' : '(Family Only) Roles will be given to family members only.'
            ].join('\n')
        });
    }
    isSystemRole(role, guild) {
        return role.managed || role.id === guild.id;
    }
    isHigherRole(role, guild) {
        return role.position > guild.members.me.roles.highest.position;
    }
}
//# sourceMappingURL=autorole-builder-hall.js.map