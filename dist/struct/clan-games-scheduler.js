import { WebhookClient, escapeMarkdown } from 'discord.js';
import moment from 'moment';
import 'moment-duration-format';
import { ObjectId } from 'mongodb';
import { unique } from 'radash';
import { ORANGE_NUMBERS } from '../util/emojis.js';
import { Season, Util } from '../util/toolkit.js';
import { ReminderDeleteReasons } from './capital-raid-scheduler.js';
// fetch links from our db
export class ClanGamesScheduler {
    constructor(client) {
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
        Object.defineProperty(this, "schedulers", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "reminders", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "refreshRate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "queued", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        this.refreshRate = 5 * 60 * 1000;
        this.schedulers = this.client.db.collection("ClanGamesSchedulers" /* Collections.CLAN_GAMES_SCHEDULERS */);
        this.reminders = this.client.db.collection("ClanGamesReminders" /* Collections.CLAN_GAMES_REMINDERS */);
    }
    timings() {
        const startTime = moment().startOf('month').add(21, 'days').add(8, 'hours');
        const endTime = startTime.clone().add(6, 'days');
        return { startTime: startTime.toDate().getTime(), endTime: endTime.toDate().getTime() };
    }
    async init() {
        const watchStream = this.schedulers.watch([
            {
                $match: { operationType: { $in: ['insert', 'update', 'delete'] } }
            }
        ], { fullDocument: 'updateLookup' });
        watchStream.on('change', (change) => {
            if (change.operationType === 'insert') {
                const schedule = change.fullDocument;
                if (schedule.timestamp.getTime() < Date.now() + this.refreshRate) {
                    this.queue(schedule);
                }
            }
            if (change.operationType === 'delete') {
                const id = change.documentKey._id.toHexString();
                if (this.queued.has(id))
                    this.clear(id);
            }
            if (change.operationType === 'update') {
                const id = change.documentKey._id.toHexString();
                if (this.queued.has(id))
                    this.clear(id);
                const schedule = change.fullDocument;
                if (schedule &&
                    !schedule.triggered &&
                    schedule.timestamp.getTime() < Date.now() + this.refreshRate) {
                    this.queue(schedule);
                }
            }
        });
        await this._refresh();
        setInterval(this._refresh.bind(this), this.refreshRate).unref();
        await this._insert();
        setInterval(this._insert.bind(this), this.refreshRate + 25 * 60 * 1000).unref();
    }
    async _insert() {
        // single process - always runs
        const insertedSeasonId = this.client.settings.get('global', "clanGamesReminderTimestamp" /* Settings.CLAN_GAMES_REMINDER_TIMESTAMP */, '0');
        const currentSeasonId = Season.monthId;
        if (insertedSeasonId === currentSeasonId)
            return null;
        const { startTime, endTime } = this.timings();
        if (!(Date.now() >= startTime && Date.now() <= endTime))
            return null;
        this.client.logger.info(`Inserting new clan games schedules for season ${currentSeasonId}`, {
            label: 'ClanGamesScheduler'
        });
        const cursor = this.reminders.find();
        for await (const reminder of cursor) {
            await this.create(reminder);
        }
        this.client.settings.set('global', "clanGamesReminderTimestamp" /* Settings.CLAN_GAMES_REMINDER_TIMESTAMP */, currentSeasonId);
        this.client.logger.info(`Inserted new clan games schedules for season ${currentSeasonId}`, {
            label: 'ClanGamesScheduler'
        });
    }
    async create(reminder) {
        const { startTime, endTime } = this.timings();
        if (!(Date.now() >= startTime && Date.now() <= endTime))
            return;
        for (const tag of reminder.clans) {
            const { res, body: clan } = await this.client.coc.getClan(tag);
            if (!res.ok)
                continue;
            const rand = Math.random();
            const ms = endTime - reminder.duration;
            if (Date.now() > new Date(ms).getTime())
                continue;
            await this.schedulers.insertOne({
                _id: new ObjectId(),
                guild: reminder.guild,
                tag: clan.tag,
                name: clan.name,
                duration: reminder.duration,
                reminderId: reminder._id,
                source: `bot_${rand}`,
                triggered: false,
                timestamp: new Date(ms),
                createdAt: new Date()
            });
        }
    }
    async reSchedule(reminder) {
        await this.schedulers.deleteMany({ reminderId: reminder._id });
        return this.create(reminder);
    }
    queue(schedule) {
        if (this.client.settings.hasCustomBot(schedule.guild) && !false)
            return;
        if (!this.client.guilds.cache.has(schedule.guild))
            return;
        this.queued.set(schedule._id.toHexString(), setTimeout(() => {
            this.trigger(schedule);
        }, schedule.timestamp.getTime() - Date.now()));
    }
    async delete(schedule, reason) {
        if (!this.client.guilds.cache.has(schedule.guild))
            return;
        this.clear(schedule._id.toHexString());
        return this.schedulers.updateOne({ _id: schedule._id }, { $set: { triggered: true, reason } });
    }
    clear(id) {
        const timeoutId = this.queued.get(id);
        if (timeoutId)
            clearTimeout(timeoutId);
        return this.queued.delete(id);
    }
    async query(clan) {
        const fetched = await this.client.coc._getPlayers(clan.memberList);
        const clanMembers = fetched.map((data) => {
            const value = data.achievements.find((a) => a.name === 'Games Champion')?.value ?? 0;
            return {
                tag: data.tag,
                name: data.name,
                points: value,
                role: data.role,
                townHallLevel: data.townHallLevel
            };
        });
        const dbMembers = await this.client.db
            .collection("ClanGamesPoints" /* Collections.CLAN_GAMES_POINTS */)
            .aggregate([
            {
                $match: { tag: { $in: clan.memberList.map((mem) => mem.tag) }, season: Season.monthId }
            },
            {
                $limit: 60
            }
        ])
            .toArray();
        const members = [];
        for (const member of clanMembers) {
            const mem = dbMembers.find((m) => m.tag === member.tag);
            if (mem && !mem.__clans.includes(clan.tag))
                continue;
            members.push({
                ...member,
                points: mem ? member.points - mem.initial : 0
            });
        }
        return members;
    }
    async getReminderText(reminder, schedule) {
        const { res, body: clan } = await this.client.coc.getClan(schedule.tag);
        if (res.status === 503)
            throw new Error('MaintenanceBreak');
        if (!res.ok)
            return [null, []];
        const clanMembers = await this.query(clan);
        const maxParticipants = clanMembers.filter((mem) => mem.points >= 1).length;
        const members = clanMembers
            .filter((mem) => {
            return (mem.points <
                (reminder.minPoints === 0 ? Util.getClanGamesMaxPoints() : reminder.minPoints));
        })
            .filter((m) => (reminder.allMembers ? m.points >= 0 : m.points >= 1))
            .filter((mem) => (maxParticipants >= 50 ? mem.points >= 1 : true))
            .filter((mem) => {
            if (reminder.roles.length === 4)
                return true;
            return reminder.roles.includes(mem.role);
        });
        if (!members.length)
            return [null, []];
        const links = await this.client.resolver.getLinkedUsers(members);
        const mentions = [];
        for (const member of members) {
            const link = links.find((link) => link.tag === member.tag);
            if (!link && reminder.linkedOnly)
                continue;
            mentions.push({
                id: link ? link.userId : '0x',
                mention: link ? `<@${link.userId}>` : '0x',
                name: member.name,
                townHallLevel: member.townHallLevel,
                tag: member.tag,
                points: member.points
            });
        }
        if (!mentions.length)
            return [null, []];
        const userIds = unique(mentions.map((m) => m.id).filter((id) => id !== '0x'));
        const users = Object.entries(mentions.reduce((acc, cur) => {
            acc[cur.mention] ??= [];
            acc[cur.mention].push(cur);
            return acc;
        }, {}));
        users.sort(([a], [b]) => {
            if (a === '0x')
                return 1;
            if (b === '0x')
                return -1;
            return 0;
        });
        const { endTime } = this.timings();
        const warTiming = moment
            .duration(endTime - Date.now())
            .format('D[d] H[h], m[m]', { trim: 'both mid' });
        const clanNick = await this.client.storage.getNickname(reminder.guild, clan.tag, clan.name);
        const text = [
            `\u200e🔔 **${clanNick} (Clan Games ends in ${warTiming})**`,
            `📨 ${reminder.message}`,
            '',
            users
                .map(([mention, members]) => members
                .map((mem, i) => {
                const ping = i === 0 && mention !== '0x' ? ` ${mention}` : '';
                const hits = ` (${mem.points}/${reminder.minPoints === 0 ? Util.getClanGamesMaxPoints() : reminder.minPoints})`;
                const prefix = mention === '0x' && i === 0 ? '\n' : '\u200e';
                return `${prefix}${ORANGE_NUMBERS[mem.townHallLevel]} ${ping} ${escapeMarkdown(mem.name)}${hits}`;
            })
                .join('\n'))
                .join('\n')
        ].join('\n');
        const config = this.getExclusionConfig(reminder.guild);
        if (config.type && config.gamesExclusionUserIds?.length) {
            return [`${text} \n\n-# Ping Exclusion Enabled`, userIds];
        }
        return [text, userIds];
    }
    async trigger(schedule) {
        const id = schedule._id.toHexString();
        try {
            const reminder = await this.reminders.findOne({ _id: schedule.reminderId });
            if (!reminder)
                return await this.delete(schedule, ReminderDeleteReasons.REMINDER_NOT_FOUND);
            if (!this.client.channels.cache.has(reminder.channel))
                return await this.delete(schedule, ReminderDeleteReasons.CHANNEL_NOT_FOUND);
            const { endTime } = this.timings();
            if (endTime < Date.now())
                return await this.delete(schedule, ReminderDeleteReasons.TOO_LATE);
            const guild = this.client.guilds.cache.get(reminder.guild);
            if (!guild)
                return await this.delete(schedule, ReminderDeleteReasons.GUILD_NOT_FOUND);
            const [text, userIds] = await this.getReminderText(reminder, schedule);
            if (!text)
                return await this.delete(schedule, ReminderDeleteReasons.NO_RECIPIENT);
            const channel = this.client.util.hasPermissions(reminder.channel, [
                'SendMessages',
                'UseExternalEmojis',
                'ViewChannel',
                'ManageWebhooks'
            ]);
            if (channel) {
                if (channel.isThread)
                    reminder.threadId = channel.channel.id;
                const webhook = reminder.webhook
                    ? new WebhookClient(reminder.webhook)
                    : await this.webhook(channel.parent, reminder);
                for (const content of Util.splitMessage(`${text}\n\u200b`)) {
                    if (webhook)
                        await this.deliver({ reminder, channel: channel.parent, webhook, content, userIds });
                }
            }
            else {
                return await this.delete(schedule, ReminderDeleteReasons.CHANNEL_MISSING_PERMISSIONS);
            }
        }
        catch (error) {
            this.client.logger.error(error, { label: 'REMINDER' });
            return this.clear(id);
        }
        return this.delete(schedule, ReminderDeleteReasons.REMINDER_SENT_SUCCESSFULLY);
    }
    async deliver({ reminder, channel, content, userIds, webhook }) {
        try {
            return await webhook.send({
                content,
                allowedMentions: this.allowedMentions(reminder, userIds),
                threadId: reminder.threadId
            });
        }
        catch (error) {
            // Unknown Webhook / Unknown Channel
            if ([10015, 10003].includes(error.code) && channel) {
                const webhook = await this.webhook(channel, reminder);
                if (webhook)
                    return webhook.send({
                        content,
                        allowedMentions: this.allowedMentions(reminder, userIds),
                        threadId: reminder.threadId
                    });
            }
            throw error;
        }
    }
    async webhook(channel, reminder) {
        const webhook = await this.client.storage.getWebhook(channel).catch(() => null);
        if (webhook) {
            reminder.webhook = { id: webhook.id, token: webhook.token };
            await this.reminders.updateOne({ _id: reminder._id }, { $set: { webhook: { id: webhook.id, token: webhook.token } } });
            return new WebhookClient({ id: webhook.id, token: webhook.token });
        }
        return null;
    }
    allowedMentions(reminder, userIds) {
        const config = this.getExclusionConfig(reminder.guild);
        const guild = this.client.guilds.cache.get(reminder.guild);
        if (!config.games || !guild)
            return { parse: ['users'] };
        if (config.type === 'optIn') {
            return {
                parse: [],
                users: userIds.filter((id) => config.gamesExclusionUserIds.includes(id))
            };
        }
        return { parse: [], users: userIds.filter((id) => !config.gamesExclusionUserIds.includes(id)) };
    }
    getExclusionConfig(guildId) {
        return this.client.settings.get(guildId, "reminderExclusion" /* Settings.REMINDER_EXCLUSION */, {
            type: 'optIn',
            gamesExclusionUserIds: []
        });
    }
    async _refresh() {
        const cursor = this.schedulers.find({
            timestamp: { $lt: new Date(Date.now() + this.refreshRate) }
        });
        const now = new Date().getTime();
        for await (const schedule of cursor) {
            if (schedule.triggered)
                continue;
            if (this.client.inMaintenance)
                continue;
            if (!this.client.guilds.cache.has(schedule.guild))
                continue;
            if (this.queued.has(schedule._id.toHexString()))
                continue;
            if (this.client.settings.hasCustomBot(schedule.guild) && !false)
                continue;
            if (schedule.timestamp.getTime() < now) {
                this.trigger(schedule);
            }
            else {
                this.queue(schedule);
            }
        }
    }
}
//# sourceMappingURL=clan-games-scheduler.js.map