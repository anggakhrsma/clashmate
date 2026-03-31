export class CommandsMap {
    constructor(client) {
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: client
        });
        Object.defineProperty(this, "nameMappings", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "idMappings", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.nameMappings = new Map();
        this.idMappings = new Map();
    }
    set(name, formatted, mappedId) {
        this.nameMappings.set(name, formatted);
        this.idMappings.set(mappedId, name);
    }
    entries() {
        return [...this.nameMappings.keys()];
    }
    /**
     * @param name - `/command name`
     */
    get(name) {
        return this.nameMappings.get(name) ?? `${name}`;
    }
    /**
     * @param id - `command-id`
     */
    resolve(id) {
        return this.get(this.idMappings.get(id) ?? `/${id}`);
    }
    get SETUP_CLAN() {
        return this.get('/setup clan');
    }
    get SETUP_CLAN_LOGS() {
        return this.get('/setup clan-logs');
    }
    get LINK_CREATE() {
        return this.get('/link create');
    }
    get REDEEM() {
        return this.get('/redeem');
    }
    get VERIFY() {
        return this.get('/verify');
    }
    get HISTORY() {
        return this.get('/history');
    }
    get AUTOROLE_REFRESH() {
        return this.get('/autorole refresh');
    }
}
//# sourceMappingURL=commands-map.js.map