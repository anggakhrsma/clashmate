import { WAR_LEAGUE_MAP } from '../util/constants.js';
import moment from 'moment';
function formatNumber(num) {
    return `${num > 0 ? '+' : ''}${num.toFixed(0)}`;
}
export const createLegendGraph = async ({ datasets, labels, data, season, seasonStart, seasonEnd, lastSeason, prevFinalTrophies }) => {
    const arrayBuffer = await fetch(`${process.env.IMAGE_GEN_API_BASE_URL}/legends/graph`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            datasets,
            labels,
            name: data.name,
            avgNetGain: formatNumber(season.avgGain),
            avgOffense: formatNumber(season.avgOffense),
            avgDefense: formatNumber(season.avgDefense),
            prevAvgNetGain: lastSeason ? formatNumber(lastSeason.avgGain) : '',
            prevAvgOffense: lastSeason ? formatNumber(lastSeason.avgOffense) : '',
            prevAvgDefense: lastSeason ? formatNumber(lastSeason.avgDefense) : '',
            townHall: data.townHallLevel.toString(),
            prevFinalTrophies,
            prevSeason: lastSeason ? `${moment(lastSeason._id).format('MMM')}` : '',
            currentTrophies: data.trophies.toFixed(0),
            clanName: data.clan?.name,
            clanBadgeURL: data.clan?.badgeUrls.large,
            season: `${moment(season._id).format('MMMM YYYY')} (${moment(seasonStart).format('DD MMM')} - ${moment(seasonEnd).format('DD MMM')})`
        })
    }).then((res) => res.arrayBuffer());
    return {
        file: Buffer.from(arrayBuffer),
        name: 'legend-rank-card.jpeg',
        attachmentKey: 'attachment://legend-rank-card.jpeg'
    };
};
export const getCWLSummaryImage = async ({ ranks, activeRounds, leagueId, medals, rankIndex, season, totalRounds }) => {
    const arrayBuffer = await fetch(`${process.env.IMAGE_GEN_API_BASE_URL}/wars/cwl-ranks`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            ranks,
            rankIndex,
            season,
            medals,
            leagueName: WAR_LEAGUE_MAP[leagueId],
            rounds: `${activeRounds}/${totalRounds}`
        })
    }).then((res) => res.arrayBuffer());
    return {
        file: Buffer.from(arrayBuffer),
        name: 'clan-war-league-ranking.jpeg',
        attachmentKey: 'attachment://clan-war-league-ranking.jpeg'
    };
};
export const createTrophyThresholdsGraph = async ({ datasets, labels, title }) => {
    const arrayBuffer = await fetch(`${process.env.IMAGE_GEN_API_BASE_URL}/clans/activity`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            labels: labels,
            datasets,
            offset: 0,
            unit: 'day',
            title
        })
    }).then((res) => res.arrayBuffer());
    return {
        file: Buffer.from(arrayBuffer),
        name: 'legend-ranking-threshold.jpeg',
        attachmentKey: 'attachment://legend-ranking-threshold.jpeg'
    };
};
//# sourceMappingURL=image-helper.js.map