import { ActionRow, Message, MessageActionRowComponent } from 'discord.js';
import { diff } from 'radash';
import { Listener } from '../../lib/handlers.js';

export default class MessageUpdateListener extends Listener {
  public constructor() {
    super('messageUpdate', {
      event: 'messageUpdate',
      emitter: 'client',
      category: 'client'
    });
  }

  public async exec(oldMessage: Message, newMessage: Message) {
    if (
      !(
        oldMessage.author?.id === this.client.user.id &&
        newMessage.author.id === this.client.user.id
      )
    )
      return;

    const oldIds = this.flattenCustomIds(oldMessage);
    const newIds = this.flattenCustomIds(newMessage);
    const disposed = diff(oldIds, newIds);

    // Clean up disposed component IDs from in-memory map
    for (const customId of disposed) {
      this.client.components.delete(customId);
    }
  }

  private flattenCustomIds(message: Message): string[] {
    return (message.components as ActionRow<MessageActionRowComponent>[])
      .flatMap((row) => row.components)
      .map((c) => c.customId as string)
      .filter((id) => id && /^CMD/.test(id));
  }
}
