export const LogActions = {
    NAME_CHANGE: 'NAME_CHANGE',
    TOWN_HALL_UPGRADE: 'TOWN_HALL_UPGRADE',
    WAR_PREF_CHANGE: 'WAR_PREF_CHANGE',
    JOINED: 'JOINED',
    LEFT: 'LEFT',
    DEMOTED: 'DEMOTED',
    PROMOTED: 'PROMOTED',
    DONATED: 'DONATED',
    RECEIVED: 'RECEIVED',
    CAPITAL_GOLD_RAID: 'CAPITAL_GOLD_RAID',
    CAPITAL_GOLD_CONTRIBUTION: 'CAPITAL_GOLD_CONTRIBUTION',
    // Clan Types
    CLAN_LEVEL_UP: 'CLAN_LEVEL_UP',
    CAPITAL_HALL_LEVEL_UP: 'CAPITAL_HALL_LEVEL_UP',
    CAPITAL_LEAGUE_CHANGE: 'CAPITAL_LEAGUE_CHANGE',
    WAR_LEAGUE_CHANGE: 'WAR_LEAGUE_CHANGE'
};
export var ClanLogType;
(function (ClanLogType) {
    // MEMBER
    ClanLogType["CONTINUOUS_DONATION_LOG"] = "continuous_donation_log";
    ClanLogType["DAILY_DONATION_LOG"] = "daily_donation_log";
    ClanLogType["WEEKLY_DONATION_LOG"] = "weekly_donation_log";
    ClanLogType["MONTHLY_DONATION_LOG"] = "monthly_donation_log";
    // MEMBER
    ClanLogType["MEMBER_JOIN_LEAVE_LOG"] = "member_join_leave_log";
    // MEMBER_JOIN_LOG = 'member_join_log',
    // MEMBER_LEAVE_LOG = 'member_leave_log',
    ClanLogType["ROLE_CHANGE_LOG"] = "role_change_log";
    ClanLogType["TOWN_HALL_UPGRADE_LOG"] = "town_hall_upgrade_log";
    ClanLogType["NAME_CHANGE_LOG"] = "name_change_log";
    ClanLogType["RANKED_BATTLE_LEAGUE_CHANGE_LOG"] = "ranked_battle_league_change_log";
    // PLAYER
    ClanLogType["WAR_PREFERENCE_LOG"] = "war_preference_log";
    ClanLogType["HERO_UPGRADE_LOG"] = "hero_upgrade_log";
    // CLAN
    ClanLogType["CLAN_ACHIEVEMENTS_LOG"] = "clan_achievements_log";
    ClanLogType["CLAN_CAPITAL_CONTRIBUTION_LOG"] = "clan_capital_contribution_log";
    ClanLogType["CLAN_CAPITAL_RAID_LOG"] = "clan_capital_raid_log";
    // CLAN_CAPITAL_WEEKLY_IMAGE_LOG = 'clan_capital_weekly_image_log',
    ClanLogType["CLAN_CAPITAL_WEEKLY_SUMMARY_LOG"] = "clan_capital_weekly_summary_log";
    ClanLogType["CLAN_GAMES_EMBED_LOG"] = "clan_games_embed_log";
    ClanLogType["CLAN_EMBED_LOG"] = "clan_embed_log";
    ClanLogType["LAST_SEEN_EMBED_LOG"] = "last_seen_embed_log";
    // SUPER_TROOP_BOOSTS_EMBED_LOG = 'super_troop_boosts_embed_log',
    ClanLogType["WAR_EMBED_LOG"] = "war_embed_log";
    ClanLogType["WAR_MISSED_ATTACKS_LOG"] = "war_missed_attacks_log";
    ClanLogType["WAR_ATTACK_LOG"] = "war_attack_log";
    ClanLogType["CWL_ATTACK_LOG"] = "cwl_attack_log";
    ClanLogType["CWL_EMBED_LOG"] = "cwl_embed_log";
    ClanLogType["CWL_LINEUP_CHANGE_LOG"] = "cwl_lineup_change_log";
    ClanLogType["CWL_MISSED_ATTACKS_LOG"] = "cwl_missed_attacks_log";
    ClanLogType["CWL_MONTHLY_SUMMARY_LOG"] = "cwl_monthly_summary_log";
    // LEGEND
    ClanLogType["LEGEND_ATTACKS_DAILY_SUMMARY_LOG"] = "legend_attacks_daily_summary_log";
})(ClanLogType || (ClanLogType = {}));
//# sourceMappingURL=clan-logs.entity.js.map