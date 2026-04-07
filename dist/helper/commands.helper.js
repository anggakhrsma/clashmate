import { ApplicationCommandOptionType, ApplicationCommandType } from 'discord.js';
import locales from '../util/locales.js';
function flatOptions(options) {
    return (options?.map((option) => ({
        name: option.name,
        description: option.description,
        type: ApplicationCommandOptionType[option.type],
        choices: (option.choices || []).map((choice) => choice.name)
    })) ?? []);
}
function translateDescription(key) {
    const longKey = `command.${key}.description_long`;
    const value = getLocaleValue(longKey);
    if (typeof value === 'string')
        return value;
    return null;
}
function getTranslationKey(str) {
    return str.replace(/\s+/g, '.').replace(/-/g, '_');
}
function getLocaleValue(path) {
    return path.split('.').reduce((acc, part) => {
        if (acc && typeof acc === 'object') {
            return acc[part];
        }
        return undefined;
    }, locales);
}
export async function flattenApplicationCommands(items) {
    const commands = items
        .filter((command) => command.type === ApplicationCommandType.ChatInput)
        .map((command) => {
        const subCommandGroups = (command.options ?? [])
            .filter((option) => [
            ApplicationCommandOptionType.SubcommandGroup,
            ApplicationCommandOptionType.Subcommand
        ].includes(option.type))
            .flatMap((option) => {
            // SUB_COMMAND GROUP
            if (option.type === ApplicationCommandOptionType.SubcommandGroup &&
                option.options?.length) {
                return option.options.map((subOption) => {
                    const translationKey = getTranslationKey(`${command.name} ${option.name} ${subOption.name}`);
                    return {
                        id: command.id,
                        name: `/${command.name} ${option.name} ${subOption.name}`,
                        rootName: command.name,
                        mappedId: `${command.name}-${option.name}-${subOption.name}`,
                        translationKey,
                        formatted: `</${command.name} ${option.name} ${subOption.name}:${command.id}>`,
                        description: subOption.description,
                        description_long: translateDescription(translationKey),
                        options: flatOptions(subOption.options)
                    };
                });
            }
            // SUB_COMMAND
            const translationKey = getTranslationKey(`${command.name} ${option.name}`);
            return {
                id: command.id,
                name: `/${command.name} ${option.name}`,
                rootName: command.name,
                mappedId: `${command.name}-${option.name}`,
                translationKey,
                formatted: `</${command.name} ${option.name}:${command.id}>`,
                description: option.description,
                description_long: translateDescription(translationKey),
                options: flatOptions(option.options)
            };
        });
        if (subCommandGroups.length)
            return [...subCommandGroups];
        // ROOT COMMAND
        const translationKey = getTranslationKey(command.name);
        return [
            {
                id: command.id,
                name: `/${command.name}`,
                rootName: command.name,
                mappedId: command.name,
                translationKey,
                description_long: translateDescription(translationKey),
                formatted: `</${command.name}:${command.id}>`,
                description: command.description,
                options: flatOptions(command.options)
            }
        ];
    });
    return commands.flat();
}
//# sourceMappingURL=commands.helper.js.map