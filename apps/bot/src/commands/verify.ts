import type { ClashPlayer } from '@clashmate/coc';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import { filterPlayerTagAutocompleteChoices } from './player.js';

export const VERIFY_COMMAND_NAME = 'verify';
export const VERIFY_COMMAND_DESCRIPTION = 'Verify and link a player account using an API token.';
export const INVALID_PLAYER_MESSAGE = 'This player or clan tag is not valid.';
export const INVALID_TOKEN_MESSAGE =
  "Verification failed: Clash of Clans says that token does not match this player. Copy the API Token from that player's in-game settings, check the tag, and try `/verify` again. This private reply did not change your saved links.";
export const TOKEN_CHECK_UNAVAILABLE_MESSAGE =
  'Verification failed: ClashMate could not check that API token with Clash of Clans right now. Your account link was not changed; please try again later.';
export const VERIFY_CONTEXT_MESSAGE =
  'This reply is private. ClashMate only uses your player tag and in-game API token to confirm ownership and does not store the token.';
export const VERIFY_LIMITATION_MESSAGE =
  'Verification links the player to your Discord account only; it does not enroll the player or clan into polling, tracking, or clan setup.';

function formatVerifyDiagnostics(lines: readonly string[]): string {
  return lines.map((line) => `• ${line}`).join('\n');
}

function formatVerifyTargetScope(guildId: string, discordUserId: string): string {
  return `Target user: <@${discordUserId}> in this server (${guildId}).`;
}

function formatNoPollingGuidance(): string {
  return 'No polling/clan setup: this only saves a verified account link; use clan setup/link commands separately when you want server tracking.';
}

export const verifyCommandData = new SlashCommandBuilder()
  .setName(VERIFY_COMMAND_NAME)
  .setDescription(VERIFY_COMMAND_DESCRIPTION)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('player')
      .setDescription('Tag of the player to verify.')
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((option) =>
    option
      .setName('token')
      .setDescription('API token that can be found in the game settings.')
      .setRequired(true),
  );

export interface VerifyCocApi {
  getPlayer: (playerTag: string) => Promise<ClashPlayer>;
  verifyPlayerToken: (playerTag: string, token: string) => Promise<boolean>;
}

export interface VerifyPlayerLinkStore {
  listPlayerTagsForUser?: (guildId: string, discordUserId: string) => Promise<string[]>;
  verifyPlayerLink: (input: {
    guildId: string;
    discordUserId: string;
    playerTag: string;
  }) => Promise<VerifyPlayerLinkResult>;
}

export type VerifyPlayerLinkResult =
  | {
      readonly status: 'verified';
      readonly wasDefault: boolean;
      readonly transferredFromUserId?: string;
    }
  | { readonly status: 'max_accounts_reached'; readonly maxAccounts: number };

export interface VerifyCommandOptions {
  readonly coc: VerifyCocApi;
  readonly links: VerifyPlayerLinkStore;
}

export function createVerifySlashCommand(options: VerifyCommandOptions): SlashCommandDefinition {
  return {
    name: VERIFY_COMMAND_NAME,
    data: verifyCommandData,
    execute: async (interaction, context) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== VERIFY_COMMAND_NAME) return;
      await executeVerify(interaction, context, options);
    },
    autocomplete: async (interaction) => {
      if (interaction.commandName !== VERIFY_COMMAND_NAME) return;
      await autocompleteVerify(interaction, options);
    },
  };
}

export async function autocompleteVerify(
  interaction: AutocompleteInteraction,
  options: { readonly links: Pick<VerifyPlayerLinkStore, 'listPlayerTagsForUser'> },
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'player') {
    await interaction.respond([]);
    return;
  }

  if (!options.links.listPlayerTagsForUser) {
    await interaction.respond([]);
    return;
  }

  try {
    const tags = await options.links.listPlayerTagsForUser(
      interaction.guildId,
      interaction.user.id,
    );
    await interaction.respond(
      filterPlayerTagAutocompleteChoices(tags, String(focused.value ?? '')),
    );
  } catch {
    await interaction.respond([]);
  }
}

export async function executeVerify(
  interaction: ChatInputCommandInteraction,
  _context: CommandContext,
  options: VerifyCommandOptions,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: '`/verify` can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const playerOption = interaction.options.getString('player', true);
  const token = interaction.options.getString('token', true);

  let playerTag: string;
  try {
    playerTag = normalizeClashTag(playerOption);
  } catch {
    await interaction.reply({
      content: [
        INVALID_PLAYER_MESSAGE,
        formatVerifyDiagnostics([
          `Player tag resolution: could not normalize \`${playerOption}\`.`,
          'Verification status: not checked.',
          'Failure guidance: enter the player tag exactly as shown in-game, including the leading # if available.',
          formatVerifyTargetScope(interaction.guildId, interaction.user.id),
          formatNoPollingGuidance(),
        ]),
      ].join('\n'),
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  let player: ClashPlayer;
  try {
    player = await options.coc.getPlayer(playerTag);
  } catch {
    await interaction.editReply(
      [
        INVALID_PLAYER_MESSAGE,
        formatVerifyDiagnostics([
          `Player tag resolution: \`${playerOption}\` normalized to \`${playerTag}\`, but no player was found.`,
          'Verification status: not checked.',
          'Linked account state: unchanged.',
          'Failure guidance: check that this is a player tag, not a clan tag, and try `/verify` again.',
          formatVerifyTargetScope(interaction.guildId, interaction.user.id),
          formatNoPollingGuidance(),
        ]),
      ].join('\n'),
    );
    return;
  }

  let isValidToken: boolean;
  try {
    isValidToken = await options.coc.verifyPlayerToken(player.tag, token);
  } catch {
    await interaction.editReply(
      [
        TOKEN_CHECK_UNAVAILABLE_MESSAGE,
        formatVerifyDiagnostics([
          `Player tag resolution: \`${playerOption}\` resolved to **${player.name} (${player.tag})**.`,
          'Verification status: Clash of Clans token check unavailable.',
          'Linked account state: unchanged.',
          'Failure guidance: wait a moment and try `/verify` again with the same in-game API token.',
          formatVerifyTargetScope(interaction.guildId, interaction.user.id),
          formatNoPollingGuidance(),
        ]),
      ].join('\n'),
    );
    return;
  }

  if (!isValidToken) {
    await interaction.editReply(
      [
        INVALID_TOKEN_MESSAGE,
        formatVerifyDiagnostics([
          `Player tag resolution: \`${playerOption}\` resolved to **${player.name} (${player.tag})**.`,
          'Verification status: token rejected by Clash of Clans.',
          'Linked account state: unchanged.',
          'Failure guidance: copy the API Token from that exact player account and rerun `/verify`.',
          formatVerifyTargetScope(interaction.guildId, interaction.user.id),
          formatNoPollingGuidance(),
        ]),
      ].join('\n'),
    );
    return;
  }

  const result = await options.links.verifyPlayerLink({
    guildId: interaction.guildId,
    discordUserId: interaction.user.id,
    playerTag: player.tag,
  });

  if (result.status === 'max_accounts_reached') {
    await interaction.editReply(
      formatVerifyMaxAccountsFailure(
        player,
        result.maxAccounts,
        formatVerifyTargetScope(interaction.guildId, interaction.user.id),
      ),
    );
    return;
  }

  await interaction.editReply(
    formatVerifySuccess(
      player,
      result,
      formatVerifyTargetScope(interaction.guildId, interaction.user.id),
    ),
  );
}

export function formatVerifySuccess(
  player: Pick<ClashPlayer, 'name' | 'tag'>,
  result: Extract<VerifyPlayerLinkResult, { status: 'verified' }> = {
    status: 'verified',
    wasDefault: false,
  },
  targetScope = 'Target user: you in this server.',
): string {
  const details: string[] = [];
  details.push(`Player tag resolution: saved canonical tag ${player.tag}.`);
  details.push('Verification status: token accepted by Clash of Clans.');

  if (result.transferredFromUserId) {
    details.push(
      `Linked account state: moved the verified link from <@${result.transferredFromUserId}> to you.`,
    );
  } else {
    details.push(
      'Linked account state: verified link saved; no existing verified owner was replaced.',
    );
  }

  if (result.wasDefault) {
    details.push('Default account: this is now your default account.');
  } else {
    details.push('Default account: your existing default account was not changed.');
  }

  details.push(targetScope);
  details.push(VERIFY_CONTEXT_MESSAGE);
  details.push(formatNoPollingGuidance());

  const suffix = details.length ? `\n${formatVerifyDiagnostics(details)}` : '';
  return `Verification successful! **${player.name} (${player.tag})** ✅${suffix}`;
}

export function formatVerifyMaxAccountsFailure(
  player: Pick<ClashPlayer, 'name' | 'tag'>,
  maxAccounts: number,
  targetScope = 'Target user: you in this server.',
): string {
  return [
    `Verification succeeded for **${player.name} (${player.tag})**, but the link was not saved because you already have the maximum account limit (${maxAccounts} accounts/user).`,
    formatVerifyDiagnostics([
      `Player tag resolution: saved canonical tag would be ${player.tag}.`,
      'Verification status: token accepted by Clash of Clans.',
      'Linked account state: unchanged because your account limit is full.',
      'Failure guidance: remove an old link before verifying another account.',
      targetScope,
      VERIFY_CONTEXT_MESSAGE,
      formatNoPollingGuidance(),
    ]),
  ].join(' ');
}
