import { URL_REGEX, missingPermissions } from '../../util/constants.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, DiscordjsError, DiscordjsErrorCodes, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, RoleSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { Command } from '../../lib/handlers.js';
import { resolveColorCode } from '../../lib/util.js';
import { createInteractionCollector } from '../../util/pagination.js';
export default class SetupUtilsCommand extends Command {
    constructor() {
        super('setup-server-logs', {
            category: 'setup',
            channel: 'guild',
            userPermissions: ['ManageGuild'],
            clientPermissions: [
                'EmbedLinks',
                'UseExternalEmojis',
                'ManageWebhooks',
                'SendMessagesInThreads',
                'SendMessages',
                'ReadMessageHistory',
                'ViewChannel'
            ],
            defer: true,
            ephemeral: true
        });
    }
    args(interaction) {
        return {
            channel: {
                match: 'CHANNEL',
                default: interaction.channel
            }
        };
    }
    async exec(interaction, args) {
        if (args.log_type === 'flag-alert-log')
            return this.flagAlertLog(interaction, args);
        if (args.log_type === 'roster-changelog')
            return this.rosterChangeLog(interaction, args);
        if (args.log_type === 'maintenance-break-log')
            return this.maintenanceBreakLog(interaction, args);
        if (args.log_type === 'welcome-log')
            return this.welcomeLog(interaction, args);
        throw new Error(`Command "${args.log_type}" not found.`);
    }
    async rosterChangeLog(interaction, args) {
        if (args.disable) {
            await this.client.settings.delete(interaction.guild, "rosterChangeLog" /* Settings.ROSTER_CHANGELOG */);
            return interaction.editReply({ content: `Roster changelog disabled.` });
        }
        const webhook = await this.client.storage.getWebhook(args.channel.isThread() ? args.channel.parent : args.channel);
        if (!webhook) {
            return interaction.editReply(this.i18n('common.too_many_webhooks', {
                lng: interaction.locale,
                channel: args.channel.toString()
            }));
        }
        await this.client.settings.set(interaction.guild, "rosterChangeLog" /* Settings.ROSTER_CHANGELOG */, {
            channelId: args.channel.id,
            webhook: { token: webhook.token, id: webhook.id }
        });
        return interaction.editReply({ content: `Roster changelog set to <#${args.channel.id}>` });
    }
    async maintenanceBreakLog(interaction, args) {
        if (args.disable) {
            await this.client.settings.delete(interaction.guild, "eventsChannel" /* Settings.EVENTS_CHANNEL */);
            return interaction.editReply({ content: `Maintenance notification channel disabled.` });
        }
        const permission = missingPermissions(args.channel, interaction.guild.members.me, [
            'ManageWebhooks',
            'ViewChannel',
            'SendMessages',
            'UseExternalEmojis'
        ]);
        if (permission.missing) {
            return interaction.editReply(this.i18n('common.missing_access', {
                lng: interaction.locale,
                channel: args.channel.toString(),
                permission: permission.missingPerms
            }));
        }
        await this.client.settings.set(interaction.guild, "eventsChannel" /* Settings.EVENTS_CHANNEL */, args.channel.id);
        return interaction.editReply(`Maintenance notification channel set to <#${args.channel.id}>`);
    }
    async flagAlertLog(interaction, args) {
        const ChannelTypes = [
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.AnnouncementThread,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.GuildMedia
        ];
        if (args.disable) {
            await this.client.db
                .collection("FlagAlertLogs" /* Collections.FLAG_ALERT_LOGS */)
                .deleteOne({ guildId: interaction.guildId });
            this.client.enqueuer.flagAlertLog.del(interaction.guildId);
            return interaction.editReply('Successfully disabled.');
        }
        const flagLog = await this.client.db
            .collection("FlagAlertLogs" /* Collections.FLAG_ALERT_LOGS */)
            .findOne({ guildId: interaction.guildId });
        const state = {
            channelId: flagLog?.channelId ?? interaction.channelId,
            roleId: flagLog?.roleId ?? null,
            useAutoRole: flagLog?.useAutoRole ?? false
        };
        const customIds = {
            channel: this.client.uuid(),
            role: this.client.uuid(),
            confirm: this.client.uuid(),
            useAutoRole: this.client.uuid()
        };
        const channelMenu = new ChannelSelectMenuBuilder()
            .addChannelTypes(ChannelTypes)
            .setCustomId(customIds.channel)
            .setPlaceholder('Select flag notification channel');
        if (state.channelId)
            channelMenu.setDefaultChannels(state.channelId);
        const roleMenu = new RoleSelectMenuBuilder()
            .setCustomId(customIds.role)
            .setPlaceholder('Select flag notification role')
            .setDisabled(state.useAutoRole);
        if (state.roleId)
            roleMenu.setDefaultRoles(state.roleId);
        const confirmButton = new ButtonBuilder()
            .setStyle(ButtonStyle.Primary)
            .setLabel('Confirm')
            .setCustomId(customIds.confirm)
            .setDisabled(!state.channelId);
        const useAutoRoleButton = new ButtonBuilder()
            .setStyle(ButtonStyle.Secondary)
            .setLabel(state.useAutoRole ? 'Use the Selected Role' : 'Use Clan-Specific Roles')
            .setCustomId(customIds.useAutoRole)
            .setDisabled(!state.channelId);
        const channelRow = new ActionRowBuilder().addComponents(channelMenu);
        const roleRow = new ActionRowBuilder().addComponents(roleMenu);
        const row = new ActionRowBuilder().addComponents(confirmButton, useAutoRoleButton);
        const getText = () => {
            return [
                '### Setting up Flag Alert Log',
                state.useAutoRole
                    ? '- Roles will be selected based on the AutoRole settings (Leader and Co-Leader only)'
                    : '',
                state.useAutoRole
                    ? '- Only specific Leader and Co-Leader roles will be notified if a banned player joins their clan.'
                    : ''
            ].join('\n');
        };
        const message = await interaction.editReply({
            content: getText(),
            components: [channelRow, roleRow, row]
        });
        const onMutation = async () => {
            if (!state.channelId)
                return;
            await this.client.db.collection("FlagAlertLogs" /* Collections.FLAG_ALERT_LOGS */).updateOne({ guildId: interaction.guild.id }, {
                $set: {
                    channelId: state.channelId,
                    roleId: state.roleId,
                    useAutoRole: state.useAutoRole,
                    updatedAt: new Date()
                },
                ...(flagLog && flagLog.channelId !== state.channelId ? { $unset: { webhook: '' } } : {}),
                $setOnInsert: {
                    createdAt: new Date()
                }
            }, { upsert: true });
            return this.client.enqueuer.flagAlertLog.add(interaction.guildId);
        };
        createInteractionCollector({
            customIds,
            interaction,
            message,
            onRoleSelect: async (action) => {
                state.roleId = action.roles.at(0)?.id ?? null;
                if (state.roleId)
                    roleMenu.setDefaultRoles(state.roleId);
                await action.update({ components: [channelRow, roleRow, row] });
            },
            onChannelSelect: async (action) => {
                state.channelId = action.channels.at(0).id;
                if (state.channelId)
                    channelMenu.setDefaultChannels(state.channelId);
                confirmButton.setDisabled(false);
                await action.update({ components: [channelRow, roleRow, row] });
            },
            onClick: async (action) => {
                if (action.customId === customIds.useAutoRole) {
                    state.useAutoRole = !state.useAutoRole;
                    roleMenu.setDisabled(!state.channelId || state.useAutoRole);
                    useAutoRoleButton.setLabel(state.useAutoRole ? 'Use the Selected Role' : 'Use Clan-Specific Roles');
                    return action.update({ components: [channelRow, roleRow, row], content: getText() });
                }
                roleMenu.setDisabled(true);
                channelMenu.setDisabled(true);
                const embed = new EmbedBuilder();
                embed.setTitle('Flag Alert Log');
                embed.setColor(this.client.embed(interaction));
                if (state.useAutoRole) {
                    embed.setDescription([
                        '### Channel',
                        `<#${state.channelId}>`,
                        '### Roles',
                        'Will be selected from the AutoRole settings (Leader and Co-Leader only)'
                    ].join('\n'));
                }
                else {
                    embed.setDescription([
                        '### Channel',
                        `<#${state.channelId}>`,
                        '### Role',
                        `${state.roleId ? `<@&${state.roleId}>` : 'None'}`
                    ].join('\n'));
                }
                const role = state.roleId && interaction.guild.roles.cache.get(state.roleId);
                const channel = state.channelId && interaction.guild.channels.cache.get(state.channelId);
                if (role &&
                    !role.mentionable &&
                    channel &&
                    !channel
                        .permissionsFor(interaction.guild.members.me)
                        .has(PermissionFlagsBits.MentionEveryone)) {
                    embed.setFooter({
                        text: [
                            `If the role is not mentionable, the push notification won't work!`,
                            'Either make the role mentionable or grant the bot Mention Everyone permission.'
                        ].join('\n')
                    });
                }
                await onMutation();
                this.client.settings.set(interaction.guildId, "hasFlagAlertLog" /* Settings.HAS_FLAG_ALERT_LOG */, true);
                await action.update({ embeds: [embed], components: [], content: null });
            }
        });
    }
    async welcomeLog(interaction, args) {
        const state = this.client.settings.get(interaction.guildId, "welcomeLog" /* Settings.WELCOME_LOG */, {
            enabled: true,
            channelId: interaction.channel.id,
            webhook: null,
            buttons: ['link-button'],
            welcomeText: 'Welcome {{user}}',
            description: 'Click the button to link your account.',
            bannerImage: null,
            embedColor: this.client.embed(interaction)
        });
        state.channelId = interaction.channel.id;
        if (args.disable) {
            this.client.settings.set(interaction.guildId, "welcomeLog" /* Settings.WELCOME_LOG */, {
                ...state,
                enabled: false
            });
            return interaction.editReply('Successfully disabled.');
        }
        const customIds = {
            edit: this.client.uuid(),
            confirm: this.client.uuid()
        };
        const editButton = new ButtonBuilder()
            .setStyle(ButtonStyle.Secondary)
            .setLabel('Edit')
            .setCustomId(customIds.edit);
        const confirmButton = new ButtonBuilder()
            .setStyle(ButtonStyle.Secondary)
            .setLabel('Confirm')
            .setCustomId(customIds.confirm);
        const row = new ActionRowBuilder().addComponents(editButton, confirmButton);
        const getText = () => {
            const embed = new EmbedBuilder().setDescription(state.description);
            if (state.embedColor)
                embed.setColor(state.embedColor);
            if (state.bannerImage)
                embed.setImage(state.bannerImage);
            const linkConfig = this.client.settings.get(interaction.guild, "linkEmbeds" /* Settings.LINK_EMBEDS */, {
                token_field: 'optional',
                button_style: ButtonStyle.Primary
            });
            const linkButton = new ButtonBuilder()
                .setCustomId(JSON.stringify({ cmd: 'link-add', token_field: linkConfig.token_field }))
                .setLabel('Link account')
                .setEmoji('🔗')
                .setStyle(linkConfig.button_style || ButtonStyle.Primary);
            const actionRow = new ActionRowBuilder().addComponents(linkButton);
            return {
                content: state.welcomeText,
                embeds: [embed],
                components: [actionRow, row]
            };
        };
        const message = await interaction.editReply(getText());
        const onCustomization = async (action) => {
            const modalCustomIds = {
                modal: this.client.uuid(action.user.id),
                welcomeText: this.client.uuid(action.user.id),
                description: this.client.uuid(action.user.id),
                bannerImage: this.client.uuid(action.user.id),
                embedColor: this.client.uuid(action.user.id)
            };
            const modal = new ModalBuilder().setCustomId(modalCustomIds.modal).setTitle(`Welcome Log`);
            const welcomeTextInput = new TextInputBuilder()
                .setCustomId(modalCustomIds.welcomeText)
                .setLabel('Welcome Text')
                .setPlaceholder('This will be shown in the welcome message. \nWelcome {{user}} \nMust include {{user}}')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(500)
                .setRequired(false);
            if (state.welcomeText)
                welcomeTextInput.setValue(state.welcomeText);
            const descriptionInput = new TextInputBuilder()
                .setCustomId(modalCustomIds.description)
                .setLabel('Description')
                .setPlaceholder('This will be shown in the embed description.')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(2000)
                .setRequired(false);
            if (state.description) {
                descriptionInput.setValue(state.description);
            }
            const bannerImageInput = new TextInputBuilder()
                .setCustomId(modalCustomIds.bannerImage)
                .setLabel('Banner Image URL')
                .setPlaceholder('Enter an image URL')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(256)
                .setRequired(false);
            if (state.bannerImage)
                bannerImageInput.setValue(state.bannerImage);
            const colorCodeInput = new TextInputBuilder()
                .setCustomId(modalCustomIds.embedColor)
                .setLabel('Embed Color Code')
                .setPlaceholder('Enter a hex color code (eg. #FF0000)')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(20)
                .setRequired(false);
            if (state.embedColor)
                colorCodeInput.setValue(`#${state.embedColor.toString(16).toUpperCase()}`);
            modal.addComponents(new ActionRowBuilder().addComponents(welcomeTextInput), new ActionRowBuilder().addComponents(descriptionInput), new ActionRowBuilder().addComponents(bannerImageInput), new ActionRowBuilder().addComponents(colorCodeInput));
            await action.showModal(modal);
            try {
                const modalSubmit = await action.awaitModalSubmit({
                    time: 10 * 60 * 1000,
                    filter: (action) => action.customId === modalCustomIds.modal
                });
                const welcomeText = modalSubmit.fields.getTextInputValue(modalCustomIds.welcomeText);
                state.welcomeText = welcomeText.trim();
                const description = modalSubmit.fields.getTextInputValue(modalCustomIds.description);
                state.description = description.trim();
                const bannerImage = modalSubmit.fields.getTextInputValue(modalCustomIds.bannerImage);
                state.bannerImage = URL_REGEX.test(bannerImage) ? bannerImage : '';
                const embedColor = modalSubmit.fields.getTextInputValue(modalCustomIds.embedColor);
                state.embedColor = resolveColorCode(embedColor);
                await modalSubmit.deferUpdate();
                await modalSubmit.editReply(getText());
            }
            catch (error) {
                if (!(error instanceof DiscordjsError &&
                    error.code === DiscordjsErrorCodes.InteractionCollectorError)) {
                    throw error;
                }
            }
        };
        createInteractionCollector({
            customIds,
            interaction,
            message,
            onClick: async (action) => {
                if (action.customId === customIds.edit) {
                    return onCustomization(action);
                }
                if (!state.welcomeText.includes('{{user}}')) {
                    return action.reply({
                        content: 'Welcome text must include {{user}}',
                        flags: MessageFlags.Ephemeral
                    });
                }
                const channel = this.client.util.getTextBasedChannel(state.channelId);
                if (!channel)
                    throw new Error('Channel not found');
                const webhook = await this.client.storage.getWebhook(channel.isThread() ? channel.parent : channel);
                if (!webhook) {
                    return action.reply(this.i18n('common.too_many_webhooks', {
                        lng: interaction.locale,
                        channel: channel.toString()
                    }));
                }
                state.enabled = true;
                state.webhook = { token: webhook.token, id: webhook.id };
                await this.client.settings.set(interaction.guildId, "welcomeLog" /* Settings.WELCOME_LOG */, state);
                await action.update({ components: [], embeds: [], content: 'Welcome log enabled.' });
            }
        });
    }
}
//# sourceMappingURL=setup-server-logs.js.map