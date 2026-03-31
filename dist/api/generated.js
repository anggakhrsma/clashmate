/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */
export var WarTypes;
(function (WarTypes) {
    WarTypes[WarTypes["REGULAR"] = 1] = "REGULAR";
    WarTypes[WarTypes["FRIENDLY"] = 2] = "FRIENDLY";
    WarTypes[WarTypes["CWL"] = 3] = "CWL";
})(WarTypes || (WarTypes = {}));
export var UserRoles;
(function (UserRoles) {
    UserRoles["USER"] = "user";
    UserRoles["ADMIN"] = "admin";
    UserRoles["VIEWER"] = "viewer";
    UserRoles["FETCH_WARS"] = "fetch:wars";
    UserRoles["FETCH_CLANS"] = "fetch:clans";
    UserRoles["FETCH_PLAYERS"] = "fetch:players";
    UserRoles["FETCH_LEGENDS"] = "fetch:legends";
    UserRoles["FETCH_LINKS"] = "fetch:links";
    UserRoles["MANAGE_LINKS"] = "manage:links";
    UserRoles["MANAGE_ROSTERS"] = "manage:rosters";
    UserRoles["MANAGE_REMINDERS"] = "manage:reminders";
})(UserRoles || (UserRoles = {}));
export var ErrorCodes;
(function (ErrorCodes) {
    ErrorCodes["FORBIDDEN"] = "FORBIDDEN";
    ErrorCodes["UNAUTHORIZED"] = "UNAUTHORIZED";
    ErrorCodes["NOT_FOUND"] = "NOT_FOUND";
    ErrorCodes["BAD_REQUEST"] = "BAD_REQUEST";
    ErrorCodes["INTERNAL_SERVER_ERROR"] = "INTERNAL_SERVER_ERROR";
    ErrorCodes["HANDOFF_TOKEN_EXPIRED"] = "HANDOFF_TOKEN_EXPIRED";
    ErrorCodes["USER_BLOCKED"] = "USER_BLOCKED";
    ErrorCodes["INVALID_PASSKEY"] = "INVALID_PASSKEY";
    ErrorCodes["GUILD_ACCESS_FORBIDDEN"] = "GUILD_ACCESS_FORBIDDEN";
})(ErrorCodes || (ErrorCodes = {}));
import axios from "axios";
export var ContentType;
(function (ContentType) {
    ContentType["Json"] = "application/json";
    ContentType["JsonApi"] = "application/vnd.api+json";
    ContentType["FormData"] = "multipart/form-data";
    ContentType["UrlEncoded"] = "application/x-www-form-urlencoded";
    ContentType["Text"] = "text/plain";
})(ContentType || (ContentType = {}));
export class HttpClient {
    constructor({ securityWorker, secure, format, ...axiosConfig } = {}) {
        Object.defineProperty(this, "instance", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "securityData", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "securityWorker", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "secure", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "format", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "setSecurityData", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (data) => {
                this.securityData = data;
            }
        });
        Object.defineProperty(this, "request", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: async ({ secure, path, type, query, format, body, ...params }) => {
                const secureParams = ((typeof secure === "boolean" ? secure : this.secure) &&
                    this.securityWorker &&
                    (await this.securityWorker(this.securityData))) ||
                    {};
                const requestParams = this.mergeRequestParams(params, secureParams);
                const responseFormat = format || this.format || undefined;
                if (type === ContentType.FormData &&
                    body &&
                    body !== null &&
                    typeof body === "object") {
                    body = this.createFormData(body);
                }
                if (type === ContentType.Text &&
                    body &&
                    body !== null &&
                    typeof body !== "string") {
                    body = JSON.stringify(body);
                }
                return this.instance.request({
                    ...requestParams,
                    headers: {
                        ...(requestParams.headers || {}),
                        ...(type ? { "Content-Type": type } : {}),
                    },
                    params: query,
                    responseType: responseFormat,
                    data: body,
                    url: path,
                });
            }
        });
        this.instance = axios.create({
            ...axiosConfig,
            baseURL: axiosConfig.baseURL || "/v1",
        });
        this.secure = secure;
        this.format = format;
        this.securityWorker = securityWorker;
    }
    mergeRequestParams(params1, params2) {
        const method = params1.method || (params2 && params2.method);
        return {
            ...this.instance.defaults,
            ...params1,
            ...(params2 || {}),
            headers: {
                ...((method &&
                    this.instance.defaults.headers[method.toLowerCase()]) ||
                    {}),
                ...(params1.headers || {}),
                ...((params2 && params2.headers) || {}),
            },
        };
    }
    stringifyFormItem(formItem) {
        if (typeof formItem === "object" && formItem !== null) {
            return JSON.stringify(formItem);
        }
        else {
            return `${formItem}`;
        }
    }
    createFormData(input) {
        if (input instanceof FormData) {
            return input;
        }
        return Object.keys(input || {}).reduce((formData, key) => {
            const property = input[key];
            const propertyContent = property instanceof Array ? property : [property];
            for (const formItem of propertyContent) {
                const isFileType = formItem instanceof Blob || formItem instanceof File;
                formData.append(key, isFileType ? formItem : this.stringifyFormItem(formItem));
            }
            return formData;
        }, new FormData());
    }
}
/**
 * @title ClashPerk Discord Bot API
 * @version v2.0.1
 * @baseUrl /v1
 * @contact
 *
 * ### API Routes for ClashPerk Discord Bot and Services
 *
 * API endpoints are protected by **Cloudflare** with a global rate limit of **300 requests per 10 seconds**.<br/>Response **caching is enabled**, with duration varying across different endpoints for optimal performance.<br/>API **access is limited** and reviewed individually. If you'd like to request access, reach out to us on Discord.
 *
 * By using this API, you agree to fair usage. Access may be revoked for abuse, misuse, or security violations.
 *
 * [Join our Discord](https://discord.gg/ppuppun) | [Terms of Service](https://clashperk.com/terms) | [Privacy Policy](https://clashperk.com/privacy)
 */
export class Api {
    constructor(http) {
        Object.defineProperty(this, "http", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "auth", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {
                /**
                 * @description Authenticates a user using a `passKey` and returns an `accessToken` with a limited validity period (2 hours). Once the token expires, a new token must be generated.<br/><br/>The `accessToken` must be included in all protected API requests using the following header `Authorization: Bearer <accessToken>`
                 *
                 * @tags Auth
                 * @name Login
                 * @summary Authenticate with your passKey to receive an accessToken required for authorized API requests.
                 * @request POST:/auth/login
                 * @response `201` `LoginData`
                 * @response `500` `ErrorResponseDto`
                 */
                login: (data, params = {}) => this.http.request({
                    path: `/auth/login`,
                    method: "POST",
                    body: data,
                    type: ContentType.Json,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Auth
                 * @name GeneratePasskey
                 * @summary Generate a passKey required for authentication.
                 * @request POST:/auth/generate-passkey
                 * @secure
                 * @response `201` `GeneratePasskeyData`
                 * @response `500` `ErrorResponseDto`
                 */
                generatePasskey: (data, params = {}) => this.http.request({
                    path: `/auth/generate-passkey`,
                    method: "POST",
                    body: data,
                    secure: true,
                    type: ContentType.Json,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Auth
                 * @name GetAuthUser
                 * @request GET:/auth/users/{userId}
                 * @secure
                 * @response `200` `GetAuthUserData`
                 * @response `500` `ErrorResponseDto`
                 */
                getAuthUser: ({ userId, ...query }, params = {}) => this.http.request({
                    path: `/auth/users/${userId}`,
                    method: "GET",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Auth
                 * @name DecodeHandoffToken
                 * @request GET:/auth/handoff/{token}
                 * @secure
                 * @response `200` `DecodeHandoffTokenData`
                 * @response `500` `ErrorResponseDto`
                 */
                decodeHandoffToken: ({ token, ...query }, params = {}) => this.http.request({
                    path: `/auth/handoff/${token}`,
                    method: "GET",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Auth
                 * @name CreateHandoffToken
                 * @request POST:/auth/handoff
                 * @secure
                 * @response `201` `CreateHandoffTokenData`
                 * @response `500` `ErrorResponseDto`
                 */
                createHandoffToken: (data, params = {}) => this.http.request({
                    path: `/auth/handoff`,
                    method: "POST",
                    body: data,
                    secure: true,
                    type: ContentType.Json,
                    format: "json",
                    ...params,
                }),
            }
        });
        Object.defineProperty(this, "links", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {
                /**
                 * No description
                 *
                 * @tags Links
                 * @name Link
                 * @request POST:/links
                 * @secure
                 * @response `201` `LinkData`
                 * @response `500` `ErrorResponseDto`
                 */
                link: (data, params = {}) => this.http.request({
                    path: `/links`,
                    method: "POST",
                    body: data,
                    secure: true,
                    type: ContentType.Json,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Links
                 * @name Unlink
                 * @request DELETE:/links/{playerTag}
                 * @secure
                 * @response `200` `UnlinkData`
                 * @response `500` `ErrorResponseDto`
                 */
                unlink: ({ playerTag, ...query }, params = {}) => this.http.request({
                    path: `/links/${playerTag}`,
                    method: "DELETE",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * @description ``` You can send either "playerTags" or "userIds", not both or none. Max size is 100. ```
                 *
                 * @tags Links
                 * @name GetLinks
                 * @summary Get links by playerTags or userIds
                 * @request POST:/links/query
                 * @secure
                 * @response `200` `GetLinksData`
                 * @response `500` `ErrorResponseDto`
                 */
                getLinks: (data, params = {}) => this.http.request({
                    path: `/links/query`,
                    method: "POST",
                    body: data,
                    secure: true,
                    type: ContentType.Json,
                    format: "json",
                    ...params,
                }),
            }
        });
        Object.defineProperty(this, "clans", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {
                /**
                 * No description
                 *
                 * @tags Clans
                 * @name GetLastSeen
                 * @request GET:/clans/{clanTag}/lastseen
                 * @secure
                 * @response `200` `GetLastSeenData`
                 * @response `500` `ErrorResponseDto`
                 */
                getLastSeen: ({ clanTag, ...query }, params = {}) => this.http.request({
                    path: `/clans/${clanTag}/lastseen`,
                    method: "GET",
                    secure: true,
                    format: "json",
                    ...params,
                }),
            }
        });
        Object.defineProperty(this, "players", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {
                /**
                 * No description
                 *
                 * @tags Players
                 * @name GetClanHistory
                 * @request GET:/players/{playerTag}/history
                 * @secure
                 * @response `200` `GetClanHistoryData`
                 * @response `500` `ErrorResponseDto`
                 */
                getClanHistory: ({ playerTag, ...query }, params = {}) => this.http.request({
                    path: `/players/${playerTag}/history`,
                    method: "GET",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Players
                 * @name GetAttackHistory
                 * @request GET:/players/{playerTag}/wars
                 * @secure
                 * @response `200` `GetAttackHistoryData`
                 * @response `500` `ErrorResponseDto`
                 */
                getAttackHistory: ({ playerTag, ...query }, params = {}) => this.http.request({
                    path: `/players/${playerTag}/wars`,
                    method: "GET",
                    query: query,
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Players
                 * @name AggregateAttackHistory
                 * @request GET:/players/{playerTag}/wars/aggregate
                 * @secure
                 * @response `200` `AggregateAttackHistoryData`
                 * @response `500` `ErrorResponseDto`
                 */
                aggregateAttackHistory: ({ playerTag, ...query }, params = {}) => this.http.request({
                    path: `/players/${playerTag}/wars/aggregate`,
                    method: "GET",
                    query: query,
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Players
                 * @name AggregateClanWarLeagueHistory
                 * @request GET:/players/{playerTag}/clan-war-leagues/aggregate
                 * @secure
                 * @response `200` `AggregateClanWarLeagueHistoryData`
                 * @response `500` `ErrorResponseDto`
                 */
                aggregateClanWarLeagueHistory: ({ playerTag, ...query }, params = {}) => this.http.request({
                    path: `/players/${playerTag}/clan-war-leagues/aggregate`,
                    method: "GET",
                    query: query,
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Players
                 * @name AddPlayerAccount
                 * @request PUT:/players/{playerTag}
                 * @secure
                 * @response `200` `AddPlayerAccountData`
                 * @response `500` `ErrorResponseDto`
                 */
                addPlayerAccount: ({ playerTag, ...query }, params = {}) => this.http.request({
                    path: `/players/${playerTag}`,
                    method: "PUT",
                    secure: true,
                    format: "json",
                    ...params,
                }),
            }
        });
        Object.defineProperty(this, "legends", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {
                /**
                 * No description
                 *
                 * @tags Legends
                 * @name GetLegendRankingThresholds
                 * @request GET:/legends/ranking-thresholds
                 * @secure
                 * @response `200` `GetLegendRankingThresholdsData`
                 * @response `500` `ErrorResponseDto`
                 */
                getLegendRankingThresholds: (params = {}) => this.http.request({
                    path: `/legends/ranking-thresholds`,
                    method: "GET",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Legends
                 * @name GetLeaderboard
                 * @request POST:/legends/leaderboard/query
                 * @secure
                 * @response `201` `GetLeaderboardData`
                 * @response `500` `ErrorResponseDto`
                 */
                getLeaderboard: (data, params = {}) => this.http.request({
                    path: `/legends/leaderboard/query`,
                    method: "POST",
                    body: data,
                    secure: true,
                    type: ContentType.Json,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Legends
                 * @name GetLegendAttacks
                 * @request POST:/legends/attacks/query
                 * @secure
                 * @response `200` `GetLegendAttacksData`
                 * @response `500` `ErrorResponseDto`
                 */
                getLegendAttacks: (data, params = {}) => this.http.request({
                    path: `/legends/attacks/query`,
                    method: "POST",
                    body: data,
                    secure: true,
                    type: ContentType.Json,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Legends
                 * @name GetLegendAttacksByPlayerTag
                 * @request GET:/legends/{playerTag}/attacks
                 * @secure
                 * @response `200` `GetLegendAttacksByPlayerTagData`
                 * @response `500` `ErrorResponseDto`
                 */
                getLegendAttacksByPlayerTag: ({ playerTag, ...query }, params = {}) => this.http.request({
                    path: `/legends/${playerTag}/attacks`,
                    method: "GET",
                    secure: true,
                    format: "json",
                    ...params,
                }),
            }
        });
        Object.defineProperty(this, "wars", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {
                /**
                 * No description
                 *
                 * @tags Wars
                 * @name GetClanWarLeagueGroups
                 * @request GET:/wars/{clanTag}/clan-war-leagues/groups
                 * @secure
                 * @response `200` `GetClanWarLeagueGroupsData`
                 * @response `500` `ErrorResponseDto`
                 */
                getClanWarLeagueGroups: ({ clanTag, ...query }, params = {}) => this.http.request({
                    path: `/wars/${clanTag}/clan-war-leagues/groups`,
                    method: "GET",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Wars
                 * @name GetClanWarLeagueForClan
                 * @request GET:/wars/{clanTag}/clan-war-leagues/clan
                 * @secure
                 * @response `200` `GetClanWarLeagueForClanData`
                 * @response `500` `ErrorResponseDto`
                 */
                getClanWarLeagueForClan: ({ clanTag, ...query }, params = {}) => this.http.request({
                    path: `/wars/${clanTag}/clan-war-leagues/clan`,
                    method: "GET",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Wars
                 * @name GetClanWar
                 * @request GET:/wars/{clanTag}/{warId}
                 * @secure
                 * @response `200` `GetClanWarData`
                 * @response `500` `ErrorResponseDto`
                 */
                getClanWar: ({ clanTag, warId, ...query }, params = {}) => this.http.request({
                    path: `/wars/${clanTag}/${warId}`,
                    method: "GET",
                    secure: true,
                    format: "json",
                    ...params,
                }),
            }
        });
        Object.defineProperty(this, "rosters", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {
                /**
                 * No description
                 *
                 * @tags Rosters
                 * @name GetRosters
                 * @request GET:/rosters/{guildId}/list
                 * @secure
                 * @response `200` `GetRostersData`
                 * @response `500` `ErrorResponseDto`
                 */
                getRosters: ({ guildId, ...query }, params = {}) => this.http.request({
                    path: `/rosters/${guildId}/list`,
                    method: "GET",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Rosters
                 * @name CreateRoster
                 * @request POST:/rosters/{guildId}/create
                 * @secure
                 * @response `201` `CreateRosterData`
                 * @response `500` `ErrorResponseDto`
                 */
                createRoster: ({ rosterId, guildId, ...query }, params = {}) => this.http.request({
                    path: `/rosters/${guildId}/create`,
                    method: "POST",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Rosters
                 * @name GetRoster
                 * @request GET:/rosters/{guildId}/{rosterId}
                 * @secure
                 * @response `200` `GetRosterData`
                 * @response `500` `ErrorResponseDto`
                 */
                getRoster: ({ rosterId, guildId, ...query }, params = {}) => this.http.request({
                    path: `/rosters/${guildId}/${rosterId}`,
                    method: "GET",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Rosters
                 * @name UpdateRoster
                 * @request PATCH:/rosters/{guildId}/{rosterId}
                 * @secure
                 * @response `200` `UpdateRosterData`
                 * @response `500` `ErrorResponseDto`
                 */
                updateRoster: ({ rosterId, guildId, ...query }, params = {}) => this.http.request({
                    path: `/rosters/${guildId}/${rosterId}`,
                    method: "PATCH",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Rosters
                 * @name DeleteRoster
                 * @request DELETE:/rosters/{guildId}/{rosterId}
                 * @secure
                 * @response `200` `DeleteRosterData`
                 * @response `500` `ErrorResponseDto`
                 */
                deleteRoster: ({ rosterId, guildId, ...query }, params = {}) => this.http.request({
                    path: `/rosters/${guildId}/${rosterId}`,
                    method: "DELETE",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Rosters
                 * @name CloneRoster
                 * @request POST:/rosters/{guildId}/{rosterId}/clone
                 * @secure
                 * @response `201` `CloneRosterData`
                 * @response `500` `ErrorResponseDto`
                 */
                cloneRoster: ({ rosterId, guildId, ...query }, params = {}) => this.http.request({
                    path: `/rosters/${guildId}/${rosterId}/clone`,
                    method: "POST",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Rosters
                 * @name AddRosterMembers
                 * @request PUT:/rosters/{guildId}/{rosterId}/members
                 * @secure
                 * @response `200` `AddRosterMembersData`
                 * @response `500` `ErrorResponseDto`
                 */
                addRosterMembers: ({ rosterId, guildId, ...query }, params = {}) => this.http.request({
                    path: `/rosters/${guildId}/${rosterId}/members`,
                    method: "PUT",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Rosters
                 * @name DeleteRosterMembers
                 * @request DELETE:/rosters/{guildId}/{rosterId}/members
                 * @secure
                 * @response `200` `DeleteRosterMembersData`
                 * @response `500` `ErrorResponseDto`
                 */
                deleteRosterMembers: ({ rosterId, guildId, ...query }, data, params = {}) => this.http.request({
                    path: `/rosters/${guildId}/${rosterId}/members`,
                    method: "DELETE",
                    body: data,
                    secure: true,
                    type: ContentType.Json,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Rosters
                 * @name RefreshRosterMembers
                 * @request POST:/rosters/{guildId}/{rosterId}/members/refresh
                 * @secure
                 * @response `201` `RefreshRosterMembersData`
                 * @response `500` `ErrorResponseDto`
                 */
                refreshRosterMembers: ({ rosterId, guildId, ...query }, params = {}) => this.http.request({
                    path: `/rosters/${guildId}/${rosterId}/members/refresh`,
                    method: "POST",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Rosters
                 * @name TransferRosterMembers
                 * @request PUT:/rosters/{guildId}/{rosterId}/members/transfer
                 * @secure
                 * @response `200` `TransferRosterMembersData`
                 * @response `500` `ErrorResponseDto`
                 */
                transferRosterMembers: ({ rosterId, guildId, ...query }, data, params = {}) => this.http.request({
                    path: `/rosters/${guildId}/${rosterId}/members/transfer`,
                    method: "PUT",
                    body: data,
                    secure: true,
                    type: ContentType.Json,
                    format: "json",
                    ...params,
                }),
            }
        });
        Object.defineProperty(this, "users", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {
                /**
                 * No description
                 *
                 * @tags Users
                 * @name GetUser
                 * @request GET:/users/{userId}
                 * @secure
                 * @response `200` `GetUserData`
                 * @response `500` `ErrorResponseDto`
                 */
                getUser: ({ userId, ...query }, params = {}) => this.http.request({
                    path: `/users/${userId}`,
                    method: "GET",
                    secure: true,
                    format: "json",
                    ...params,
                }),
            }
        });
        Object.defineProperty(this, "guilds", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {
                /**
                 * No description
                 *
                 * @tags Guilds
                 * @name GetGuildClans
                 * @request GET:/guilds/{guildId}/clans
                 * @secure
                 * @response `200` `GetGuildClansData`
                 * @response `500` `ErrorResponseDto`
                 */
                getGuildClans: ({ guildId, ...query }, params = {}) => this.http.request({
                    path: `/guilds/${guildId}/clans`,
                    method: "GET",
                    secure: true,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Guilds
                 * @name ReorderGuildClans
                 * @request PATCH:/guilds/{guildId}/clans/reorder
                 * @secure
                 * @response `200` `ReorderGuildClansData`
                 * @response `500` `ErrorResponseDto`
                 */
                reorderGuildClans: ({ guildId, ...query }, data, params = {}) => this.http.request({
                    path: `/guilds/${guildId}/clans/reorder`,
                    method: "PATCH",
                    body: data,
                    secure: true,
                    type: ContentType.Json,
                    format: "json",
                    ...params,
                }),
                /**
                 * No description
                 *
                 * @tags Guilds
                 * @name ListMembers
                 * @request GET:/guilds/{guildId}/members/list
                 * @secure
                 * @response `200` `ListMembersData`
                 * @response `500` `ErrorResponseDto`
                 */
                listMembers: ({ guildId, ...query }, params = {}) => this.http.request({
                    path: `/guilds/${guildId}/members/list`,
                    method: "GET",
                    query: query,
                    secure: true,
                    format: "json",
                    ...params,
                }),
            }
        });
        Object.defineProperty(this, "exports", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {
                /**
                 * No description
                 *
                 * @tags Exports
                 * @name ExportClanMembers
                 * @request POST:/exports/members
                 * @response `201` `ExportClanMembersData`
                 * @response `500` `ErrorResponseDto`
                 */
                exportClanMembers: (data, params = {}) => this.http.request({
                    path: `/exports/members`,
                    method: "POST",
                    body: data,
                    type: ContentType.Json,
                    format: "json",
                    ...params,
                }),
            }
        });
        this.http = http;
    }
}
//# sourceMappingURL=generated.js.map