import { Message } from 'discord.js';
import { Listener } from '../../lib/handlers.js';

export default class MessageCaptureListener extends Listener {
  public constructor() {
    super('messageCapture', {
      event: 'messageCreate',
      emitter: 'client',
      category: 'client'
    });
  }

  public exec(message: Message) {
    // Message count tracking removed (was Redis-backed). No-op for clashmate.
    if (!message.applicationId) return;
    if (message.applicationId !== this.client.user.id) return;
  }
}
