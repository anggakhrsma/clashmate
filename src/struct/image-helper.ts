import { WAR_LEAGUE_MAP } from '@app/constants';
import { createCanvas } from 'canvas';
import moment from 'moment';
import { CWLRankCard } from '../helper/cwl.helper.js';

function formatNumber(num: number) {
  return `${num > 0 ? '+' : ''}${num.toFixed(0)}`;
}

export const createLegendGraph = async ({
  datasets,
  labels,
  data,
  season,
  seasonStart,
  seasonEnd,
  lastSeason,
  prevFinalTrophies
}: {
  datasets: any[];
  labels: Date[];
  data: {
    name: string;
    townHallLevel: number;
    trophies: number;
    clan?: {
      name: string;
      badgeUrls: {
        large: string;
      };
    };
  };
  season: any;
  seasonStart: Date;
  seasonEnd: Date;
  lastSeason?: any;
  prevFinalTrophies: number | string;
}) => {
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
    name: 'legend-rank-card.jpeg' as const,
    attachmentKey: 'attachment://legend-rank-card.jpeg' as const
  };
};

export const getCWLSummaryImage = async ({
  ranks,
  activeRounds,
  leagueId,
  medals,
  rankIndex,
  season,
  totalRounds
}: {
  ranks: CWLRankCard[];
  rankIndex: number;
  season: string;
  medals: number;
  leagueId: number;
  activeRounds: number;
  totalRounds: number;
}) => {
  const width = 900;
  const height = 400 + ranks.length * 35;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, width, height);

  // Header section
  ctx.fillStyle = '#16c784';
  ctx.fillRect(0, 0, width, 120);

  // League name
  ctx.font = 'bold 48px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(WAR_LEAGUE_MAP[leagueId] || 'War League', 40, 55);

  // Season and rounds
  ctx.font = '18px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`Season: ${moment(season).format('MMM YYYY')} | Rounds: ${activeRounds}/${totalRounds}`, 40, 90);

  // Stats section
  ctx.font = 'bold 20px Arial';
  ctx.fillStyle = '#16c784';
  ctx.textAlign = 'right';
  ctx.fillText(`🏅 ${medals} Medals`, width - 40, 60);

  // Ranking table
  const tableY = 150;
  const rowHeight = 35;
  const padding = 15;

  // Column widths
  const rankWidth = 50;
  const nameWidth = 400;

  // Headers
  ctx.font = 'bold 16px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText('Rank', 40, tableY + 25);
  ctx.fillText('Clan Name', 40 + rankWidth + padding, tableY + 25);
  ctx.textAlign = 'right';
  ctx.fillText('Stars', 40 + rankWidth + nameWidth + padding, tableY + 25);
  ctx.fillText('Destruction %', width - 40, tableY + 25);

  // Table rows
  for (let i = 0; i < ranks.length; i++) {
    const rank = ranks[i];
    const rowY = tableY + 50 + i * rowHeight;

    // Highlight user's clan
    if (i === rankIndex) {
      ctx.fillStyle = '#16c78433';
      ctx.fillRect(20, rowY - 25, width - 40, rowHeight);
      ctx.strokeStyle = '#16c784';
      ctx.lineWidth = 2;
      ctx.strokeRect(20, rowY - 25, width - 40, rowHeight);
    }

    // Rank number
    ctx.font = '16px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(`#${i + 1}`, 40, rowY);

    // Clan name (truncate if too long)
    let name = rank.name;
    if (name.length > 25) name = name.substring(0, 22) + '...';
    ctx.fillText(name, 40 + rankWidth + padding, rowY);

    // Stars
    ctx.textAlign = 'right';
    ctx.fillText(`${rank.stars}⭐`, 40 + rankWidth + nameWidth + padding, rowY);

    // Destruction
    ctx.fillText(`${rank.destruction.toFixed(1)}%`, width - 40, rowY);
  }

  const buffer = canvas.toBuffer('image/png');
  return {
    file: buffer,
    name: 'clan-war-league-ranking.png' as const,
    attachmentKey: 'attachment://clan-war-league-ranking.png' as const
  };
};

export const createTrophyThresholdsGraph = async ({
  datasets,
  labels,
  title
}: {
  datasets: any[];
  labels: string[];
  title: string;
}) => {
  const arrayBuffer = await fetch(`${process.env.IMAGE_GEN_API_BASE_URL!}/clans/activity`, {
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
    name: 'legend-ranking-threshold.jpeg' as const,
    attachmentKey: 'attachment://legend-ranking-threshold.jpeg' as const
  };
};
