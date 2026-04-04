import { WAR_LEAGUE_MAP } from '../util/constants.js';
import { createCanvas, loadImage } from 'canvas';
import moment from 'moment';
// CoC-style color palette
const COLORS = {
    BG_DARK: '#1a1a2e',
    BG_ROW: '#16213e',
    BG_ROW_ALT: '#0f3460',
    BG_HIGHLIGHT: '#533483',
    GOLD: '#ffd700',
    WHITE: '#ffffff',
    GREY: '#b0b8c1',
    BORDER: '#c8920a',
    UP: '#4caf50',
    DOWN: '#f44336',
    SAME: '#9e9e9e'
};
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}
function gradientRect(ctx, x, y, w, h, colorTop, colorBottom) {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, colorTop);
    grad.addColorStop(1, colorBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
}
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
    const PADDING = 16;
    const BADGE_SIZE = 36;
    const ROW_H = 52;
    const HEADER_H = 90;
    const COL_HEADERS_H = 36;
    const FOOTER_H = 50;
    const width = 780;
    const height = HEADER_H + COL_HEADERS_H + ranks.length * ROW_H + FOOTER_H + PADDING;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    // ── Background ────────────────────────────────────────────────────────────
    gradientRect(ctx, 0, 0, width, height, '#0d1b2a', '#1a3048');
    // subtle grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    // ── Header ────────────────────────────────────────────────────────────────
    gradientRect(ctx, 0, 0, width, HEADER_H, '#c8920a', '#7a4f00');
    // gold border bottom
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(0, HEADER_H - 3, width, 3);
    // title
    ctx.font = 'bold 34px sans-serif';
    ctx.fillStyle = '#fff8dc';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('Clan War League', PADDING, 32);
    // league name + season
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#ffe599';
    ctx.fillText(`${(leagueId && WAR_LEAGUE_MAP[leagueId]) || 'CWL Ranking'}  •  ${moment(season).format('MMMM YYYY')}`, PADDING, 68);
    // rounds pill (top-right)
    const pillText = `Round ${activeRounds}/${totalRounds}`;
    ctx.font = 'bold 14px sans-serif';
    const pillW = ctx.measureText(pillText).width + 20;
    roundRect(ctx, width - pillW - PADDING, 14, pillW, 28, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.fillStyle = '#fff8dc';
    ctx.textAlign = 'right';
    ctx.fillText(pillText, width - PADDING - 10, 32);
    // ── Column headers ────────────────────────────────────────────────────────
    const headerY = HEADER_H + COL_HEADERS_H / 2;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#b0b8c1';
    ctx.textAlign = 'left';
    ctx.fillText('#', PADDING + 6, headerY);
    ctx.fillText('CLAN', PADDING + 52, headerY);
    ctx.textAlign = 'right';
    ctx.fillText('STARS', width - 170, headerY);
    ctx.fillText('DESTRUCTION', width - PADDING, headerY);
    // divider
    ctx.fillStyle = 'rgba(200,146,10,0.4)';
    ctx.fillRect(0, HEADER_H + COL_HEADERS_H - 1, width, 1);
    // ── Rows ──────────────────────────────────────────────────────────────────
    for (let i = 0; i < ranks.length; i++) {
        const rank = ranks[i];
        const rowY = HEADER_H + COL_HEADERS_H + i * ROW_H;
        const midY = rowY + ROW_H / 2;
        const isHighlighted = i === rankIndex;
        // row background
        if (isHighlighted) {
            gradientRect(ctx, 0, rowY, width, ROW_H, '#533483cc', '#3a1f6ecc');
            ctx.strokeStyle = '#9b59b6';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(1, rowY + 1, width - 2, ROW_H - 2);
        }
        else {
            ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.15)';
            ctx.fillRect(0, rowY, width, ROW_H);
        }
        // rank number with colored circle
        const isUp = rank.pos === 'up';
        const isDown = rank.pos === 'down';
        ctx.beginPath();
        ctx.arc(PADDING + 14, midY, 14, 0, Math.PI * 2);
        ctx.fillStyle = isUp ? COLORS.UP : isDown ? COLORS.DOWN : 'rgba(255,255,255,0.12)';
        ctx.fill();
        ctx.font = 'bold 13px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(String(rank.rank), PADDING + 14, midY);
        // badge
        const badgeX = PADDING + 36;
        const badgeY = midY - BADGE_SIZE / 2;
        try {
            const img = await loadImage(rank.badgeUrl);
            ctx.drawImage(img, badgeX, badgeY, BADGE_SIZE, BADGE_SIZE);
        }
        catch {
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fillRect(badgeX, badgeY, BADGE_SIZE, BADGE_SIZE);
        }
        // clan name
        ctx.font = isHighlighted ? 'bold 16px sans-serif' : '15px sans-serif';
        ctx.fillStyle = isHighlighted ? '#e0c6ff' : COLORS.WHITE;
        ctx.textAlign = 'left';
        const maxNameW = width - 380;
        let name = rank.name;
        while (ctx.measureText(name).width > maxNameW && name.length > 1)
            name = name.slice(0, -1);
        if (name !== rank.name)
            name = name.slice(0, -1) + '…';
        ctx.fillText(name, badgeX + BADGE_SIZE + 10, midY);
        // stars with star emoji
        ctx.font = 'bold 15px sans-serif';
        ctx.fillStyle = COLORS.GOLD;
        ctx.textAlign = 'right';
        ctx.fillText(`${rank.stars} ★`, width - 170, midY);
        // destruction
        ctx.fillStyle = COLORS.GREY;
        ctx.fillText(`${rank.destruction.toFixed(1)}%`, width - PADDING, midY);
        // row separator
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(0, rowY + ROW_H - 1, width, 1);
    }
    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = HEADER_H + COL_HEADERS_H + ranks.length * ROW_H;
    gradientRect(ctx, 0, footerY, width, FOOTER_H, '#7a4f00', '#3e2800');
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(0, footerY, width, 2);
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#fff8dc';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Rank #${rankIndex + 1}`, PADDING, footerY + FOOTER_H / 2);
    ctx.textAlign = 'center';
    ctx.fillText(`Max ${medals} Medals`, width / 2, footerY + FOOTER_H / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#b0b8c1';
    ctx.fillText(`Season ${moment(season).format('MMM YYYY')}`, width - PADDING, footerY + FOOTER_H / 2);
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