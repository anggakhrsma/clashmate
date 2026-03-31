import { ESCAPE_CHAR_REGEX } from '../../util/constants.js';
import moment from 'moment';
import 'moment-duration-format';
import ms from 'ms';
import { CAPITAL_RAID_REMINDERS_AUTOCOMPLETE, CLAN_GAMES_REMINDERS_AUTOCOMPLETE, DEFAULT_REMINDERS_AUTOCOMPLETE, WAR_REMINDERS_AUTOCOMPLETE } from '../../helper/reminders.helper.js';
import { Listener } from '../../lib/handlers.js';
import Google from '../../struct/google.js';
import { rosterLabel } from '../../struct/roster-manager.js';
const ranges = {
    'clan-wars': ms('46h'),
    'capital-raids': ms('3d'),
    'clan-games': ms('5d') + ms('23h'),
    'default': ms('5d') + ms('23h')
};
export default class AutocompleteInteractionListener extends Listener {
    constructor() {
        super('autocomplete-interaction', {
            emitter: 'client',
            category: 'client',
            event: 'interactionCreate'
        });
    }
    exec(interaction) {
        if (interaction.isAutocomplete()) {
            return this.autocomplete(interaction);
        }
    }
    inRange(dur, cmd) {
        const minDur = ms('15m');
        const maxDur = ranges[cmd ?? 'default'];
        return dur >= minDur && dur <= maxDur;
    }
    getLabel(dur) {
        return moment.duration(dur).format('d[d] h[h] m[m]', { trim: 'both mid' });
    }
    getTimes(times, matchedDur, cmd) {
        if (this.inRange(matchedDur, cmd)) {
            const value = this.getLabel(matchedDur);
            if (times.includes(value))
                times.splice(times.indexOf(value), 1);
            times.unshift(value);
        }
        return times.map((value) => ({ value, name: value }));
    }
    async autocomplete(interaction) {
        const { name: focused } = interaction.options.getFocused(true);
        if (['player', 'units', 'upgrades', 'rushed', 'legends'].includes(interaction.commandName) &&
            ['player_tag', 'tag', 'player'].includes(focused)) {
            return this.playerTagAutocomplete(interaction, focused);
        }
        if (!interaction.inCachedGuild())
            return null;
        switch (focused) {
            case 'duration':
                return this.durationAutocomplete(interaction, focused);
            case 'end_date':
            case 'start_date':
                return this.client.autocomplete.startOrEndDateAutocomplete(interaction, focused);
            case 'clans':
                if (interaction.commandName === 'activity' && !interaction.options.getString(focused)) {
                    return this.client.autocomplete.clanAutoComplete(interaction, {
                        withCategory: true,
                        isMulti: true
                    });
                }
                return this.clansAutocomplete(interaction, focused);
            case 'category':
                return this.client.autocomplete.clanCategoriesAutoComplete(interaction);
            case 'tag':
                if (['player', 'units', 'upgrades', 'rushed', 'verify'].includes(interaction.commandName)) {
                    return this.playerTagAutocomplete(interaction, focused);
                }
                return this.clanTagAutocomplete(interaction, focused);
            case 'player':
            case 'by_player_tag':
            case 'player_tag': {
                const subCommand = interaction.options.getSubcommand(false);
                if (interaction.commandName === 'roster' && subCommand === 'manage') {
                    return this.client.autocomplete.handle(interaction);
                }
                if (interaction.commandName === 'flag' &&
                    subCommand &&
                    ['delete', 'create', 'list'].includes(subCommand)) {
                    return this.client.autocomplete.handle(interaction);
                }
                return this.playerTagAutocomplete(interaction, focused);
            }
            case 'flag_ref':
                return this.client.autocomplete.handle(interaction);
            case 'from_current_wars':
            case 'from_clan':
            case 'clan_tag':
            case 'clan':
                return this.clanTagAutocomplete(interaction, focused);
            case 'alias':
                return this.aliasAutoComplete(interaction, focused);
            case 'target_roster':
            case 'roster': {
                const subCommand = interaction.options.getSubcommand(false);
                if (interaction.commandName === 'roster' &&
                    subCommand === 'manage' &&
                    focused === 'target_roster') {
                    return this.client.autocomplete.handle(interaction);
                }
                return this.rosterAutocomplete(interaction, focused, subCommand === 'edit');
            }
            case 'target_group':
            case 'group': {
                const subCommand = interaction.options.getSubcommand(false);
                if (interaction.commandName === 'roster' &&
                    subCommand === 'manage' &&
                    focused === 'target_group') {
                    return this.client.autocomplete.handle(interaction);
                }
                return this.rosterCategoryAutocomplete(interaction, focused);
            }
            case 'timezone':
                return this.timezoneAutocomplete(interaction, focused);
            case 'command':
                return this.client.autocomplete.commandsAutocomplete(interaction, focused);
            case 'location':
                return this.client.autocomplete.locationAutocomplete(interaction, interaction.options.getString(focused) ?? undefined);
        }
    }
    /** MongoDB-backed player tag autocomplete (replaces Elasticsearch). */
    async playerTagAutocomplete(interaction, focused) {
        const query = interaction.options.getString(focused)?.trim()?.slice(0, 500) ?? '';
        const userId = interaction.user.id;
        const text = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const linkedPlayers = await this.client.db
            .collection("PlayerLinks" /* Collections.PLAYER_LINKS */)
            .find(query
            ? {
                userId,
                $or: [
                    { name: { $regex: text, $options: 'i' } },
                    { tag: { $regex: text, $options: 'i' } }
                ]
            }
            : { userId })
            .sort({ order: 1 })
            .limit(25)
            .toArray();
        const recentPlayers = await this.client.db
            .collection("Users" /* Collections.USERS */)
            .findOne({ userId }, { projection: { lastSearchedPlayerTag: 1 } });
        const players = linkedPlayers.slice(0, 25);
        if (!players.length) {
            if (query && this.isValidQuery(query)) {
                return interaction.respond([{ value: query, name: query.slice(0, 100) }]);
            }
            if (recentPlayers?.lastSearchedPlayerTag) {
                return interaction.respond([
                    { value: recentPlayers.lastSearchedPlayerTag, name: recentPlayers.lastSearchedPlayerTag }
                ]);
            }
            return interaction.respond([{ value: '0', name: 'Enter a player tag!' }]);
        }
        return interaction.respond(players.map((p) => ({ value: p.tag, name: `${p.name ?? p.tag} (${p.tag})` })));
    }
    /** MongoDB-backed clan tag autocomplete (replaces Elasticsearch). */
    async clanTagAutocomplete(interaction, focused) {
        const query = interaction.options.getString(focused)?.trim()?.slice(0, 500) ?? '';
        if (!query) {
            return this.client.autocomplete.clanAutoComplete(interaction, {
                withCategory: false,
                isMulti: false
            });
        }
        const text = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const clans = await this.client.db
            .collection("ClanStores" /* Collections.CLAN_STORES */)
            .find({
            guild: interaction.guild.id,
            $or: [
                { name: { $regex: text, $options: 'i' } },
                { tag: { $regex: text, $options: 'i' } },
                { alias: { $regex: text, $options: 'i' } }
            ]
        })
            .limit(25)
            .toArray();
        if (!clans.length) {
            if (this.isValidQuery(query)) {
                return interaction.respond([{ value: query, name: query.slice(0, 100) }]);
            }
            return interaction.respond([{ value: '0', name: 'Enter a clan tag!' }]);
        }
        return interaction.respond(clans.map((c) => ({ value: c.tag, name: `${c.name} (${c.tag})` })));
    }
    async clansAutocomplete(interaction, focused) {
        const query = interaction.options
            .getString(focused)
            ?.trim()
            ?.replace(/^\*$/, '')
            ?.slice(0, 500);
        if (!query) {
            return this.client.autocomplete.clanAutoComplete(interaction, {
                withCategory: false,
                isMulti: true
            });
        }
        const text = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const clans = await this.client.db
            .collection("ClanStores" /* Collections.CLAN_STORES */)
            .find({
            guild: interaction.guild.id,
            $or: [
                { name: { $regex: text, $options: 'i' } },
                { tag: { $regex: text, $options: 'i' } },
                { alias: { $regex: text, $options: 'i' } }
            ]
        })
            .limit(25)
            .toArray();
        if (!clans.length) {
            if (this.isValidQuery(query)) {
                return interaction.respond([{ value: query, name: query.slice(0, 100) }]);
            }
            return interaction.respond([{ value: '0', name: 'Enter clan tags or names!' }]);
        }
        const response = clans
            .slice(0, 24)
            .map((c) => ({ value: c.tag, name: `${c.name} (${c.tag})` }));
        if (clans.length > 1) {
            response.unshift({
                value: clans.map((c) => c.tag).join(','),
                name: `All of these (${clans.length})`
            });
        }
        return interaction.respond(response);
    }
    async timezoneAutocomplete(interaction, focused) {
        const query = interaction.options.getString(focused)?.trim();
        const text = query?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') ?? '';
        const collection = this.client.db.collection("Users" /* Collections.USERS */);
        const cursor = collection.aggregate([
            { $match: { timezone: { $exists: true } } },
            { $replaceRoot: { newRoot: '$timezone' } },
            { $group: { _id: '$id', timezone: { $first: '$$ROOT' }, uses: { $sum: 1 } } },
            { $sort: { uses: -1 } },
            ...(query
                ? [
                    {
                        $match: {
                            $or: [
                                { _id: { $regex: `.*${text}*.`, $options: 'i' } },
                                { 'timezone.name': { $regex: `.*${text}*.`, $options: 'i' } },
                                { 'timezone.location': { $regex: `.*${text}*.`, $options: 'i' } }
                            ]
                        }
                    }
                ]
                : []),
            { $limit: 24 }
        ]);
        const [user, result] = await Promise.all([
            collection.findOne({ userId: interaction.user.id }),
            cursor.toArray()
        ]);
        if (user?.timezone && !query)
            result.unshift({ _id: user.timezone.id, timezone: user.timezone });
        if (!result.length && query) {
            const raw = await Google.timezone(query);
            if (raw?.location && raw.timezone) {
                const offset = Number(raw.timezone.rawOffset) + Number(raw.timezone.dstOffset);
                result.push({
                    _id: raw.timezone.timeZoneId,
                    timezone: {
                        id: raw.timezone.timeZoneId,
                        offset,
                        name: raw.timezone.timeZoneName,
                        location: raw.location.formatted_address
                    }
                });
            }
        }
        const timezones = result.filter((tz, i, self) => self.findIndex((t) => t._id === tz._id) === i);
        if (!timezones.length)
            return interaction.respond([{ value: '0', name: 'No timezones found.' }]);
        return interaction.respond(timezones.map(({ timezone }) => ({
            value: timezone.id,
            name: `${moment.tz(new Date(), timezone.id).format('kk:mm')} - ${timezone.id}`
        })));
    }
    async rosterAutocomplete(interaction, focused, allowBulk) {
        const filter = { guildId: interaction.guild.id };
        const query = interaction.options.getString(focused)?.trim();
        if (query) {
            const text = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.name = { $regex: `.*${text}.*`, $options: 'i' };
        }
        const cursor = this.client.rosterManager.rosters.find(filter, { projection: { members: 0 } });
        if (!query)
            cursor.sort({ _id: -1 });
        const rosters = await cursor.limit(24).toArray();
        if (!rosters.length)
            return interaction.respond([{ value: '0', name: 'No rosters found.' }]);
        const options = rosters.map((roster) => ({
            value: roster._id.toHexString(),
            name: `${rosterLabel(roster)}`.slice(0, 100)
        }));
        if (allowBulk)
            options.unshift({ value: '*', name: 'All Rosters (Bulk Edit)' });
        return interaction.respond(options);
    }
    async rosterCategoryAutocomplete(interaction, focused) {
        const filter = { guildId: interaction.guild.id };
        const query = interaction.options.getString(focused)?.trim();
        if (query) {
            const text = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.displayName = { $regex: `.*${text}.*`, $options: 'i' };
        }
        const cursor = this.client.rosterManager.categories.find(filter);
        if (!query)
            cursor.sort({ _id: -1 });
        const categories = await cursor.limit(24).toArray();
        if (!categories.length)
            return interaction.respond([{ value: '0', name: 'No categories found.' }]);
        return interaction.respond(categories.map((cat) => ({
            value: cat._id.toHexString(),
            name: cat.displayName.slice(0, 100)
        })));
    }
    async aliasAutoComplete(interaction, focused) {
        const clans = await this.client.storage.find(interaction.guild.id);
        const query = interaction.options
            .getString(focused)
            ?.trim()
            ?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const aliases = clans
            .filter((clan) => clan.alias && (query ? new RegExp(`.*${query}.*`, 'i').test(clan.alias) : true))
            .slice(0, 24);
        if (!aliases.length)
            return interaction.respond([{ value: '0', name: 'No aliases found.' }]);
        return interaction.respond(aliases.map((clan) => ({ value: clan.alias, name: `${clan.alias} - ${clan.name}` })));
    }
    async durationAutocomplete(interaction, focused) {
        const cmd = interaction.options.getString('type');
        const dur = interaction.options.getString(focused)?.trim();
        const matchedDur = dur?.match(/\d+?\.?\d+?[dhm]|\d[dhm]/g)?.reduce((acc, cur) => acc + ms(cur), 0) ?? 0;
        if (dur && !isNaN(parseInt(dur, 10))) {
            const duration = parseInt(dur, 10);
            if (duration < 60 && dur.includes('m')) {
                return interaction.respond(this.getTimes(['15m', '30m', '45m', '1h'], matchedDur, cmd));
            }
            if (dur.includes('d')) {
                const times = [6, 12, 18, 20, 0].map((n) => this.getLabel(ms(`${duration * 24 + n}h`)));
                return interaction.respond(this.getTimes(times, matchedDur, cmd));
            }
            const times = ['h', '.25h', '.5h', '.75h'].map((n) => this.getLabel(ms(`${duration}${n}`)));
            return interaction.respond(this.getTimes(times, matchedDur, cmd));
        }
        const choices = {
            'clan-wars': WAR_REMINDERS_AUTOCOMPLETE,
            'capital-raids': CAPITAL_RAID_REMINDERS_AUTOCOMPLETE,
            'clan-games': CLAN_GAMES_REMINDERS_AUTOCOMPLETE,
            'default': DEFAULT_REMINDERS_AUTOCOMPLETE
        }[cmd ?? 'default'];
        return interaction.respond(choices);
    }
    isValidQuery(query) {
        return query.replace(ESCAPE_CHAR_REGEX, '').trim();
    }
}
//# sourceMappingURL=autocomplete-interaction.js.map