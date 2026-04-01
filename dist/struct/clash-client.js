import { DISCORD_ID_REGEX, FeatureFlags, TAG_REGEX } from '../util/constants.js';
import { RESTManager, RequestHandler } from 'clashofclans.js';
import moment from 'moment';
import { isWinner } from '../helper/cwl.helper.js';
import { Season } from '../util/toolkit.js';
export function timeoutSignal(timeout, path) {
    if (!Number.isInteger(timeout)) {
        throw new TypeError('Expected an integer for the timeout');
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort(path);
    }, timeout);
    timeoutId.unref();
    return controller.signal;
}
export class ClashClient extends RESTManager {
    constructor(client) {
        const keys = process.env.CLASH_OF_CLANS_API_KEYS?.split(',') ?? [];
        super({
            restRequestTimeout: 10_000,
            baseURL: process.env.CLASH_OF_CLANS_API_BASE_URL,
            keys: [...keys]
        });
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
        Object.defineProperty(this, "bearerToken", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.requestHandler = new RequestHandler({
            restRequestTimeout: 10_000,
            rejectIfNotValid: false,
            cache: false,
            retryLimit: 2,
            keys: [...keys],
            baseURL: process.env.CLASH_OF_CLANS_API_BASE_URL,
            onError: ({ path, status, body }) => {
                if ((status !== 200 || !body) &&
                    !(!body?.message && status === 403) &&
                    !(path.includes('war') && status === 404)) {
                    if (status === 500) {
                        this.client.logger.debug(`${status} ${path} ${JSON.stringify(body)}`, {
                            label: 'HTTP'
                        });
                    }
                    else {
                        this.client.logger.debug(`${status} ${path}`, { label: 'HTTP' });
                    }
                }
            }
        });
    }
    getClanURL(clanTag) {
        return `https://link.clashofclans.com/en?action=OpenClanProfile&tag=${encodeURIComponent(clanTag)}`;
    }
    getPlayerURL(playerTag) {
        return `https://link.clashofclans.com/en?action=OpenPlayerProfile&tag=${encodeURIComponent(playerTag)}`;
    }
    fixTag(tag) {
        return super.util.parseTag(tag);
    }
    isValidTag(tag) {
        if (!tag)
            return false;
        return /^#?[0289PYLQGRJCUV]{3,}$/.test(tag.toUpperCase().replace(/O/g, '0'));
    }
    async _getPlayers(players = []) {
        const result = await Promise.all(players.map((mem) => this.getPlayer(mem.tag)));
        return result.filter(({ res }) => res.ok).map(({ body }) => body);
    }
    async _getClans(clans = []) {
        const result = await Promise.all(clans.map((clan) => this.getClan(clan.tag)));
        return result.filter(({ res }) => res.ok).map(({ body }) => body);
    }
    calcRaidMedals(raidSeason) {
        const districtMap = {
            1: 135,
            2: 225,
            3: 350,
            4: 405,
            5: 460
        };
        const capitalMap = {
            2: 180,
            3: 360,
            4: 585,
            5: 810,
            6: 1115,
            7: 1240,
            8: 1260,
            9: 1375,
            10: 1450
        };
        let totalMedals = 0;
        let attacksDone = 0;
        for (const clan of raidSeason.attackLog) {
            attacksDone += clan.attackCount;
            for (const district of clan.districts) {
                if (district.destructionPercent === 100) {
                    if (district.id === 70000000) {
                        totalMedals += capitalMap[district.districtHallLevel];
                    }
                    else {
                        totalMedals += districtMap[district.districtHallLevel];
                    }
                }
            }
        }
        if (totalMedals !== 0) {
            totalMedals = Math.ceil(totalMedals / attacksDone) * 6;
        }
        return Math.min(1620, Math.max(totalMedals, raidSeason.offensiveReward * 6));
    }
    calcRaidCompleted(attackLog) {
        let total = 0;
        for (const clan of attackLog) {
            if (clan.districtsDestroyed === clan.districtCount)
                total += 1;
        }
        return total;
    }
    isFriendly(data) {
        const friendlyWarTimes = [
            1000 * 60 * 60 * 24,
            1000 * 60 * 60 * 20,
            1000 * 60 * 60 * 16,
            1000 * 60 * 60 * 12,
            1000 * 60 * 60 * 8,
            1000 * 60 * 60 * 6,
            1000 * 60 * 60 * 4,
            1000 * 60 * 60 * 2,
            1000 * 60 * 60,
            1000 * 60 * 30,
            1000 * 60 * 15,
            1000 * 60 * 5
        ];
        return friendlyWarTimes.includes(this.toDate(data.startTime).getTime() - this.toDate(data.preparationStartTime).getTime());
    }
    toDate(ISO) {
        return new Date(moment(ISO).toDate());
    }
    isWinner(clan, opponent) {
        return isWinner(clan, opponent);
    }
    getRaidSeasons(tag, limit = 1) {
        return super.getCapitalRaidSeasons(tag, { limit });
    }
    async getCurrentWars(clanTag) {
        const date = new Date().getUTCDate();
        if (!(date >= 1 && date <= 10)) {
            return this._getCurrentWar(clanTag);
        }
        return this._getClanWarLeague(clanTag);
    }
    async _getCurrentWar(clanTag) {
        const { body: data, res } = await this.getCurrentWar(clanTag);
        return res.ok ? [Object.assign(data, { isFriendly: this.isFriendly(data) })] : [];
    }
    async _getClanWarLeague(clanTag) {
        const { body: data, res } = await this.getClanWarLeagueGroup(clanTag);
        if (res.status === 504 || data.state === 'notInWar')
            return [];
        if (!res.ok)
            return this._getCurrentWar(clanTag);
        return this._clanWarLeagueRounds(clanTag, data);
    }
    async _clanWarLeagueRounds(clanTag, body) {
        const chunks = [];
        for (const { warTags } of body.rounds.filter((en) => !en.warTags.includes('#0')).slice(-2)) {
            for (const warTag of warTags) {
                const { body: data, res } = await this.getClanWarLeagueRound(warTag);
                if (!res.ok || data.state === 'notInWar')
                    continue;
                const round = body.rounds.findIndex((en) => en.warTags.includes(warTag));
                if (data.clan.tag === clanTag || data.opponent.tag === clanTag) {
                    const clan = data.clan.tag === clanTag ? data.clan : data.opponent;
                    const opponent = data.clan.tag === clanTag ? data.opponent : data.clan;
                    chunks.push(Object.assign(data, { warTag, round: round + 1 }, { clan, opponent }));
                    break;
                }
            }
        }
        return chunks;
    }
    async getCWLRoundWithWarTag(warTag) {
        const body = await this._getCWLRoundWithWarTag(warTag);
        if (!body.ok || body.state === 'notInWar')
            return null;
        return body;
    }
    async _getCWLRoundWithWarTag(warTag) {
        const { body, res } = await this.getClanWarLeagueRound(warTag);
        return { warTag, ...body, ...res };
    }
    async aggregateClanWarLeague(clanTag, group, isApiData) {
        const rounds = group.rounds.filter((r) => !r.warTags.includes('#0'));
        const warTags = rounds.map((round) => round.warTags).flat();
        if (Season.monthId !== group.season && !isApiData) {
            return this.getDataFromArchive(clanTag, group.season, group);
        }
        const wars = (await Promise.all(warTags.map((warTag) => this._getCWLRoundWithWarTag(warTag)))).filter((res) => res.ok && res.state !== 'notInWar');
        return {
            season: group.season,
            clans: group.clans,
            wars,
            rounds: rounds.length,
            leagues: group.leagues ?? {}
        };
    }
    async getDataFromArchive(clanTag, season, group) {
        const baseUrl = process.env.INTERNAL_API_BASE_URL;
        if (!baseUrl)
            return null; // service-backend not configured yet
        const res = await fetch(`${baseUrl}/v1/cwl/${encodeURIComponent(clanTag)}/seasons/${season}`, {
            headers: {
                'x-api-key': process.env.INTERNAL_API_KEY ?? ''
            }
        }).catch(() => null);
        if (!res?.ok)
            return null;
        const data = (await res.json().catch(() => null));
        if (!data)
            return null;
        data.leagues = group?.leagues ?? {};
        data.fromArchive = true;
        return data;
    }
    getPreviousBestAttack(attacks, { defenderTag, attackerTag, order }) {
        const defenderDefenses = attacks.filter((atk) => atk.defenderTag === defenderTag);
        const isFresh = defenderDefenses.length === 0 ||
            order === Math.min(...defenderDefenses.map((def) => def.order));
        if (isFresh)
            return null;
        return (attacks
            .filter((atk) => atk.defenderTag === defenderTag && atk.order < order && atk.attackerTag !== attackerTag)
            .sort((a, b) => b.destructionPercentage ** b.stars - a.destructionPercentage ** a.stars)
            .at(0) ?? null);
    }
    async autoLogin() {
        try {
            await this._login();
            setInterval(this._login.bind(this), 60 * 60 * 1000).unref();
        }
        catch {
            this.client.logger.warn('cocdiscord.link login skipped — no DISCORD_LINK_USERNAME/PASSWORD configured', { label: 'LINK' });
        }
    }
    async _login() {
        if (!process.env.DISCORD_LINK_USERNAME || !process.env.DISCORD_LINK_PASSWORD) {
            return false;
        }
        const res = await fetch('https://cocdiscord.link/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: process.env.DISCORD_LINK_USERNAME,
                password: process.env.DISCORD_LINK_PASSWORD
            }),
            signal: timeoutSignal(10_000, 'POST /login')
        }).catch(() => null);
        const data = (await res?.json().catch(() => null));
        if (data?.token)
            this.bearerToken = data.token;
        return res?.status === 200 && this.bearerToken;
    }
    async linkPlayerTag(discordId, playerTag, options) {
        if (!options?.force &&
            !this.client.isFeatureEnabled(FeatureFlags.USE_DISCORD_LINK_API, 'global')) {
            return true;
        }
        if (options?.force) {
            await this.unlinkPlayerTag(playerTag);
        }
        const res = await fetch('https://cocdiscord.link/links', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.bearerToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ playerTag, discordId }),
            signal: timeoutSignal(10_000, 'POST /links')
        }).catch(() => null);
        return Promise.resolve(res?.status === 200);
    }
    async unlinkPlayerTag(playerTag) {
        const res = await fetch(`https://cocdiscord.link/links/${encodeURIComponent(playerTag)}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${this.bearerToken}`,
                'Content-Type': 'application/json'
            },
            signal: timeoutSignal(10_000, 'DELETE /links/:playerTag')
        }).catch(() => null);
        return Promise.resolve(res?.status === 200);
    }
    async getPlayerTags(user) {
        const res = await fetch(`https://cocdiscord.link/links/${user}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.bearerToken}`,
                'Content-Type': 'application/json'
            },
            signal: timeoutSignal(10_000, 'GET /links/:user')
        }).catch(() => null);
        const data = (await res?.json().catch(() => []));
        if (!Array.isArray(data))
            return [];
        return data.filter((en) => TAG_REGEX.test(en.playerTag)).map((en) => this.fixTag(en.playerTag));
    }
    async getLinkedUser(tag) {
        const res = await fetch(`https://cocdiscord.link/links/${encodeURIComponent(tag)}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.bearerToken}`,
                'Content-Type': 'application/json'
            },
            signal: timeoutSignal(10_000, 'GET /links/:tag')
        }).catch(() => null);
        const data = (await res?.json().catch(() => []));
        if (!Array.isArray(data))
            return null;
        return data.map((en) => ({ userId: en.discordId, tag }))[0] ?? null;
    }
    async getDiscordLinks(players) {
        if (!players.length)
            return [];
        const res = await fetch('https://cocdiscord.link/batch', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.bearerToken}`,
                'Content-Type': 'application/json'
            },
            signal: timeoutSignal(10_000, 'POST /batch'),
            body: JSON.stringify(players.map((mem) => mem.tag))
        }).catch(() => null);
        const data = (await res?.json().catch(() => []));
        if (!Array.isArray(data))
            return [];
        return data
            .filter((en) => TAG_REGEX.test(en.playerTag) && DISCORD_ID_REGEX.test(en.discordId))
            .map((en) => ({
            tag: this.fixTag(en.playerTag),
            userId: en.discordId,
            verified: false,
            displayName: 'Unknown',
            username: 'unknown'
        }));
    }
}
//# sourceMappingURL=clash-client.js.map