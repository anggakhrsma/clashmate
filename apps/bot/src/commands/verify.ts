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
    await interaction.reply({ content: INVALID_PLAYER_MESSAGE, ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  let player: ClashPlayer;
  try {
    player = await options.coc.getPlayer(playerTag);
  } catch {
    await interaction.editReply(
      `${INVALID_PLAYER_MESSAGE} Enter the player tag exactly as shown in-game, including the leading # if available.`,
    );
    return;
  }

  let isValidToken: boolean;
  try {
    isValidToken = await options.coc.verifyPlayerToken(player.tag, token);
  } catch {
    await interaction.editReply(TOKEN_CHECK_UNAVAILABLE_MESSAGE);
    return;
  }

  if (!isValidToken) {
    await interaction.editReply(INVALID_TOKEN_MESSAGE);
    return;
  }

  const result = await options.links.verifyPlayerLink({
    guildId: interaction.guildId,
    discordUserId: interaction.user.id,
    playerTag: player.tag,
  });

  if (result.status === 'max_accounts_reached') {
    await interaction.editReply(formatVerifyMaxAccountsFailure(player, result.maxAccounts));
    return;
  }

  await interaction.editReply(formatVerifySuccess(player, result));
}

export function formatVerifySuccess(
  player: Pick<ClashPlayer, 'name' | 'tag'>,
  result: Extract<VerifyPlayerLinkResult, { status: 'verified' }> = {
    status: 'verified',
    wasDefault: false,
  },
): string {
  const details: string[] = [];
  details.push('Source: verified directly against the Clash of Clans API token endpoint.');

  if (result.transferredFromUserId) {
    details.push(
      `Transfer: ownership proof moved the verified link from <@${result.transferredFromUserId}> to you.`,
    );
  } else {
    details.push('Transfer: no existing verified owner was replaced.');
  }

  if (result.wasDefault) {
    details.push('Default: this is now your default account.');
  } else {
    details.push('Default: your existing default account was not changed.');
  }

  details.push(VERIFY_CONTEXT_MESSAGE);
  details.push(VERIFY_LIMITATION_MESSAGE);

  const suffix = details.length ? ` ${details.join(' ')}` : '';
  return `Verification successful! **${player.name} (${player.tag})** ✅${suffix}`;
}

export function formatVerifyMaxAccountsFailure(
  player: Pick<ClashPlayer, 'name' | 'tag'>,
  maxAccounts: number,
): string {
  return [
    `Verification succeeded for **${player.name} (${player.tag})**, but the link was not saved because you already have the maximum account limit (${maxAccounts} accounts/user).`,
    'Remove an old link before verifying another account.',
    VERIFY_CONTEXT_MESSAGE,
    VERIFY_LIMITATION_MESSAGE,
  ].join(' ');
}
