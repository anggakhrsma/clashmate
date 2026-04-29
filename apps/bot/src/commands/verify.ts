import type { ClashPlayer } from '@clashmate/coc';
import type { CommandContext, SlashCommandDefinition } from '@clashmate/discord';
import { normalizeClashTag } from '@clashmate/shared';
import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

export const VERIFY_COMMAND_NAME = 'verify';
export const VERIFY_COMMAND_DESCRIPTION = 'Verify and link a player account using an API token.';
export const INVALID_PLAYER_MESSAGE = 'This player or clan tag is not valid.';
export const INVALID_TOKEN_MESSAGE =
  'You must provide a valid API Token that can be found in the game settings.';

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
  };
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
    await interaction.editReply(INVALID_PLAYER_MESSAGE);
    return;
  }

  let isValidToken: boolean;
  try {
    isValidToken = await options.coc.verifyPlayerToken(player.tag, token);
  } catch {
    await interaction.editReply(INVALID_TOKEN_MESSAGE);
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
    await interaction.editReply(
      `The maximum account limit has been reached. (${result.maxAccounts} accounts/user)`,
    );
    return;
  }

  await interaction.editReply(formatVerifySuccess(player));
}

export function formatVerifySuccess(player: Pick<ClashPlayer, 'name' | 'tag'>): string {
  return `Verification successful! **${player.name} (${player.tag})** ✅`;
}
