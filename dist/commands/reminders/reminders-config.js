import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, RoleSelectMenuBuilder } from 'discord.js';
import { Command } from '../../lib/handlers.js';
import { createInteractionCollector } from '../../util/pagination.js';
export default class RemindersConfigCommand extends Command {
    constructor() {
        super('reminders-config', {
            category: 'reminders',
            channel: 'guild',
            userPermissions: ['ManageGuild'],
            defer: true
        });
    }
    async exec(interaction, args) {
        if (args.reminder_ping_exclusion === 'disable') {
            await this.client.settings.delete(interaction.guild, "reminderExclusion" /* Settings.REMINDER_EXCLUSION */);
            return interaction.editReply({ content: `Reminder ping exclusion disabled.` });
        }
        const config = this.client.settings.get(interaction.guild, "reminderExclusion" /* Settings.REMINDER_EXCLUSION */, {
            type: 'optIn'
        });
        const customIds = {
            wars: this.client.uuid(interaction.user.id),
            raids: this.client.uuid(interaction.user.id),
            games: this.client.uuid(interaction.user.id),
            type: this.client.uuid(interaction.user.id),
            done: this.client.uuid(interaction.user.id)
        };
        const clanWarRemRole = new RoleSelectMenuBuilder().setMinValues(0).setCustomId(customIds.wars);
        const capitalRemRole = new RoleSelectMenuBuilder().setMinValues(0).setCustomId(customIds.raids);
        const clanGamesRemRole = new RoleSelectMenuBuilder()
            .setMinValues(0)
            .setCustomId(customIds.games);
        const clanWarRoleRow = new ActionRowBuilder().addComponents(clanWarRemRole);
        const capitalRaidRoleRow = new ActionRowBuilder().addComponents(capitalRemRole);
        const clanGamesRoleRow = new ActionRowBuilder().addComponents(clanGamesRemRole);
        const optInOutButton = new ButtonBuilder()
            .setStyle(ButtonStyle.Success)
            .setLabel(`Use ${config.type === 'optIn' ? 'OptOut' : 'OptIn'} Mode`)
            .setCustomId(customIds.type);
        const doneButton = new ButtonBuilder()
            .setStyle(ButtonStyle.Primary)
            .setLabel('Done')
            .setCustomId(customIds.done);
        const row = new ActionRowBuilder().addComponents(optInOutButton, doneButton);
        const mutate = () => {
            const config = this.client.settings.get(interaction.guild, "reminderExclusion" /* Settings.REMINDER_EXCLUSION */, {
                type: 'optIn'
            });
            clanWarRemRole.setPlaceholder(`Clan War Reminder ${config.type === 'optIn' ? 'OptIn' : 'OptOut'} Role`);
            capitalRemRole.setPlaceholder(`Capital Raid Reminder ${config.type === 'optIn' ? 'OptIn' : 'OptOut'} Role`);
            clanGamesRemRole.setPlaceholder(`Clan Games Reminder ${config.type === 'optIn' ? 'OptIn' : 'OptOut'} Role`);
            const embed = new EmbedBuilder().setDescription([
                `### Reminder Ping Exclusion Settings`,
                '\u200b',
                `**Clans Wars**`,
                `${config.wars ? `<@&${config.wars}>` : 'None'}`,
                '',
                `**Capital Raids**`,
                `${config.raids ? `<@&${config.raids}>` : 'None'}`,
                '',
                `**Clan Games**`,
                `${config.games ? `<@&${config.games}>` : 'None'}`,
                '',
                `**${config.type === 'optIn' ? 'OptIn' : 'OptOut'} Mode**`,
                config.type === 'optIn'
                    ? 'Anyone **without** these roles will **not** be pinged in the reminders.'
                    : 'Anyone **with** these roles will **not** be pinged in the reminders.'
            ].join('\n'));
            return embed;
        };
        const embed = mutate();
        const message = await interaction.editReply({
            embeds: [embed],
            components: [clanWarRoleRow, capitalRaidRoleRow, clanGamesRoleRow, row]
        });
        createInteractionCollector({
            message,
            interaction,
            customIds,
            onRoleSelect: async (action) => {
                const config = this.client.settings.get(interaction.guild, "reminderExclusion" /* Settings.REMINDER_EXCLUSION */, {
                    type: 'optIn'
                });
                const role = action.roles.first();
                if (action.customId === customIds.wars) {
                    if (role)
                        config.wars = role.id;
                    else
                        delete config.wars;
                }
                if (action.customId === customIds.raids) {
                    if (role)
                        config.raids = role.id;
                    else
                        delete config.raids;
                }
                if (action.customId === customIds.games) {
                    if (role)
                        config.games = role.id;
                    else
                        delete config.games;
                }
                await this.client.settings.set(interaction.guild, "reminderExclusion" /* Settings.REMINDER_EXCLUSION */, config);
                const embed = mutate();
                return action.update({
                    components: [clanWarRoleRow, capitalRaidRoleRow, clanGamesRoleRow, row],
                    embeds: [embed]
                });
            },
            onClick: async (action) => {
                if (action.customId === customIds.type) {
                    const config = this.client.settings.get(interaction.guild, "reminderExclusion" /* Settings.REMINDER_EXCLUSION */, {
                        type: 'optIn'
                    });
                    optInOutButton.setLabel(`Use ${config.type === 'optIn' ? 'OptOut' : 'OptIn'} Mode`);
                    await this.client.settings.set(interaction.guild, "reminderExclusion" /* Settings.REMINDER_EXCLUSION */, {
                        ...config,
                        type: config.type === 'optIn' ? 'optOut' : 'optIn'
                    });
                    const embed = mutate();
                    return action.update({
                        components: [clanWarRoleRow, capitalRaidRoleRow, clanGamesRoleRow, row],
                        embeds: [embed]
                    });
                }
                if (action.customId === customIds.done) {
                    await action.update({ embeds: [embed], components: [] });
                    return this.updateExclusionList(action.guild);
                }
            }
        });
        return this.updateExclusionList(interaction.guild);
    }
    async updateExclusionList(guild) {
        const config = this.client.settings.get(guild, "reminderExclusion" /* Settings.REMINDER_EXCLUSION */, { type: 'optIn' });
        if (!config.wars && !config.raids && !config.games)
            return;
        const members = await this.client.util.getGuildMembers(guild);
        if (!members.size)
            return null;
        if (config.wars) {
            const userIds = members
                .filter((mem) => mem.roles.cache.has(config.wars))
                .map((mem) => mem.id);
            config.warsExclusionUserIds = userIds;
        }
        if (config.games) {
            const userIds = members
                .filter((mem) => mem.roles.cache.has(config.games))
                .map((mem) => mem.id);
            config.gamesExclusionUserIds = userIds;
        }
        if (config.raids) {
            const userIds = members
                .filter((mem) => mem.roles.cache.has(config.raids))
                .map((mem) => mem.id);
            config.raidsExclusionUserIds = userIds;
        }
        return this.client.settings.set(guild, "reminderExclusion" /* Settings.REMINDER_EXCLUSION */, config);
    }
}
//# sourceMappingURL=reminders-config.js.map