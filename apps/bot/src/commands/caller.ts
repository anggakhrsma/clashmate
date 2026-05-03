import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { escapeMarkdown, SlashCommandBuilder } from 'discord.js';

export const CALLER_COMMAND_NAME = 'caller';
export const CALLER_COMMAND_DESCRIPTION =
  'Assign or clear persisted war base calls from latest snapshots.';

export interface CallerWarSnapshotRecord {
  readonly clanTag: string;
  readonly warKey?: string;
  readonly state: string;
  readonly snapshot: unknown;
  readonly fetchedAt: Date;
  readonly trackedClan?: {
    readonly clanTag: string;
    readonly name: string | null;
    readonly alias: string | null;
  };
}

export interface CallerStore {
  readonly getLatestWarSnapshotsForGuild: (guildId: string) => Promise<CallerWarSnapshotRecord[]>;
  readonly assignCallerBase: (input: CallerAssignmentInput) => Promise<void>;
  readonly clearCallerBase: (input: CallerClearInput) => Promise<boolean>;
}

export interface CallerAssignmentInput {
  readonly guildId: string;
  readonly guildName: string | null;
  readonly clanTag: string;
  readonly warKey: string;
  readonly defenseMapPosition: number;
  readonly offenseMapPosition: number;
  readonly defenseTag: string | null;
  readonly defenseName: string | null;
  readonly offenseTag: string | null;
  readonly offenseName: string | null;
  readonly note: string | null;
  readonly expiresAt: Date | null;
  readonly actorDiscordUserId: string;
}

export interface CallerClearInput {
  readonly guildId: string;
  readonly guildName: string | null;
  readonly clanTag: string;
  readonly warKey: string;
  readonly defenseMapPosition: number;
  readonly actorDiscordUserId: string;
}

export interface CallerCommandOptions {
  readonly store: CallerStore;
}

interface WarMember {
  readonly tag?: string;
  readonly name?: string;
  readonly mapPosition?: number;
}

interface WarClan {
  readonly tag?: string;
  readonly name?: string;
  readonly members?: readonly WarMember[];
}

interface WarData {
  readonly state?: string;
  readonly clan?: WarClan;
  readonly opponent?: WarClan;
  readonly preparationStartTime?: string;
}

export const callerCommandData = new SlashCommandBuilder()
  .setName(CALLER_COMMAND_NAME)
  .setDescription(CALLER_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('assign')
      .setDescription('Assign an offensive base to a defensive target.')
      .addIntegerOption((option) =>
        option
          .setName('defense_target')
          .setDescription('Opponent defensive map position.')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(50),
      )
      .addIntegerOption((option) =>
        option
          .setName('offense_target')
          .setDescription('Friendly offensive map position.')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(50),
      )
      .addStringOption((option) =>
        option.setName('notes').setDescription('Optional notes for this call.').setRequired(false),
      )
      .addNumberOption((option) =>
        option
          .setName('hours')
          .setDescription('Optional hours until this call expires.')
          .setMinValue(0.1),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('clear')
      .setDescription('Clear a defensive target call.')
      .addIntegerOption((option) =>
        option
          .setName('defense_target')
          .setDescription('Opponent defensive map position to clear.')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(50),
      ),
  );

export function createCallerSlashCommand(options: CallerCommandOptions): SlashCommandDefinition {
  return {
    name: CALLER_COMMAND_NAME,
    data: callerCommandData,
    execute: async (interaction, _context: CommandContext) => {
      if (!interaction.isChatInputCommand() || interaction.commandName !== CALLER_COMMAND_NAME)
        return;
      if (!interaction.inCachedGuild()) {
        await interaction.reply({
          content: '`/caller` can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const snapshots = await options.store.getLatestWarSnapshotsForGuild(interaction.guildId);
      const entry = snapshots.map(toWarEntry).find((item): item is WarEntry => item !== null);
      if (!entry) {
        await interaction.reply({
          content:
            'No linked clan with a current war snapshot was found. `/caller` only reads persisted snapshots and does not query the Clash API.',
          ephemeral: true,
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand(true);
      const defenseMapPosition = interaction.options.getInteger('defense_target', true);
      const defense = memberAt(entry.defenseMembers, defenseMapPosition);
      if (!defense) {
        await interaction.reply({
          content: `Invalid defensive target #${defenseMapPosition} for the latest war snapshot.`,
          ephemeral: true,
        });
        return;
      }

      if (subcommand === 'clear') {
        const cleared = await options.store.clearCallerBase({
          guildId: interaction.guildId,
          guildName: interaction.guild.name,
          clanTag: entry.clanTag,
          warKey: entry.warKey,
          defenseMapPosition,
          actorDiscordUserId: interaction.user.id,
        });
        await interaction.reply({
          content: cleared
            ? `Cleared call for **#${defenseMapPosition} ${formatName(defense)}**.`
            : `No persisted call existed for **#${defenseMapPosition} ${formatName(defense)}**.`,
          ephemeral: true,
        });
        return;
      }

      const offenseMapPosition = interaction.options.getInteger('offense_target', true);
      const offense = memberAt(entry.offenseMembers, offenseMapPosition);
      if (!offense) {
        await interaction.reply({
          content: `Invalid offensive target #${offenseMapPosition} for the latest war snapshot.`,
          ephemeral: true,
        });
        return;
      }
      const hours = interaction.options.getNumber('hours');
      const note = interaction.options.getString('notes')?.trim() || null;
      const expiresAt =
        typeof hours === 'number' ? new Date(Date.now() + hours * 60 * 60 * 1000) : null;
      await options.store.assignCallerBase({
        guildId: interaction.guildId,
        guildName: interaction.guild.name,
        clanTag: entry.clanTag,
        warKey: entry.warKey,
        defenseMapPosition,
        offenseMapPosition,
        defenseTag: defense.tag ?? null,
        defenseName: defense.name ?? null,
        offenseTag: offense.tag ?? null,
        offenseName: offense.name ?? null,
        note,
        expiresAt,
        actorDiscordUserId: interaction.user.id,
      });
      await interaction.reply({
        content: `Assigned **#${offenseMapPosition} ${formatName(offense)}** to **#${defenseMapPosition} ${formatName(defense)}**. Persisted from the latest stored war snapshot; no live Clash API lookup was made.`,
        ephemeral: true,
      });
    },
  };
}

interface WarEntry {
  readonly clanTag: string;
  readonly warKey: string;
  readonly offenseMembers: readonly WarMember[];
  readonly defenseMembers: readonly WarMember[];
}

function toWarEntry(snapshot: CallerWarSnapshotRecord): WarEntry | null {
  const war = readWar(snapshot.snapshot);
  const state = (war.state ?? snapshot.state).toLowerCase().replace(/_/g, '');
  if (
    !war.clan?.members?.length ||
    !war.opponent?.members?.length ||
    state === 'notinwar' ||
    state === 'warended'
  )
    return null;
  const clanTag = snapshot.trackedClan?.clanTag ?? snapshot.clanTag;
  return {
    clanTag,
    warKey: snapshot.warKey ?? createWarKey(war, clanTag),
    offenseMembers: sortMembers(war.clan.members),
    defenseMembers: sortMembers(war.opponent.members),
  };
}

function readWar(value: unknown): WarData {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as WarData) : {};
}

function sortMembers(members: readonly WarMember[]): readonly WarMember[] {
  return [...members].sort((a, b) => (a.mapPosition ?? 999) - (b.mapPosition ?? 999));
}

function memberAt(members: readonly WarMember[], mapPosition: number): WarMember | null {
  return members.find((member, index) => (member.mapPosition ?? index + 1) === mapPosition) ?? null;
}

function createWarKey(war: WarData, fallbackClanTag: string): string {
  const start = war.preparationStartTime?.slice(0, 16) || 'latest';
  const tags = [war.clan?.tag ?? fallbackClanTag, war.opponent?.tag ?? 'opponent'].sort();
  return `${start}-${tags.join('-')}`.toLowerCase();
}

function formatName(member: WarMember): string {
  return escapeMarkdown(member.name ?? member.tag ?? 'Unknown');
}
