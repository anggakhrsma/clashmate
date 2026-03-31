import { ApplicationCommandOptionType, Collection, Events, MessageFlags, TextDisplayBuilder } from 'discord.js';
import EventEmitter from 'node:events';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import readdirp from 'readdirp';
import { container } from 'tsyringe';
import { Client } from '../struct/client.js';
import { i18n } from '../util/i18n.js';
import './modifier.js';
import { BuiltInReasons, CommandHandlerEvents, resolveColorCode } from './util.js';
const deferredDisallowed = ['link-add'];
const deletedCommands = {
    layout: 'layout-post'
};
class BaseHandler extends EventEmitter {
    constructor(client, { directory }) {
        super();
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
        Object.defineProperty(this, "directory", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "modules", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.directory = directory;
        this.modules = new Collection();
    }
    async register() {
        for await (const dir of readdirp(this.directory, {
            fileFilter: ({ basename }) => basename.endsWith('.js')
        })) {
            if (extname(dir.path) !== '.js')
                continue;
            const imported = await import(pathToFileURL(dir.fullPath).href);
            if (!imported.default) {
                this.client.logger.error(`Command file has no default export: ${dir.fullPath}`, {
                    label: 'STARTUP'
                });
                continue;
            }
            const mod = container.resolve(imported.default);
            this.construct(mod);
        }
    }
    construct(mod) {
        if (this.modules.has(mod.id)) {
            throw new Error(`Module "${mod.id}" already exists.`);
        }
        this.modules.set(mod.id, mod);
    }
}
export class CommandHandler extends BaseHandler {
    constructor(client, { directory }) {
        super(client, { directory });
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
        Object.defineProperty(this, "aliases", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        container.register(CommandHandler, { useValue: this });
        this.aliases = new Collection();
        client.on(Events.InteractionCreate, (interaction) => {
            if (interaction.isChatInputCommand()) {
                return this.handleInteraction(interaction);
            }
            if (interaction.isContextMenuCommand()) {
                return this.handleContextInteraction(interaction);
            }
            if (interaction.isMessageComponent()) {
                return this.handleComponentInteraction(interaction);
            }
        });
    }
    construct(command) {
        super.construct(command);
        const aliases = new Set([command.id, ...(command.aliases ?? [])]);
        for (const alias of aliases) {
            if (this.aliases.has(alias)) {
                throw new Error(`Command "${command.id}" already exists.`);
            }
            this.aliases.set(alias, command.id);
        }
    }
    async handleComponentInteraction(interaction) {
        const userIds = this.client.components.get(interaction.customId);
        if (userIds?.length && userIds.includes(interaction.user.id))
            return;
        if (interaction.isButton() &&
            interaction.inCachedGuild() &&
            interaction.customId.startsWith('action-')) {
            const [action, ...userIds] = interaction.customId.split(':');
            const isAuthorized = userIds.includes(interaction.user.id) || this.client.util.isManager(interaction.member);
            await interaction.deferUpdate();
            if (action === 'action-consume' && isAuthorized) {
                return interaction.editReply({ components: [] });
            }
            if (action === 'action-delete' && isAuthorized) {
                return interaction.deleteReply();
            }
        }
        if (userIds?.length && !userIds.includes(interaction.user.id)) {
            return interaction.reply({
                content: i18n('common.component.unauthorized', { lng: interaction.locale }),
                flags: MessageFlags.Ephemeral
            });
        }
        let parsed = { cmd: '', users: [] };
        try {
            const raw = interaction.customId;
            // First check our payload store (from createId)
            const stored = this.client._componentPayloads?.get(raw);
            if (stored) {
                parsed = stored;
            }
            else if (raw.startsWith('{')) {
                parsed = JSON.parse(raw);
            }
            else {
                const [cmd, ...rest] = raw.split(':');
                const users = this.client.components.get(raw) ?? (rest.length ? rest : []);
                parsed = { cmd, users };
            }
        }
        catch {
            parsed = { cmd: interaction.customId, users: [] };
        }
        const command = parsed && this.getCommand(deletedCommands[parsed.cmd] || parsed.cmd);
        if (!command) {
            //
            const isEmpty = !(interaction.message.attachments.size ||
                interaction.message.embeds.length ||
                interaction.message.content.length ||
                interaction.message.stickers.size);
            const content = i18n('common.component.expired', { lng: interaction.locale });
            if (interaction.message.flags.has(MessageFlags.IsComponentsV2)) {
                return interaction.update({ components: [new TextDisplayBuilder({ content })] });
            }
            if (isEmpty) {
                return interaction.update({ components: [], content });
            }
            await interaction.update({ components: [] });
            return interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        }
        if (!interaction.inCachedGuild() && command.channel !== 'dm')
            return true;
        if (interaction.inCachedGuild() && !interaction.channel)
            return true;
        // if (this.preInhibitor(interaction, command, { commandName: parsed.cmd })) return;
        if (parsed.is_locked &&
            interaction.message.interactionMetadata &&
            interaction.message.interactionMetadata?.user.id !== interaction.user.id) {
            await interaction.reply({
                content: i18n('common.component.unauthorized', { lng: interaction.locale }),
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        const deferredDisabled = parsed.hasOwnProperty('defer') && !parsed.defer;
        if (!deferredDisallowed.includes(parsed.cmd) && !deferredDisabled) {
            if (parsed.ephemeral) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            }
            else {
                await interaction.deferUpdate();
            }
        }
        if (parsed.user_id) {
            parsed.user = await this.client.users.fetch(parsed.user_id).catch(() => null);
        }
        function resolveMenu(interaction, parsed) {
            const values = interaction.values;
            if (parsed.array_key)
                return { [parsed.array_key]: values };
            if (parsed.string_key)
                return { [parsed.string_key]: values.at(0) };
            return { selected: values };
        }
        const selected = interaction.isStringSelectMenu() ? resolveMenu(interaction, parsed) : {};
        return this.exec(interaction, command, { ...parsed, ...selected });
    }
    handleInteraction(interaction) {
        let command = this.getCommand(interaction.commandName);
        if (!command) {
            const rawArgs = this.rawArgs(interaction);
            command = this.getCommand(rawArgs.commandName);
        }
        if (!command)
            return;
        const args = this.argumentRunner(interaction, command);
        if (this.preInhibitor(interaction, command, args))
            return;
        return this.exec(interaction, command, args);
    }
    async handleContextInteraction(interaction) {
        const command = this.getCommand(interaction.commandName);
        if (!command)
            return;
        const args = {};
        if (interaction.isMessageContextMenuCommand()) {
            const message = interaction.options.getMessage('message');
            if (message) {
                args.message = message.content;
                args.url = message.url;
            }
        }
        else {
            const user = interaction.options.getUser('user');
            if (user)
                args.user = user;
        }
        if (this.preInhibitor(interaction, command, args))
            return;
        return this.exec(interaction, command, args);
    }
    getCommand(commandName) {
        const alias = this.aliases.get(commandName);
        if (!alias)
            return null;
        const command = this.modules.get(alias);
        if (!command)
            return null;
        if (command) {
            command.resolvedId = alias;
            command.options.resolvedId = alias;
        }
        return command;
    }
    transformInteraction(options, result = {}) {
        for (const option of options) {
            if ([ApplicationCommandOptionType.SubcommandGroup].includes(option.type)) {
                result.subCommand = option;
                return this.transformInteraction([...(option.options ?? [])], result);
            }
            if ([ApplicationCommandOptionType.Subcommand].includes(option.type)) {
                result.command = option;
                return this.transformInteraction([...(option.options ?? [])], result);
            }
            result[option.name] = option;
        }
        return result;
    }
    rawArgs(interaction) {
        const resolved = {};
        for (const [name, option] of Object.entries(this.transformInteraction(interaction.options.data))) {
            const key = name.toString();
            if ([
                ApplicationCommandOptionType.Subcommand,
                ApplicationCommandOptionType.SubcommandGroup
            ].includes(option.type)) {
                resolved[key] = option.name;
            }
            else if (option.type === ApplicationCommandOptionType.Channel) {
                resolved[key] = option.channel?.isTextBased()
                    ? option.channel
                    : null;
            }
            else if (option.type === ApplicationCommandOptionType.Role) {
                resolved[key] = option.role ?? null;
            }
            else if (option.type === ApplicationCommandOptionType.User) {
                resolved[key] = option.user ?? null;
            }
            else if (option.type === ApplicationCommandOptionType.Mentionable) {
                resolved[key] = option.user ?? option.role ?? null;
            }
            else if (option.type === ApplicationCommandOptionType.Attachment) {
                resolved[key] = option.attachment?.url ?? null;
            }
            else {
                resolved[key] = option.value ?? null;
            }
            if (resolved[key] &&
                (typeof resolved[key] === 'boolean' || ['true', 'false'].includes(resolved[key]))) {
                resolved[key] = resolved[key] === 'true' || resolved[key] === true;
            }
            if (resolved[key] && name === 'color') {
                resolved[key] = resolveColorCode(resolved[key]);
            }
        }
        const subCommandGroup = resolved.subCommand ? `-${resolved.subCommand}` : '';
        const subCommand = resolved.command ? `-${resolved.command}` : '';
        resolved.commandName = `${interaction.commandName}${subCommandGroup}${subCommand}`;
        return resolved;
    }
    argumentRunner(interaction, command) {
        const args = command.args(interaction);
        const resolved = {};
        for (const [name, option] of Object.entries(this.transformInteraction(interaction.options.data))) {
            const key = (args[name]?.id ?? name).toString(); // KEY_OVERRIDE
            if ([
                ApplicationCommandOptionType.Subcommand,
                ApplicationCommandOptionType.SubcommandGroup
            ].includes(option.type)) {
                resolved[key] = option.name; // SUB_COMMAND OR SUB_COMMAND_GROUP
            }
            else if (option.type === ApplicationCommandOptionType.Channel) {
                resolved[key] = option.channel?.isTextBased()
                    ? option.channel
                    : null;
            }
            else if (option.type === ApplicationCommandOptionType.Role) {
                resolved[key] = option.role ?? null;
            }
            else if (option.type === ApplicationCommandOptionType.Mentionable) {
                resolved[key] = option.user ?? option.role ?? null;
            }
            else if (option.type === ApplicationCommandOptionType.User) {
                resolved[key] =
                    args[name]?.match === 'MEMBER' ? (option.member ?? null) : (option.user ?? null);
            }
            else if (option.type === ApplicationCommandOptionType.Attachment) {
                resolved[key] = option.attachment?.url ?? null;
            }
            else {
                resolved[key] = option.value ?? null;
            }
            if (resolved[key] &&
                (args[name]?.match === 'BOOLEAN' || resolved[key] === 'true' || resolved[key] === 'false')) {
                resolved[key] = typeof resolved[key] === 'boolean' || resolved[key] === 'true';
            }
            if (resolved[key] && args[name]?.match === 'COLOR') {
                resolved[key] = resolveColorCode(resolved[key]);
            }
            if (resolved[key] && args[name]?.match === 'ENUM') {
                const value = resolved[key];
                const flatten = args[name]?.enums?.find((text) => Array.isArray(text) ? text.includes(value) : text === value);
                resolved[key] = flatten ? (Array.isArray(flatten) ? flatten.at(0) : flatten) : null;
            }
            if (!resolved[key] && args[name]?.default) {
                const def = args[name]?.default;
                resolved[key] = typeof def === 'function' ? def(resolved[key]) : def;
            }
        }
        for (const [name, option] of Object.entries(args)) {
            const key = (option?.id ?? name).toString(); // KEY_OVERRIDE
            if (key in resolved)
                continue;
            if (option?.default) {
                const def = option.default;
                resolved[key] = typeof def === 'function' ? def(resolved[key]) : def;
            }
        }
        const subCommandGroup = resolved.subCommand ? `-${resolved.subCommand}` : '';
        const subCommand = resolved.command ? `-${resolved.command}` : '';
        resolved.commandName = `${interaction.commandName}${subCommandGroup}${subCommand}`;
        return resolved;
    }
    /** This method should only be used with CommandInteraction */
    continue(interaction, command) {
        const args = this.argumentRunner(interaction, command);
        if (this.preInhibitor(interaction, command, args))
            return;
        return this.exec(interaction, command, args);
    }
    async exec(interaction, command, args = {}) {
        try {
            const options = command.refine(interaction, args);
            const deferred = options.defer && !interaction.deferred && !interaction.replied;
            if (deferred) {
                await interaction.deferReply(options.ephemeral ? { flags: MessageFlags.Ephemeral } : {});
            }
            this.emit(CommandHandlerEvents.COMMAND_STARTED, interaction, command, args);
            await command.exec(interaction, args);
        }
        catch (error) {
            this.emit(CommandHandlerEvents.ERROR, error, interaction, command);
        }
        finally {
            this.emit(CommandHandlerEvents.COMMAND_ENDED, interaction, command, args);
        }
    }
    preInhibitor(interaction, command, args) {
        const options = command.refine(interaction, args);
        const reason = this.client.inhibitorHandler.run(interaction, command);
        if (reason) {
            this.emit(CommandHandlerEvents.COMMAND_BLOCKED, interaction, command, reason);
            return true;
        }
        const isOwner = this.client.isOwner(interaction.user);
        if (options.ownerOnly && !isOwner) {
            this.emit(CommandHandlerEvents.COMMAND_BLOCKED, interaction, command, BuiltInReasons.OWNER);
            return true;
        }
        if (options.channel === 'guild' && !interaction.guild) {
            this.emit(CommandHandlerEvents.COMMAND_BLOCKED, interaction, command, BuiltInReasons.GUILD);
            return true;
        }
        // if (options.channel === 'dm' && interaction.guild) {
        // 	this.emit(CommandHandlerEvents.COMMAND_BLOCKED, interaction, command, BuiltInReasons.DM);
        // 	return true;
        // }
        return this.runPermissionChecks(interaction, command, options);
    }
    runPermissionChecks(interaction, command, options) {
        if (!interaction.inCachedGuild())
            return false;
        if (options.clientPermissions?.length) {
            const missing = interaction.appPermissions.missing(options.clientPermissions);
            if (missing.length) {
                this.emit(CommandHandlerEvents.MISSING_PERMISSIONS, interaction, command, BuiltInReasons.CLIENT, missing);
                return true;
            }
        }
        const [isValidWhitelist, isWhitelisted] = this.checkWhitelist(interaction, options);
        if (isValidWhitelist && isWhitelisted)
            return false;
        const isManager = this.client.util.isManager(interaction.member, options.roleKey);
        if (!isManager && options.userPermissions?.length) {
            const missing = interaction.channel
                ?.permissionsFor(interaction.user)
                ?.missing(options.userPermissions);
            if (missing?.length) {
                this.emit(CommandHandlerEvents.MISSING_PERMISSIONS, interaction, command, BuiltInReasons.USER, missing);
                return true;
            }
        }
        if (isManager)
            return false;
        if (isValidWhitelist && !isWhitelisted) {
            this.emit(CommandHandlerEvents.COMMAND_BLOCKED, interaction, command, BuiltInReasons.WHITELIST);
            return true;
        }
        return false;
    }
    checkWhitelist(interaction, options) {
        if (!interaction.inCachedGuild())
            return [false, false];
        if (!interaction.isCommand())
            return [false, false];
        if (!options.resolvedId)
            return [false, false];
        const commandWhitelist = this.client.settings.get(interaction.guild, "commandWhitelist" /* Settings.COMMAND_WHITELIST */, []);
        if (!commandWhitelist.length)
            return [false, false];
        const whitelisted = commandWhitelist.filter((whitelist) => whitelist.commandId === options.resolvedId);
        if (!whitelisted.length)
            return [false, false];
        const authorized = whitelisted.find(({ userOrRoleId }) => {
            return (interaction.member.roles.cache.has(userOrRoleId) || interaction.user.id === userOrRoleId);
        });
        return [true, !!authorized];
    }
}
export class ListenerHandler extends BaseHandler {
    constructor(client, { directory }) {
        super(client, { directory });
        Object.defineProperty(this, "emitters", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.emitters = new Collection();
        container.register(ListenerHandler, { useValue: this });
    }
    construct(listener) {
        super.construct(listener);
        return this.addToEmitter(listener.id);
    }
    addToEmitter(name) {
        const listener = this.modules.get(name);
        const emitter = {
            client: this.client,
            commandHandler: this.client.commandHandler,
            rest: this.client.rest,
            ws: this.client.ws
        }[listener.emitter];
        if (!emitter)
            return;
        if (listener.once) {
            emitter.once(listener.event, listener.exec.bind(listener));
        }
        else {
            emitter.on(listener.event, listener.exec.bind(listener));
        }
    }
}
export class InhibitorHandler extends BaseHandler {
    constructor(client, { directory }) {
        super(client, { directory });
        container.register(InhibitorHandler, { useValue: this });
    }
    run(interaction, command) {
        try {
            const inhibitor = this.modules
                .sort((a, b) => b.priority - a.priority)
                .filter((inhibitor) => !inhibitor.disabled && inhibitor.exec(interaction, command))
                .at(0);
            return inhibitor?.reason ?? null;
        }
        catch (error) {
            this.emit(CommandHandlerEvents.ERROR, error, interaction, command);
        }
        return null;
    }
}
export class Command {
    constructor(id, options) {
        Object.defineProperty(this, "id", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "aliases", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "category", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "ephemeral", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "ownerOnly", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "channel", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "defer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "userPermissions", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "clientPermissions", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "roleKey", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "resolvedId", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "handler", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "i18n", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: i18n
        });
        Object.defineProperty(this, "options", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        const { defer, aliases, ephemeral, userPermissions, clientPermissions, channel, ownerOnly, category, roleKey } = options;
        this.id = id;
        this.aliases = aliases;
        this.defer = defer;
        this.ephemeral = ephemeral;
        this.userPermissions = userPermissions;
        this.clientPermissions = clientPermissions;
        this.roleKey = roleKey;
        this.channel = channel;
        this.ownerOnly = ownerOnly;
        this.category = category ?? 'default';
        this.client = container.resolve(Client);
        this.handler = container.resolve(CommandHandler);
        this.options = options;
    }
    autocomplete() {
        return null;
    }
    refine() {
        return this.options;
    }
    args() {
        return {};
    }
    exec() {
        throw Error('This method needs to be overwritten inside of an actual command.');
    }
    run() {
        return null;
    }
    createId(payload) {
        const key = this.client.uuid(...(payload.users ?? []));
        // Store the full payload so handleComponentInteraction can decode it
        this.client.components.set(key, payload.users ?? []);
        this.client._componentPayloads ??= new Map();
        this.client._componentPayloads.set(key, payload);
        return key;
    }
}
export class Listener {
    constructor(id, { emitter, event, once }) {
        Object.defineProperty(this, "id", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "emitter", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "category", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "event", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "once", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "handler", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "i18n", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: i18n
        });
        this.id = id;
        this.event = event;
        this.once = once;
        this.emitter = emitter;
        this.client = container.resolve(Client);
        this.handler = container.resolve(ListenerHandler);
    }
    exec() {
        throw Error('This method needs to be overwritten inside of an actual listener.');
    }
}
export class Inhibitor {
    constructor(id, { category, priority, reason, disabled }) {
        Object.defineProperty(this, "id", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "reason", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "category", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "priority", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "handler", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "disabled", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "i18n", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: i18n
        });
        this.id = id;
        this.reason = reason;
        this.category = category;
        this.priority = priority ?? 0;
        this.disabled = disabled ?? false;
        this.client = container.resolve(Client);
        this.handler = container.resolve(InhibitorHandler);
    }
    exec() {
        throw Error('This method needs to be overwritten inside of an actual inhibitor.');
    }
}
//# sourceMappingURL=handlers.js.map