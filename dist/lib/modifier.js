import { CommandInteraction, ContextMenuCommandInteraction, MessageComponentInteraction, MessageFlags, ModalSubmitInteraction, PermissionFlagsBits } from 'discord.js';
// This code modifies the behavior of interaction replies.
// It checks if an interaction should be ephemeral based on the permissions and context.
function isEphemeral(interaction) {
    if (!interaction.inGuild())
        return false;
    if (!interaction.inCachedGuild())
        return true;
    if (interaction.channel?.isThread()) {
        return !interaction.appPermissions.has([PermissionFlagsBits.SendMessagesInThreads]);
    }
    return !interaction.appPermissions.has([
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ViewChannel
    ]);
}
for (const Interaction of [
    CommandInteraction,
    ContextMenuCommandInteraction,
    MessageComponentInteraction,
    ModalSubmitInteraction
]) {
    const _deferReply = Interaction.prototype.deferReply;
    const _followUp = Interaction.prototype.followUp;
    const _reply = Interaction.prototype.reply;
    const _editReply = Interaction.prototype.editReply;
    Object.defineProperties(Interaction.prototype, {
        reply: {
            value: function reply(record) {
                if (isEphemeral(this))
                    record.flags = MessageFlags.Ephemeral;
                return _reply.call(this, record);
            }
        },
        deferReply: {
            value: function deferReply(record) {
                if (isEphemeral(this))
                    record.flags = MessageFlags.Ephemeral;
                return _deferReply.call(this, record);
            }
        },
        followUp: {
            value: function followUp(record) {
                if (isEphemeral(this))
                    record.flags = MessageFlags.Ephemeral;
                return _followUp.call(this, record);
            }
        },
        editReply: {
            value: function editReply(record) {
                if (record.withComponents) {
                    record.flags = MessageFlags.IsComponentsV2;
                    record.embeds = [];
                    record.content = null;
                }
                return _editReply.call(this, record);
            }
        }
    });
}
//# sourceMappingURL=modifier.js.map