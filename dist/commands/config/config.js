import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, resolveColor } from 'discord.js';
import { title, unique } from 'radash';
import { Command } from '../../lib/handlers.js';
import { command } from '../../util/locales.js';
import { createInteractionCollector } from '../../util/pagination.js';
const options = [
    {
        name: 'bot_manager_role',
        key: "managerRole" /* Settings.MANAGER_ROLE */,
        description: command.config.options.manager_role.description
    },
    {
        name: 'roster_manager_role',
        key: "rosterManagerRole" /* Settings.ROSTER_MANAGER_ROLE */,
        description: command.config.options.roster_manager_role.description
    },
    {
        name: 'flags_manager_role',
        key: "flagsManagerRole" /* Settings.FLAGS_MANAGER_ROLE */,
        description: command.config.options.flags_manager_role.description
    },
    {
        name: 'links_manager_role',
        key: "linksManagerRole" /* Settings.LINKS_MANAGER_ROLE */,
        description: command.config.options.links_manager_role.description
    }
];
export default class ConfigCommand extends Command {
    constructor() {
        super('config', {
            category: 'config',
            userPermissions: ['ManageGuild'],
            clientPermissions: ['EmbedLinks'],
            channel: 'guild',
            defer: true
        });
    }
    async exec(interaction, args) {
        if (args.color_code) {
            await this.client.settings.set(interaction.guild, "color" /* Settings.COLOR */, this.getColor(args.color_code));
        }
        if (args.webhook_limit) {
            const webhookLimit = Math.max(3, Math.min(8, args.webhook_limit));
            await this.client.settings.set(interaction.guild, "webhookLimit" /* Settings.WEBHOOK_LIMIT */, webhookLimit);
        }
        if (args.bot_manager_role) {
            await this.client.settings.push(interaction.guild, "managerRole" /* Settings.MANAGER_ROLE */, [
                args.bot_manager_role.id
            ]);
        }
        if (args.roster_manager_role) {
            await this.client.settings.push(interaction.guild, "rosterManagerRole" /* Settings.ROSTER_MANAGER_ROLE */, [
                args.roster_manager_role.id
            ]);
        }
        if (args.flags_manager_role) {
            await this.client.settings.push(interaction.guild, "flagsManagerRole" /* Settings.FLAGS_MANAGER_ROLE */, [
                args.flags_manager_role.id
            ]);
        }
        if (args.links_manager_role) {
            await this.client.settings.push(interaction.guild, "linksManagerRole" /* Settings.LINKS_MANAGER_ROLE */, [
                args.links_manager_role.id
            ]);
        }
        const validOptions = this.getOptions();
        const embed = this.fallback(interaction);
        const customIds = {
            manage: this.client.uuid(interaction.user.id),
            menu: this.client.uuid(interaction.user.id),
            ["managerRole" /* Settings.MANAGER_ROLE */]: this.client.uuid(interaction.user.id),
            ["rosterManagerRole" /* Settings.ROSTER_MANAGER_ROLE */]: this.client.uuid(interaction.user.id),
            ["flagsManagerRole" /* Settings.FLAGS_MANAGER_ROLE */]: this.client.uuid(interaction.user.id),
            ["linksManagerRole" /* Settings.LINKS_MANAGER_ROLE */]: this.client.uuid(interaction.user.id)
        };
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setLabel('Manage Permissions')
            .setStyle(ButtonStyle.Success)
            .setCustomId(customIds.manage));
        const menuOptions = new StringSelectMenuBuilder()
            .setCustomId(customIds.menu)
            .setPlaceholder('What would you like to set?')
            .addOptions(validOptions);
        const optionMenu = new ActionRowBuilder().addComponents(menuOptions);
        const roleKeys = [
            "managerRole" /* Settings.MANAGER_ROLE */,
            "flagsManagerRole" /* Settings.FLAGS_MANAGER_ROLE */,
            "rosterManagerRole" /* Settings.ROSTER_MANAGER_ROLE */,
            "linksManagerRole" /* Settings.LINKS_MANAGER_ROLE */
        ];
        const message = await interaction.editReply({ embeds: [embed], components: [row] });
        createInteractionCollector({
            message,
            customIds,
            interaction,
            onClick: (action) => {
                const validOptions = this.getOptions().map((op) => ({ ...op, default: false }));
                menuOptions.setOptions(validOptions);
                return action.update({
                    embeds: [],
                    content: [
                        '### Select an option to set Permissions',
                        ...roleKeys.map((key) => `- ${title(key)}`)
                    ].join('\n'),
                    components: [optionMenu]
                });
            },
            onSelect: async (action) => {
                const roleKey = action.values[0];
                const roleMenus = [];
                for (const key of roleKeys) {
                    if (key !== roleKey)
                        continue;
                    const roles = this.getRoles(interaction.guild, key);
                    const roleMenu = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder()
                        .setCustomId(customIds[key])
                        .setPlaceholder(`Select ${title(key)}`)
                        .setMinValues(0)
                        .setMaxValues(25)
                        .setDefaultRoles(...unique(roles)));
                    roleMenus.push(roleMenu);
                }
                const validOptions = this.getOptions().map((op) => ({
                    ...op,
                    default: op.value === roleKey
                }));
                const opt = validOptions.find((op) => op.value === roleKey);
                menuOptions.setOptions(validOptions);
                return action.update({
                    embeds: [],
                    content: `### Select ${opt.label}s\n${opt.description}`,
                    components: [optionMenu, ...roleMenus]
                });
            },
            onRoleSelect: async (action) => {
                const roleIds = unique(action.roles.map((role) => role.id));
                if (customIds.managerRole === action.customId) {
                    if (roleIds.length) {
                        await this.client.settings.set(interaction.guild, "managerRole" /* Settings.MANAGER_ROLE */, roleIds);
                    }
                    else {
                        await this.client.settings.delete(interaction.guild, "managerRole" /* Settings.MANAGER_ROLE */);
                    }
                }
                if (customIds.flagsManagerRole === action.customId) {
                    if (roleIds.length) {
                        await this.client.settings.set(interaction.guild, "flagsManagerRole" /* Settings.FLAGS_MANAGER_ROLE */, roleIds);
                    }
                    else {
                        await this.client.settings.delete(interaction.guild, "flagsManagerRole" /* Settings.FLAGS_MANAGER_ROLE */);
                    }
                }
                if (customIds.rosterManagerRole === action.customId) {
                    if (roleIds.length) {
                        await this.client.settings.set(interaction.guild, "rosterManagerRole" /* Settings.ROSTER_MANAGER_ROLE */, roleIds);
                    }
                    else {
                        await this.client.settings.delete(interaction.guild, "rosterManagerRole" /* Settings.ROSTER_MANAGER_ROLE */);
                    }
                }
                if (customIds.linksManagerRole === action.customId) {
                    if (roleIds.length) {
                        await this.client.settings.set(interaction.guild, "linksManagerRole" /* Settings.LINKS_MANAGER_ROLE */, roleIds);
                    }
                    else {
                        await this.client.settings.delete(interaction.guild, "linksManagerRole" /* Settings.LINKS_MANAGER_ROLE */);
                    }
                }
                return action.update({ embeds: [this.fallback(action)], components: [row] });
            }
        });
    }
    fallback(interaction) {
        const color = this.client.settings.get(interaction.guild, "color" /* Settings.COLOR */, null);
        const channel = interaction.guild.channels.cache.get(this.client.settings.get(interaction.guild, "eventsChannel" /* Settings.EVENTS_CHANNEL */, null));
        const managerRoles = this.getRoles(interaction.guild, "managerRole" /* Settings.MANAGER_ROLE */);
        const flagsManagerRoles = this.getRoles(interaction.guild, "flagsManagerRole" /* Settings.FLAGS_MANAGER_ROLE */);
        const rosterManagerRoles = this.getRoles(interaction.guild, "rosterManagerRole" /* Settings.ROSTER_MANAGER_ROLE */);
        const linksManagerRoles = this.getRoles(interaction.guild, "linksManagerRole" /* Settings.LINKS_MANAGER_ROLE */);
        const embed = new EmbedBuilder()
            .setColor(this.client.embed(interaction))
            .setAuthor({ name: this.i18n('command.config.title', { lng: interaction.locale }) })
            .addFields([
            {
                name: 'Prefix',
                value: '/'
            },
            {
                name: 'Patreon Status',
                value: 'All features are free — no subscription needed.'
            },
            {
                name: 'Manager Roles',
                value: `${managerRoles.map((id) => `<@&${id}>`).join(' ') || 'None'}`
            },
            {
                name: 'Roster Manager Roles',
                value: `${rosterManagerRoles.map((id) => `<@&${id}>`).join(' ') || 'None'}`
            },
            {
                name: 'Flags Manager Roles',
                value: `${flagsManagerRoles.map((id) => `<@&${id}>`).join(' ') || 'None'}`
            },
            {
                name: 'Links Manager Roles',
                value: `${linksManagerRoles.map((id) => `<@&${id}>`).join(' ') || 'None'}`
            },
            {
                name: 'Webhook Limit',
                value: `${this.client.settings.get(interaction.guild, "webhookLimit" /* Settings.WEBHOOK_LIMIT */, 8)}`
            },
            {
                name: this.i18n('common.color_code', { lng: interaction.locale }),
                value: color ? `#${color.toString(16).toUpperCase()}` : 'None'
            },
            {
                name: this.i18n('common.choices.maintenance_break_log', { lng: interaction.locale }),
                value: channel?.toString() ?? 'None'
            }
        ]);
        return embed;
    }
    getColor(hex) {
        try {
            return resolveColor(hex);
        }
        catch {
            return null;
        }
    }
    getRoles(guild, key) {
        const value = this.client.settings.get(guild, key, []);
        if (typeof value === 'string')
            return [value];
        return value;
    }
    getOptions() {
        return options.map((op) => ({
            label: title(op.name),
            value: op.key,
            description: op.description
        }));
    }
}
//# sourceMappingURL=config.js.map