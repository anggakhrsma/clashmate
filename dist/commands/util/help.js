import { CommandCategories } from '../../util/constants.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { flattenApplicationCommands } from '../../helper/commands.helper.js';
import { Command } from '../../lib/handlers.js';
import { EMOJIS } from '../../util/emojis.js';
import locales from '../../util/locales.js';
const categoryMap = {
    [CommandCategories.SEARCH]: 'Player and Clan',
    [CommandCategories.ACTIVITY]: 'Player and Clan',
    [CommandCategories.WAR]: 'War, CWL and Rosters',
    [CommandCategories.ROSTER]: 'War, CWL and Rosters',
    [CommandCategories.SUMMARY]: 'Exports, Summary, History',
    [CommandCategories.EXPORT]: 'Exports, Summary, History',
    [CommandCategories.LINK]: 'Player Links and Flags',
    [CommandCategories.FLAG]: 'Player Links and Flags',
    [CommandCategories.PROFILE]: 'Player Links and Flags',
    [CommandCategories.REMINDERS]: 'Reminders and Auto Roles',
    [CommandCategories.ROLES]: 'Reminders and Auto Roles',
    [CommandCategories.CONFIG]: 'Server Settings',
    [CommandCategories.SETUP]: 'Server Settings'
};
export default class HelpCommand extends Command {
    constructor() {
        super('help', {
            category: 'none',
            channel: 'dm',
            clientPermissions: ['EmbedLinks'],
            defer: true
        });
    }
    async exec(interaction, args) {
        if (args.ask) {
            return this.handler.exec(interaction, this.handler.getCommand('ask'), { message: args.ask });
        }
        const commands = await this.getCommands(interaction);
        const command = commands.find((command) => command.rootName === args.command || command.name === args.command);
        if (!command)
            return this.commandMenu(interaction, commands, args);
        const embed = new EmbedBuilder().setColor(this.client.embed(interaction));
        embed.setDescription([
            `## ${command.formatted} ${command.isRestricted ? EMOJIS.OWNER : ''}`,
            '\u200b',
            `${this.translate(command.translationKey, interaction.locale) || command.description}`,
            //
            command.options.length ? '### Options' : '',
            ...command.options.map((option) => `\`${option.name}\` -- ${option.description}\n`)
        ].join('\n'));
        return interaction.editReply({ embeds: [embed] });
    }
    async commandMenu(interaction, commands, args) {
        const grouped = commands.reduce((acc, cur) => {
            if (cur.category in categoryMap) {
                acc[categoryMap[cur.category]] ??= [];
                acc[categoryMap[cur.category]].push(cur);
            }
            return acc;
        }, {});
        const commandCategories = Object.entries(grouped).map(([category, commands]) => ({
            category,
            commandGroups: Object.values(commands.reduce((acc, cur) => {
                acc[cur.rootName] ??= [];
                acc[cur.rootName].push(cur);
                return acc;
            }, {}))
        }));
        const fields = Object.values(categoryMap);
        commandCategories.sort((a, b) => fields.indexOf(a.category) - fields.indexOf(b.category));
        if (!args.category || (args.category && !fields.includes(args.category)))
            args.category = categoryMap.search;
        const embeds = [];
        for (const { category, commandGroups } of commandCategories) {
            if (!args.expand && args.category && args.category !== category)
                continue;
            const embed = new EmbedBuilder();
            embed.setColor(this.client.embed(interaction));
            embed.setDescription([
                `## ${category}`,
                '',
                commandGroups
                    .map((commands) => {
                    const _commands = commands.map((command) => {
                        const description = this.translate(command.translationKey, interaction.locale) || command.description;
                        const icon = ` ${command.isRestricted ? EMOJIS.OWNER : ''}`;
                        return `### ${command.formatted}${icon}\n${description}`;
                    });
                    return _commands.join('\n');
                })
                    .join('\n\n')
            ].join('\n'));
            embeds.push(embed);
        }
        const customIds = {
            category: this.createId({ cmd: this.id, category: args.category, string_key: 'category' }),
            expand: this.createId({ cmd: this.id, expand: true })
        };
        const menuRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setPlaceholder('Select a command category')
            .setCustomId(customIds.category)
            .addOptions(Array.from(new Set(Object.values(categoryMap))).map((key) => ({
            label: key,
            value: key,
            default: key === args.category
        }))));
        const btnRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(customIds.expand)
            .setEmoji(EMOJIS.PRINT));
        if (embeds.length === 1) {
            return interaction.editReply({ embeds, components: [btnRow, menuRow] });
        }
        return this.onExport(interaction, embeds);
    }
    async onExport(interaction, [embed, ...embeds]) {
        await interaction.editReply({ embeds: [embed], components: [] });
        for (const embed of embeds)
            await interaction.followUp({ embeds: [embed] });
    }
    async getCommands(interaction) {
        const applicationCommands = false && interaction.inCachedGuild()
            ? (await this.client.application?.commands.fetch({ guildId: interaction.guildId }))
            : (await this.client.application?.commands.fetch());
        const items = await flattenApplicationCommands([...applicationCommands.values()]);
        const commands = items.map((command) => {
            const translationKey = this.formatKey(command.mappedId);
            const baseCommand = this.handler.getCommand(command.name);
            const targetCommand = this.handler.getCommand(command.mappedId);
            return {
                ...command,
                translationKey,
                category: baseCommand?.category ?? targetCommand?.category ?? CommandCategories.SEARCH,
                isRestricted: !!targetCommand?.userPermissions?.length
            };
        });
        return commands;
    }
    translate(key, lng) {
        const longKey = `command.${key}.description_long`;
        const shortKey = `command.${key}.description`;
        const longValue = this.getLocaleValue(longKey);
        if (typeof longValue === 'string')
            return longValue;
        const shortValue = this.getLocaleValue(shortKey);
        if (typeof shortValue === 'string')
            return shortValue;
        return null;
    }
    formatKey(str) {
        return str.replace(/\s+/g, '.').replace(/-/g, '_');
    }
    getLocaleValue(path) {
        return path.split('.').reduce((acc, part) => {
            if (acc && typeof acc === 'object') {
                return acc[part];
            }
            return undefined;
        }, locales);
    }
}
//# sourceMappingURL=help.js.map