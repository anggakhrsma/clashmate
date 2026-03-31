import { nanoid } from 'nanoid';
import { sift, unique } from 'radash';
import { COUNTRIES } from '../util/countries.js';
import { Util } from '../util/toolkit.js';
export class Autocomplete {
    constructor(client) {
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
    }
    handle(interaction) {
        const args = this.client.commandHandler.rawArgs(interaction);
        return this.exec(interaction, args);
    }
    exec(interaction, args) {
        const command = this.client.commandHandler.getCommand(args.commandName);
        if (!command)
            return null;
        return command.autocomplete(interaction, args);
    }
    async commandsAutocomplete(interaction, focused) {
        const query = interaction.options.getString(focused)?.trim();
        const commands = this.client.commands
            .entries()
            .map((cmd) => ({ name: cmd, value: cmd.replace(/^\//, '').replace(/\s+/g, '-') }));
        if (!query) {
            const choices = commands.slice(0, 25);
            return interaction.respond(choices);
        }
        const choices = commands.filter(({ name }) => name.includes(query)).slice(0, 25);
        if (!choices.length)
            return interaction.respond([{ name: 'No commands found.', value: '0' }]);
        return interaction.respond(choices);
    }
    async locationAutocomplete(interaction, query) {
        if (!query) {
            return interaction.respond(COUNTRIES.slice(0, 25).map((country) => ({
                name: country.name,
                value: country.countryCode
            })));
        }
        const countries = COUNTRIES.filter((country) => country.name.toLowerCase().includes(query.toLowerCase())).slice(0, 25);
        if (!countries.length)
            return interaction.respond([{ name: 'No countries found.', value: '0' }]);
        return interaction.respond(countries.map((country) => ({ name: country.name, value: country.countryCode })));
    }
    async startOrEndDateAutocomplete(interaction, focused) {
        let query = interaction.options.getString(focused)?.trim();
        if (!query) {
            const ids = Util.getSeasonIds().slice(0, 12);
            return interaction.respond(ids.map((id) => ({ name: id, value: id })));
        }
        query = query.slice(0, 100).trim();
        return interaction.respond([{ name: query, value: query }]);
    }
    async flagSearchAutoComplete(interaction, args) {
        const filter = {
            guild: interaction.guild.id,
            $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
        };
        if (args.flag_type)
            filter.flagType = args.flag_type;
        const subCommand = interaction.options.getSubcommand(false);
        if (args.player === '*' && subCommand === 'delete') {
            return interaction.respond([{ name: 'All Flags', value: '*' }]);
        }
        if (args.player) {
            const text = args.player.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (this.client.coc.isValidTag(text)) {
                filter.$or = [
                    { tag: this.client.coc.fixTag(text) },
                    { name: { $regex: `.*${text}.*`, $options: 'i' } }
                ];
            }
            else {
                filter.name = { $regex: `.*${text}.*`, $options: 'i' };
            }
        }
        const cursor = this.client.db.collection("Flags" /* Collections.FLAGS */).find(filter);
        if (!args.player)
            cursor.sort({ _id: -1 });
        const flags = await cursor.limit(24).toArray();
        const players = unique(flags, (flag) => flag.tag);
        const choices = players.map((flag) => ({
            name: `${flag.name} (${flag.tag})`,
            value: flag.tag
        }));
        if (subCommand === 'delete')
            choices.unshift({ name: 'All Flags', value: '*' });
        return interaction.respond(choices);
    }
    async clanCategoriesAutoComplete(interaction) {
        const categories = await this.client.storage.getOrCreateDefaultCategories(interaction.guildId);
        return interaction.respond(categories.slice(0, 25));
    }
    async globalPlayersAutocomplete(interaction, args) {
        const clans = await this.client.storage.find(interaction.guildId);
        const query = {
            'clan.tag': { $in: clans.map((clan) => clan.tag) }
        };
        if (args.player) {
            const text = args.player.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            query.$or = [
                { name: { $regex: `.*${text}.*`, $options: 'i' } },
                { tag: { $regex: `.*${text}.*`, $options: 'i' } }
            ];
        }
        const cursor = this.client.db
            .collection("Players" /* Collections.PLAYERS */)
            .find(query, { projection: { name: 1, tag: 1 } });
        if (!args.player)
            cursor.sort({ lastSeen: -1 });
        const players = await cursor.limit(24).toArray();
        if (!players.length && args.player) {
            const text = args.player.slice(0, 100).trim();
            return interaction.respond([{ name: text, value: text }]);
        }
        if (!players.length)
            return interaction.respond([{ name: 'No players found.', value: '0' }]);
        const choices = players.map((player) => ({
            name: `${player.name} (${player.tag})`,
            value: player.tag
        }));
        return interaction.respond(choices);
    }
    async clanAutoComplete(interaction, { withCategory, isMulti }) {
        const [clans, userClans] = await Promise.all([
            this.client.storage.find(interaction.guildId),
            this.getUserLinkedClan(interaction.user.id)
        ]);
        const choices = unique([...userClans, ...clans].map((clan) => ({
            value: clan.tag,
            name: `${clan.name} (${clan.tag})`
        })), (e) => e.value);
        if (withCategory) {
            const categoryIds = sift(clans.map((clan) => clan.categoryId));
            const categories = await this.client.db
                .collection("ClanCategories" /* Collections.CLAN_CATEGORIES */)
                .find({ guildId: interaction.guildId, _id: { $in: categoryIds } }, { sort: { order: 1 }, limit: 10 })
                .toArray();
            if (categories.length) {
                choices.unshift(...categories.map((category) => ({
                    value: `CATEGORY:${interaction.guildId}:${category._id.toHexString()}`,
                    name: `${category.displayName} (Category)`
                })));
            }
        }
        if (!choices.length)
            return interaction.respond([{ name: 'Enter a clan tag.', value: '0' }]);
        if (isMulti) {
            choices.unshift({ value: '*', name: `All of these (${clans.length})` });
        }
        return interaction.respond(choices.slice(0, 25));
    }
    async generateArgs(query) {
        query = query.trim();
        if (query.length > 100) {
            const key = `ARGS:${nanoid()}`;
            this.client.components.set(key, [query]); // in-memory, expires on restart
            return key;
        }
        return query;
    }
    async getUserLinkedClan(userId) {
        const user = await this.client.db.collection("Users" /* Collections.USERS */).findOne({ userId });
        if (!user?.clan)
            return [];
        return [{ name: user.clan.name ?? 'Unknown', tag: user.clan.tag }];
    }
}
//# sourceMappingURL=autocomplete-client.js.map