import type { ClashPlayer } from '@clashmate/coc';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
} from 'discord.js';

export const BOOSTS_COMMAND_NAME = 'boosts';
export const BOOSTS_COMMAND_DESCRIPTION = 'Show currently boosted Super Troops for a linked clan.';
export const BOOSTS_NO_SNAPSHOT_MESSAGE =
  'No member snapshot is available yet. Link/configure a clan and wait for clan polling to observe members.';
export const BOOSTS_NO_ACTIVE_DATA_MESSAGE =
  'No active Super Troop boost data is stored yet for this clan. ClashMate needs player troop data from a lookup before boosts can be displayed.';

const EMBED_FIELD_VALUE_LIMIT = 1024;
const MAX_PLAYER_FETCHES = 50;

export const boostsCommandData = new SlashCommandBuilder()
  .setName(BOOSTS_COMMAND_NAME)
  .setDescription(BOOSTS_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('clan')
      .setDescription('Clan tag or name or alias.')
      .setAutocomplete(true)
      .setRequired(false),
  );

export interface BoostsLinkedClan {
  readonly id: string;
  readonly clanTag: string;
  readonly name: string | null;
  readonly alias: string | null;
}

export interface BoostsSnapshotRow {
  readonly playerTag: string;
  readonly name: string;
}

export interface BoostsClanSnapshots {
  readonly clan: BoostsLinkedClan;
  readonly members: readonly BoostsSnapshotRow[];
}

export interface BoostsStore {
  readonly listLinkedClans: (guildId: string) => Promise<BoostsLinkedClan[]>;
  readonly listClanMemberSnapshotsForGuild: (input: {
    guildId: string;
    clanTag?: string;
  }) => Promise<BoostsClanSnapshots[]>;
}

export interface BoostsCocApi {
  readonly getPlayer: (playerTag: string) => Promise<ClashPlayer>;
}

export interface BoostsCommandOptions {
  readonly store: BoostsStore;
  readonly coc: BoostsCocApi;
}

export interface ActiveBoostPlayer {
  readonly name: string;
  readonly tag: string;
}

export interface ActiveBoostGroup {
  readonly troopName: string;
  readonly players: readonly ActiveBoostPlayer[];
}

export function createBoostsSlashCommand(options: BoostsCommandOptions): SlashCommandDefinition {
  return {
    name: BOOSTS_COMMAND_NAME,
    data: boostsCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== BOOSTS_COMMAND_NAME) return;
      await executeBoosts(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== BOOSTS_COMMAND_NAME) return;
      await autocompleteBoosts(interaction, options);
    },
  };
}

async function autocompleteBoosts(
  interaction: AutocompleteInteraction,
  options: BoostsCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'clan') {
    await interaction.respond([]);
    return;
  }

  try {
    const clans = await options.store.listLinkedClans(interaction.guildId);
    await interaction.respond(filterBoostsClanChoices(clans, String(focused.value ?? '')));
  } catch {
    await interaction.respond([]);
  }
}

export function filterBoostsClanChoices(
  clans: readonly BoostsLinkedClan[],
  query: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const normalizedQuery = query.trim().toLowerCase();
  return clans
    .filter((clan) => clanMatchesQuery(clan, normalizedQuery))
    .slice(0, 25)
    .map((clan) => ({ name: formatClanChoiceName(clan), value: clan.alias ?? clan.clanTag }));
}

export async function executeBoosts(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: BoostsCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/boosts` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const clans = await options.store.listLinkedClans(interaction.guildId);
  if (clans.length === 0) {
    await interaction.editReply({
      content: 'No clans are linked to this server yet. Use `/setup clan` to link one.',
    });
    return;
  }

  const clanOption = interaction.options.getString('clan');
  const clan = clanOption ? resolveBoostsClan(clans, clanOption) : clans[0];
  if (!clan) {
    await interaction.editReply({ content: 'No linked clan was found for that clan option.' });
    return;
  }

  const [snapshots] = await options.store.listClanMemberSnapshotsForGuild({
    guildId: interaction.guildId,
    clanTag: clan.clanTag,
  });

  if (!snapshots || snapshots.members.length === 0) {
    await interaction.editReply({ content: BOOSTS_NO_SNAPSHOT_MESSAGE });
    return;
  }

  const players = await fetchPlayersForBoosts(snapshots.members, options.coc);
  const boosts = collectActiveBoosts(players);
  if (boosts.length === 0) {
    await interaction.editReply({ content: BOOSTS_NO_ACTIVE_DATA_MESSAGE });
    return;
  }

  await interaction.editReply({
    embeds: [buildBoostsEmbed(snapshots.clan, boosts, snapshots.members.length)],
  });
}

async function fetchPlayersForBoosts(
  members: readonly BoostsSnapshotRow[],
  coc: BoostsCocApi,
): Promise<ClashPlayer[]> {
  const players: ClashPlayer[] = [];
  for (const member of members.slice(0, MAX_PLAYER_FETCHES)) {
    try {
      players.push(await coc.getPlayer(member.playerTag));
    } catch {
      // Ignore individual one-off lookup failures so one private/missing player does not fail the command.
    }
  }
  return players;
}

export function collectActiveBoosts(players: readonly ClashPlayer[]): ActiveBoostGroup[] {
  const groups = new Map<string, ActiveBoostPlayer[]>();
  for (const player of players) {
    for (const troop of readTroops(player.data)) {
      if (!troop.superTroopIsActive) continue;
      const list = groups.get(troop.name) ?? [];
      list.push({ name: player.name, tag: player.tag });
      groups.set(troop.name, list);
    }
  }
  return [...groups.entries()]
    .map(([troopName, groupPlayers]) => ({
      troopName,
      players: groupPlayers.sort(
        (a, b) => a.name.localeCompare(b.name) || a.tag.localeCompare(b.tag),
      ),
    }))
    .sort((a, b) => b.players.length - a.players.length || a.troopName.localeCompare(b.troopName));
}

export function buildBoostsEmbed(
  clan: BoostsLinkedClan,
  boosts: readonly ActiveBoostGroup[],
  totalMembers: number,
): EmbedBuilder {
  const clanName = clan.alias ?? clan.name ?? 'Linked Clan';
  const boostedPlayers = new Set(
    boosts.flatMap((boost) => boost.players.map((player) => player.tag)),
  );
  const embed = new EmbedBuilder()
    .setTitle('Currently Boosted Super Troops')
    .setAuthor({ name: `${clanName} (${clan.clanTag})` })
    .setFooter({ text: `Total ${boostedPlayers.size}/${totalMembers} members with active boosts` })
    .setTimestamp();

  for (const boost of boosts) {
    embed.addFields({
      name: `${boost.troopName} (${boost.players.length})`,
      value: truncateFieldValue(
        boost.players
          .map((player) => `${escapeMarkdown(player.name)} · \`${player.tag}\``)
          .join('\n'),
      ),
      inline: false,
    });
  }

  return embed;
}

export function resolveBoostsClan(
  clans: readonly BoostsLinkedClan[],
  query: string,
): BoostsLinkedClan | undefined {
  const normalizedQuery = query.trim().toLowerCase();
  let normalizedTag: string | undefined;
  try {
    normalizedTag = normalizeClashTag(query).toLowerCase();
  } catch {
    normalizedTag = undefined;
  }
  return clans.find(
    (clan) =>
      clan.clanTag.toLowerCase() === normalizedTag ||
      clan.clanTag.replace(/^#/, '').toLowerCase() === normalizedQuery.replace(/^#/, '') ||
      clan.alias?.trim().toLowerCase() === normalizedQuery ||
      clan.name?.trim().toLowerCase() === normalizedQuery,
  );
}

function readTroops(data: unknown): Array<{ name: string; superTroopIsActive: boolean }> {
  if (!isRecord(data)) return [];
  const troops = readValue(data, 'troops');
  if (!Array.isArray(troops)) return [];
  return troops.flatMap((troop) => {
    if (!isRecord(troop)) return [];
    const name = readValue(troop, 'name');
    const superTroopIsActive = readValue(troop, 'superTroopIsActive');
    return typeof name === 'string' && superTroopIsActive === true
      ? [{ name, superTroopIsActive: true }]
      : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function clanMatchesQuery(clan: BoostsLinkedClan, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [clan.clanTag, clan.clanTag.replace(/^#/, ''), clan.name ?? '', clan.alias ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(normalizedQuery));
}

function formatClanChoiceName(clan: BoostsLinkedClan): string {
  const label = clan.alias?.trim() || clan.name?.trim() || clan.clanTag;
  return `${label} (${clan.clanTag})`.slice(0, 100);
}

function truncateFieldValue(value: string): string {
  if (value.length <= EMBED_FIELD_VALUE_LIMIT) return value;
  return `${value.slice(0, EMBED_FIELD_VALUE_LIMIT - 1)}…`;
}
