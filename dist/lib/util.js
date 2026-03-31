import { resolveColor } from 'discord.js';
export const CommandHandlerEvents = {
    COMMAND_ENDED: 'commandEnded',
    COMMAND_STARTED: 'commandStarted',
    ERROR: 'error',
    COMMAND_INVALID: 'commandInvalid',
    COMMAND_DISABLED: 'commandDisabled',
    COMMAND_BLOCKED: 'commandBlocked',
    MISSING_PERMISSIONS: 'missingPermissions'
};
const WSEventTypes = {
    GUILD_MEMBER_UPDATE: 'GUILD_MEMBER_UPDATE',
    RATE_LIMITED: 'RATE_LIMITED'
};
export var BuiltInReasons;
(function (BuiltInReasons) {
    BuiltInReasons["DM"] = "dm";
    BuiltInReasons["USER"] = "user";
    BuiltInReasons["WHITELIST"] = "whitelist";
    BuiltInReasons["GUILD"] = "guild";
    BuiltInReasons["CHANNEL"] = "channel";
    BuiltInReasons["CLIENT"] = "client";
    BuiltInReasons["OWNER"] = "owner";
})(BuiltInReasons || (BuiltInReasons = {}));
export const resolveColorCode = (hex) => {
    try {
        return resolveColor(hex);
    }
    catch {
        return null;
    }
};
//# sourceMappingURL=util.js.map