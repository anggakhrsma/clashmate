import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { title } from 'radash';
import { Command } from '../../lib/handlers.js';
import { createInteractionCollector } from '../../util/pagination.js';
export default class AutoRoleDisableCommand extends Command {
    constructor() {
        super('autorole-disable', {
            category: 'roles',
            channel: 'guild',
            defer: true,
            ephemeral: true,
            userPermissions: ['ManageGuild']
        });
    }
    async exec(interaction, args) {
        const action = {
            'town-hall': this.disableTownHallRoles.bind(this),
            'builder-hall': this.disableBuilderHallRoles.bind(this),
            'clan-roles': this.disableClanRoles.bind(this),
            'leagues': this.disableLeagueRoles.bind(this),
            'builder-leagues': this.disableBuilderLeagueRoles.bind(this),
            'wars': this.disableWarRoles.bind(this),
            'family': this.disableFamilyRoles.bind(this),
            'exclusive-family': this.disableFamilyRoles.bind(this),
            'family-leaders': this.disableFamilyRoles.bind(this),
            'guest': this.disableFamilyRoles.bind(this),
            'verified': this.disableFamilyRoles.bind(this),
            'eos-push': this.disableEOSPushRoles.bind(this),
            'account-linked': this.disableFamilyRoles.bind(this)
        }[args.type];
        if (typeof action !== 'function')
            throw new Error('Invalid action was specified');
        return action(interaction, args);
    }
    async disableClanRoles(interaction, args) {
        const { clans } = await this.client.storage.handleSearch(interaction, {
            args: args.clans,
            required: true
        });
        if (!clans)
            return null;
        const { customIds, row } = this.deleteButtonRow();
        const message = await interaction.editReply({
            components: [row],
            content: [
                '### This action cannot be undone! Are you sure?',
                `- It will **unset** clan roles from ${clans.length} clan${clans.length === 1 ? '' : 's'}`
            ].join('\n')
        });
        return this.confirmInteraction({
            customIds,
            interaction,
            message,
            onConfirm: async (action) => {
                await this.client.db
                    .collection("ClanStores" /* Collections.CLAN_STORES */)
                    .updateMany({ guild: interaction.guild.id, tag: { $in: clans.map((clan) => clan.tag) } }, { $unset: { roles: '', secureRole: '' } });
                return action.update({
                    components: [],
                    content: this.i18n('command.autorole.disable.success_with_count', {
                        lng: interaction.locale,
                        count: clans.length.toString(),
                        clans: clans.map((clan) => clan.name).join(', ')
                    })
                });
            }
        });
    }
    async disableFamilyRoles(interaction, args) {
        if (args.type === 'family') {
            this.client.settings.delete(interaction.guildId, "familyRole" /* Settings.FAMILY_ROLE */);
        }
        if (args.type === 'exclusive-family') {
            this.client.settings.delete(interaction.guildId, "exclusiveFamilyRole" /* Settings.EXCLUSIVE_FAMILY_ROLE */);
        }
        if (args.type === 'guest') {
            this.client.settings.delete(interaction.guildId, "guestRole" /* Settings.GUEST_ROLE */);
        }
        if (args.type === 'family-leaders') {
            this.client.settings.delete(interaction.guildId, "familyLeadersRole" /* Settings.FAMILY_LEADERS_ROLE */);
        }
        if (args.type === 'verified') {
            this.client.settings.delete(interaction.guildId, "accountVerifiedRole" /* Settings.ACCOUNT_VERIFIED_ROLE */);
        }
        if (args.type === 'account-linked') {
            this.client.settings.delete(interaction.guildId, "accountLinkedRole" /* Settings.ACCOUNT_LINKED_ROLE */);
        }
        return interaction.editReply(`Successfully disabled ${title(args.type)} role.`);
    }
    async disableLeagueRoles(interaction) {
        this.client.settings.delete(interaction.guildId, "leagueRoles" /* Settings.LEAGUE_ROLES */);
        this.client.settings.delete(interaction.guildId, "allowExternalAccountsLeague" /* Settings.ALLOW_EXTERNAL_ACCOUNTS_LEAGUE */);
        return interaction.editReply('Successfully disabled league roles.');
    }
    async disableEOSPushRoles(interaction) {
        this.client.settings.delete(interaction.guildId, "eosPushClanRoles" /* Settings.EOS_PUSH_CLAN_ROLES */);
        this.client.settings.set(interaction.guildId, "eosPushClans" /* Settings.EOS_PUSH_CLANS */, []);
        return interaction.editReply('Successfully disabled EOS Push roles.');
    }
    async disableBuilderLeagueRoles(interaction) {
        this.client.settings.delete(interaction.guildId, "builderLeagueRoles" /* Settings.BUILDER_LEAGUE_ROLES */);
        return interaction.editReply('Successfully disabled builder league roles.');
    }
    async disableTownHallRoles(interaction) {
        this.client.settings.delete(interaction.guildId, "townHallRoles" /* Settings.TOWN_HALL_ROLES */);
        this.client.settings.delete(interaction.guildId, "allowExternalAccounts" /* Settings.ALLOW_EXTERNAL_ACCOUNTS */);
        return interaction.editReply('Successfully disabled Town Hall roles.');
    }
    async disableBuilderHallRoles(interaction) {
        this.client.settings.delete(interaction.guildId, "builderHallRoles" /* Settings.BUILDER_HALL_ROLES */);
        return interaction.editReply('Successfully disabled Builder Hall roles.');
    }
    async disableWarRoles(interaction, args) {
        const { clans } = await this.client.storage.handleSearch(interaction, {
            args: args.clans,
            required: true
        });
        if (!clans)
            return null;
        const { customIds, row } = this.deleteButtonRow();
        const message = await interaction.editReply({
            components: [row],
            content: [
                '### This action cannot be undone! Are you sure?',
                `- It will **unset** war roles from ${clans.length} clan${clans.length === 1 ? '' : 's'}`
            ].join('\n')
        });
        return this.confirmInteraction({
            customIds,
            interaction,
            message,
            onConfirm: async (action) => {
                await this.client.db
                    .collection("ClanStores" /* Collections.CLAN_STORES */)
                    .updateMany({ guild: interaction.guild.id, tag: { $in: clans.map((clan) => clan.tag) } }, { $unset: { warRole: '' } });
                return action.update({
                    components: [],
                    content: this.i18n('command.autorole.disable.success_with_count', {
                        lng: interaction.locale,
                        count: clans.length.toString(),
                        clans: clans.map((clan) => clan.name).join(', ')
                    })
                });
            }
        });
    }
    deleteButtonRow() {
        const customIds = {
            confirm: this.client.uuid()
        };
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(customIds.confirm)
            .setLabel('Confirm')
            .setStyle(ButtonStyle.Danger));
        return { row, customIds };
    }
    async confirmInteraction({ interaction, message, customIds, onConfirm }) {
        createInteractionCollector({
            interaction,
            message,
            customIds,
            clear: true,
            onClick: (action) => {
                return onConfirm(action);
            }
        });
        return interaction;
    }
}
//# sourceMappingURL=autorole-disable.js.map