import {
  ActivityType,
  BaseInteraction,
  ChannelType,
  Collection,
  CommandInteraction,
  ForumChannel,
  Guild,
  GuildMember,
  MediaChannel,
  NewsChannel,
  PermissionsBitField,
  PermissionsString,
  TextChannel
} from 'discord.js';
import { createHash } from 'node:crypto';
import { Client } from '../struct/client.js';
import { Collections, FeatureFlags, Settings } from './constants.js';

export class ClientUtil {
  private readonly fetchRecords: Record<string, Date> = {};

  public constructor(private readonly client: Client) {}

  public async setPresence() {
    if (this.client.inMaintenance) return null;

    let guilds = 0;

    try {
      const values = [this.client.guilds.cache.size];
      guilds = values.reduce((acc, val) => acc + val, 0);
    } catch {}

    if (!guilds) return null;

    return this.client.user.setPresence({
      status: 'online',
      activities: [
        {
          type: ActivityType.Custom,
          name: `Watching ${guilds.toLocaleString()} servers`
        }
      ]
    });
  }

  public async getGuildMembers(
    interaction: BaseInteraction<'cached'> | Guild
  ): Promise<Collection<string, GuildMember>> {
    const guild = interaction instanceof Guild ? interaction : interaction.guild;
    if (this.client.cacheOverLimitGuilds.has(guild.id)) {
      return guild.members.cache;
    }

    this.client.cacheOverLimitGuilds.add(guild.id);
    setTimeout(() => {
      this.client.cacheOverLimitGuilds.delete(guild.id);
    }, 45 * 1000);

    try {
      try {
        const members = await guild.members.fetch({ time: 5000 });
        this.fetchRecords[guild.id] = new Date();
        return members;
      } catch (error) {
        throw new Error(error.message);
      }
    } catch (error) {
      console.error(error);
      this.client.logger.error(error, { label: 'ClientUtil' });

      return guild.members.cache;
    }
  }

  public setMaintenanceBreak(cleared = false) {
    if (cleared) return this.client.user.setPresence({ status: 'online', activities: [] });

    return this.client.user.setPresence({
      status: 'online',
      activities: [
        {
          type: ActivityType.Custom,
          name: 'Maintenance Break!'
        }
      ]
    });
  }

  public hasPermissions(channelId: string, permissions: PermissionsString[]) {
    const channel = this.getTextBasedChannel(channelId);
    if (channel) {
      if (
        channel.isThread() &&
        channel.permissionsFor(this.client.user.id)!.has(permissions) &&
        this.hasWebhookPermission(channel.parent!)
      ) {
        return { isThread: true, channel, parent: channel.parent! };
      }

      if (
        !channel.isThread() &&
        channel.permissionsFor(this.client.user)?.has(permissions) &&
        this.hasWebhookPermission(channel)
      ) {
        return { isThread: false, channel, parent: channel };
      }
    }

    return null;
  }

  public getTextBasedChannel(channelId: string) {
    const channel = this.client.channels.cache.get(channelId);
    if (channel) {
      if (
        (channel.isThread() && channel.parent) ||
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement
      ) {
        return channel;
      }
    }
    return null;
  }

  public createToken({ userId, guildId }: { userId: string; guildId: string }) {
    return Buffer.from(JSON.stringify({ userId, guildId, ts: Date.now() })).toString('base64');
  }

  public isManager(member: GuildMember, roleKey?: string | null) {
    if (this.client.isOwner(member.user)) return true;
    const managerRoleIds = this.client.settings.get<string[]>(
      member.guild,
      Settings.MANAGER_ROLE,
      []
    );
    const roleOverrides = roleKey
      ? this.client.settings.get<string[]>(member.guild, roleKey, [])
      : [];
    return (
      member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
      member.roles.cache.hasAny(...managerRoleIds) ||
      Boolean(roleOverrides.length && member.roles.cache.hasAny(...roleOverrides))
    );
  }

  public hasWebhookPermission(channel: TextChannel | NewsChannel | ForumChannel | MediaChannel) {
    return channel.permissionsFor(this.client.user.id)!.has(['ManageWebhooks', 'ViewChannel']);
  }

  public async isTrustedGuild(interaction: CommandInteraction) {
    if (!interaction.inCachedGuild()) return false;

    const isTrustedFlag = this.client.isFeatureEnabled(
      FeatureFlags.TRUSTED_GUILD,
      interaction.guildId
    );
    const isManager = this.client.util.isManager(interaction.member, Settings.LINKS_MANAGER_ROLE);
    if (!isManager) return false;

    return (
      isTrustedFlag ||
      this.client.settings.get(interaction.guildId, Settings.IS_TRUSTED_GUILD, false)
    );
  }

  // createOrUpdateSheet removed — exports now use CSV attachments
}
