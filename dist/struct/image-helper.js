import { WAR_LEAGUE_MAP } from '../util/constants.js';
import { createCanvas } from 'canvas';
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
    const width = 800;
    const height = 300 + (ranks.length * 40);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    // Fill background
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(0, 0, width, height);
    // Header
    ctx.fillStyle = '#27ae60';
    ctx.fillRect(0, 0, width, 80);
    ctx.font = 'bold 40px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('CWL Ranking', 20, 55);
    // League info
    ctx.font = '16px sans-serif';
    ctx.fillText(`${WAR_LEAGUE_MAP[leagueId] || 'War League'} | ${moment(season).format('MMM YYYY')}`, 20, 75);
    // Column headers
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#ecf0f1';
    let y = 120;
    ctx.fillText('Rank', 20, y);
    ctx.fillText('Clan Name', 80, y);
    ctx.fillText('Stars', 500, y);
    ctx.fillText('Destruction', 600, y);
    // Rows
    ctx.font = '14px sans-serif';
    y = 160;
    for (let i = 0; i < ranks.length; i++) {
        const rank = ranks[i];
        // Highlight current clan
        if (i === rankIndex) {
            ctx.fillStyle = '#27ae6044';
            ctx.fillRect(0, y - 20, width, 35);
        }
        ctx.fillStyle = '#ecf0f1';
        ctx.fillText(`${rank.rank}`, 20, y);
        ctx.fillText(rank.name.substring(0, 30), 80, y);
        ctx.fillText(rank.stars.toString(), 520, y);
        ctx.fillText(`${rank.destruction.toFixed(1)}%`, 600, y);
        y += 35;
    }
    // Footer with medals
    ctx.fillStyle = '#27ae60';
    ctx.fillRect(0, height - 40, width, 40);
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`🏅 Medals: ${medals}  |  Rounds: ${activeRounds}/${totalRounds}`, 20, height - 15);
    const buffer = canvas.toBuffer('image/png');
    return {
        file: buffer,
        name: 'cwl-stats.png',
        attachmentKey: 'attachment://cwl-stats.png'
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