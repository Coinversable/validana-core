"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Sandbox {
    static sandbox() {
        if (!Sandbox.sandboxed) {
            Sandbox.sandboxed = true;
            if (!Sandbox.isSetup) {
                Math.random = () => {
                    if (Sandbox.sandboxed) {
                        throw new Error("Math.random() not allowed.");
                    }
                    return Sandbox.special.MathRandom();
                };
                global.Date = Sandbox.deterministicDate;
                Date.now = () => {
                    if (Sandbox.sandboxed) {
                        throw new Error("Date.now() not allowed.");
                    }
                    return Sandbox.special.DateNow();
                };
                for (const object of Object.getOwnPropertyNames(global)) {
                    if (Sandbox.makeUndefined[object] === undefined && Sandbox.special[object] === undefined) {
                        Object.freeze(global[object]);
                    }
                }
                Sandbox.isSetup = true;
            }
            for (const object of Object.keys(Sandbox.makeUndefined)) {
                global[object] = undefined;
            }
            require = undefined;
            JSON.parse = (text, reviver) => {
                try {
                    return Sandbox.special.JSONParse(text, reviver);
                }
                catch (error) {
                    if (error instanceof SyntaxError) {
                        return undefined;
                    }
                    else {
                        throw error;
                    }
                }
            };
        }
    }
    static unSandbox() {
        if (Sandbox.sandboxed) {
            Sandbox.sandboxed = false;
            for (const object of Object.keys(Sandbox.makeUndefined)) {
                global[object] = Sandbox.makeUndefined[object];
            }
            require = Sandbox.special.require;
            global = Sandbox.special.global;
            global.GLOBAL = Sandbox.special.GLOBAL;
            global.root = Sandbox.special.root;
            global.JSON = Sandbox.special.JSON;
            JSON.stringify = Sandbox.special.JSONStringify;
            JSON.parse = Sandbox.special.JSONParse;
        }
    }
    static isSandboxed() {
        return this.sandboxed;
    }
}
exports.Sandbox = Sandbox;
Sandbox.sandboxed = false;
Sandbox.isSetup = false;
Sandbox.makeUndefined = {
    process, clearImmediate, clearInterval, clearTimeout, setImmediate, setInterval, setTimeout
};
Sandbox.special = {
    require, JSON, JSONParse: JSON.parse, JSONStringify: JSON.stringify, MathRandom: Math.random,
    DateNow: Date.now, DateNew: Date.prototype.constructor, global, GLOBAL: global.GLOBAL, root: global.root
};
Sandbox.deterministicDate = class DDate extends Date {
    constructor(...args) {
        if (args.length === 0 && Sandbox.sandboxed) {
            throw new Error("new Date() without parameters not allowed.");
        }
        super(...args);
    }
};
