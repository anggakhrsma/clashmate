export class Queue {
    constructor() {
        Object.defineProperty(this, "promises", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.promises = [];
    }
    get remaining() {
        return this.promises.length;
    }
    wait() {
        const next = this.promises.length
            ? this.promises[this.promises.length - 1].promise
            : Promise.resolve();
        let resolve;
        const promise = new Promise((res) => {
            resolve = res;
        });
        this.promises.push({
            resolve,
            promise
        });
        return next;
    }
    shift() {
        const fn = this.promises.shift();
        if (typeof fn !== 'undefined')
            fn.resolve();
    }
}
//# sourceMappingURL=queue.js.map