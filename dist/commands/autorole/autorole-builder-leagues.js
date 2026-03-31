import { BUILDER_BASE_LEAGUE_NAMES } from '../../util/constants.js';
import { MessageFlags } from 'discord.js';
import { Command } from '../../lib/handlers.js';
export default class AutoBbLeagueRoleCommand extends Command {
    constructor() {
        super('setup-builder-league-roles', {
            aliases: ['autorole-builder-leagues'],
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
        const rolesMap = {};
        for (const key in args) {
            if (!BUILDER_BASE_LEAGUE_NAMES.includes(key))
                continue;
            rolesMap[key] = args[key];
        }
        const selected = Object.entries(rolesMap).map(([league, role]) => ({ league, role }));
        if (typeof args.allowExternal === 'boolean') {
            await this.client.settings.set(interaction.guildId, "allowExternalAccountsLeague" /* Settings.ALLOW_EXTERNAL_ACCOUNTS_LEAGUE */, Boolean(args.allowExternal));
            if (!selected.length) {
                return interaction.editReply('Builder league roles settings updated.');
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
        const rolesConfig = this.client.settings.get(interaction.guildId, "builderLeagueRoles" /* Settings.BUILDER_LEAGUE_ROLES */, {});
        Object.assign(rolesConfig, Object.fromEntries(selected.map((s) => [s.league, s.role.id])));
        await this.client.settings.set(interaction.guildId, "builderLeagueRoles" /* Settings.BUILDER_LEAGUE_ROLES */, rolesConfig);
        this.client.storage.updateClanLinks(interaction.guildId);
        // TODO: Refresh Roles
        const roles = BUILDER_BASE_LEAGUE_NAMES.map((league) => ({
            league,
            role: rolesConfig[league]
        }));
        return interaction.editReply({
            allowedMentions: { parse: [] },
            content: [
                roles
                    .map(({ league, role }) => `${league.replace(/\b(\w)/g, (char) => char.toUpperCase())} ${role ? `<@&${role}>` : ''}`)
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
//# sourceMappingURL=autorole-builder-leagues.js.map