import { WAR_LEAGUE_PROMOTION_MAP } from '../util/constants.js';
export function rankingSort(a, b) {
    if (a.stars === b.stars)
        return b.destruction - a.destruction;
    return b.stars - a.stars;
}
export function isWinner(clan, opponent) {
    if (clan.stars > opponent.stars) {
        return true;
    }
    else if (clan.stars < opponent.stars) {
        return false;
    }
    if (clan.destructionPercentage > opponent.destructionPercentage) {
        return true;
    }
    else if (clan.destructionPercentage < opponent.destructionPercentage) {
        return false;
    }
    return false;
}
export function aggregateRoundsForRanking(rounds) {
    const ranking = {};
    for (const data of rounds) {
        ranking[data.clan.tag] ??= {
            name: data.clan.name,
            tag: data.clan.tag,
            stars: 0,
            destruction: 0,
            badgeUrl: data.clan.badgeUrls.large
        };
        const clan = ranking[data.clan.tag];
        clan.stars += data.clan.stars;
        if (data.state === 'warEnded' && isWinner(data.clan, data.opponent))
            clan.stars += 10;
        clan.destruction += data.clan.destructionPercentage * data.teamSize;
        ranking[data.opponent.tag] ??= {
            name: data.opponent.name,
            tag: data.opponent.tag,
            stars: 0,
            destruction: 0,
            badgeUrl: data.opponent.badgeUrls.large
        };
        const opponent = ranking[data.opponent.tag];
        opponent.stars += data.opponent.stars;
        if (data.state === 'warEnded' && isWinner(data.opponent, data.clan))
            opponent.stars += 10;
        opponent.destruction += data.opponent.destructionPercentage * data.teamSize;
    }
    return Object.values(ranking);
}
export function calculateLeagueRanking(rankings, leagueId) {
    return rankings
        .sort(rankingSort)
        .map((clan, i) => ({ ...clan, leagueId, rank: i + 1 }))
        .map((clan) => ({
        ...clan,
        pos: leagueId
            ? clan.rank <= WAR_LEAGUE_PROMOTION_MAP[leagueId].promotion
                ? 'up'
                : clan.rank >= WAR_LEAGUE_PROMOTION_MAP[leagueId].demotion
                    ? 'down'
                    : 'same'
            : 0,
        destruction: Math.round(clan.destruction)
    }));
}
//# sourceMappingURL=cwl.helper.js.map