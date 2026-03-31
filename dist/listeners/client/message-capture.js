import { Listener } from '../../lib/handlers.js';
export default class MessageCaptureListener extends Listener {
    constructor() {
        super('messageCapture', {
            event: 'messageCreate',
            emitter: 'client',
            category: 'client'
        });
    }
    exec(message) {
        // Message count tracking removed (was Redis-backed). No-op for clashmate.
        if (!message.applicationId)
            return;
        if (message.applicationId !== this.client.user.id)
            return;
    }
}
//# sourceMappingURL=message-capture.js.map