import moment from 'moment';
import 'moment-duration-format';
import { EMOJIS } from '../util/emojis.js';
import { i18n } from '../util/i18n.js';
const SUPPORT_SERVER_GENERAL_CHANNEL_ID = '609074828707758150';
export class MaintenanceLog {
    constructor(enqueuer) {
        Object.defineProperty(this, "_maintenanceTimestamp", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "inMaintenance", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "startTime", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "redisKey", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'maintenance_start_timestamp'
        });
        this.client = enqueuer.client;
        this.startTime = null;
        this.inMaintenance = Boolean(false);
    }
    async init() {
        try {
            const timestamp = this._maintenanceTimestamp;
            if (timestamp) {
                this.inMaintenance = Boolean(true);
                this.client.inMaintenance = Boolean(true);
                this.startTime = new Date(Number(timestamp));
            }
        }
        catch { }
        return this.check();
    }
    async check() {
        try {
            const { res } = await this.client.coc.getClans({
                minMembers: Math.floor(Math.random() * 40) + 10,
                limit: 1
            });
            if (res.status === 503 && !this.inMaintenance) {
                this.inMaintenance = Boolean(true);
                this.client.enqueuer.flush();
                this.startTime = new Date();
                this.sendMessages();
                this.client.inMaintenance = Boolean(true);
                this.client.util.setMaintenanceBreak(false);
                await this.updateTimestamp(this.startTime);
            }
            if (res.status === 200 && this.inMaintenance) {
                const duration = Date.now() - this.startTime.getTime();
                if (duration > 60_000) {
                    this.inMaintenance = Boolean(false);
                    this.startTime = null;
                    this.sendMessages(duration);
                    this.client.enqueuer.init();
                    this.client.inMaintenance = Boolean(false);
                    this.client.util.setMaintenanceBreak(true);
                    await this.updateTimestamp(this.startTime);
                }
            }
        }
        finally {
            setTimeout(this.check.bind(this), 30000);
        }
    }
    sendMessages(dur = 0) {
        this.client.logger.info(this.getMessage(), { label: MaintenanceLog.name });
        this.deliverMessages(dur);
        this.sendSupportServerMessage(dur);
    }
    async deliverMessages(dur = 0) {
        for (const setting of this.client.settings.flatten()) {
            if (!setting.eventsChannel)
                continue;
            if (setting.eventsChannel === SUPPORT_SERVER_GENERAL_CHANNEL_ID)
                continue;
            if (this.client.settings.hasCustomBot(setting.guildId) && !false)
                continue;
            const channel = this.client.channels.cache.get(setting.eventsChannel);
            if (channel?.isTextBased() &&
                channel
                    .permissionsFor(this.client.user)
                    ?.has(['SendMessages', 'ViewChannel', 'UseExternalEmojis'])) {
                const message = i18n(this.inMaintenance ? 'common.maintenance_start' : 'common.maintenance_end', {
                    lng: channel.guild.preferredLocale,
                    duration: `(Started ${this.dur(dur)} ago)`
                });
                await channel.send(`**${EMOJIS.COC_LOGO} ${message}**`);
            }
        }
    }
    async sendSupportServerMessage(dur = 0) {
        const channel = this.client.channels.cache.get(SUPPORT_SERVER_GENERAL_CHANNEL_ID);
        if (channel)
            await channel.send(`**${EMOJIS.COC_LOGO} ${this.getMessage(dur)}**`);
    }
    getMessage(dur = 0) {
        if (this.inMaintenance)
            return `Maintenance break has started!`;
        return `Maintenance break is ending soon! (Started ${this.dur(dur)} ago)`;
    }
    dur(ms) {
        return moment.duration(ms).format('D[d], H[h], m[m]', { trim: 'both mid' });
    }
    async updateTimestamp(timestamp) {
        this.startTime = timestamp;
        try {
            if (!timestamp) {
                this._maintenanceTimestamp = null;
                return;
            }
            this._maintenanceTimestamp = timestamp.getTime().toString();
        }
        catch { }
    }
}
//# sourceMappingURL=maintenance-log.js.map