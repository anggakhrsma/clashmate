import { REST, Routes } from 'discord.js';

import type { DiscordNotificationSender } from './notification-delivery-loop.js';

export function createDiscordRestNotificationSender(token: string): DiscordNotificationSender {
  const rest = new REST({ version: '10' }).setToken(token);

  return {
    sendChannelMessage: async (channelId, content) => {
      await rest.post(Routes.channelMessages(channelId), {
        body: {
          content,
          allowed_mentions: { parse: [] },
        },
      });
    },
  };
}
