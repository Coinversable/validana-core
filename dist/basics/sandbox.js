"use strict";
/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("../tools/crypto");
const key_1 = require("./key");
const basic_1 = require("./basic");
class Sandbox {
    static sandbox() {
        if (!Sandbox.sandboxed) {
            Sandbox.sandboxed = true;
            if (!Sandbox.isSetup) {
                global.sha1 = crypto_1.Crypto.sha1;
                global.sha256 = crypto_1.Crypto.sha256;
                global.sha512 = crypto_1.Crypto.sha512;
                global.md5 = crypto_1.Crypto.md5;
                global.ripemd160 = crypto_1.Crypto.ripemd160;
                global.isValidAddress = key_1.PublicKey.isValidAddress;
                global.addressAsString = key_1.PublicKey.addressAsString;
                global.addressAsBuffer = key_1.PublicKey.addressAsBuffer;
                global.reject = basic_1.Basic.reject;
                global.query = basic_1.Basic.querySC;
                global.queryFast = basic_1.Basic.querySCFast;
                Math.random = () => {
                    if (Sandbox.sandboxed) {
                        throw new Error("Math.random() not allowed.");
                    }
                    return Sandbox.special.MathRandom();
                };
                Date.now = () => {
                    if (Sandbox.sandboxed) {
                        throw new Error("Use previousBlockTimestamp instead of Date.now().");
                    }
                    return Sandbox.special.DateNow();
                };
                Date.parse = (date) => {
                    if (Sandbox.sandboxed) {
                        throw new Error("Use 'const date = timestamp.split(/\\D/); date[1]-=1; new Date(Date.UTC(...date))' or similar instead.");
                    }
                    return Sandbox.special.DateParse(date);
                };
                Object.freeze(Date);
                Object.freeze(Date.prototype);
                global.Date = Sandbox.deterministicDate;
                String.prototype.toLocaleLowerCase = function (...args) {
                    if (Sandbox.sandboxed) {
                        throw new Error("String.toLocalLowerCase not allowed.");
                    }
                    return Sandbox.special.stringLower.call(this, ...args);
                };
                String.prototype.toLocaleUpperCase = function (...args) {
                    if (Sandbox.sandboxed) {
                        throw new Error("String.toLocaleUpperCase not allowed.");
                    }
                    return Sandbox.special.stringUpper.call(this, ...args);
                };
                String.prototype.localeCompare = function (...args) {
                    if (Sandbox.sandboxed) {
                        throw new Error("String.localeCompare not allowed.");
                    }
                    return Sandbox.special.stringCompare.call(this, ...args);
                };
                Number.prototype.toLocaleString = function (...args) {
                    if (Sandbox.sandboxed) {
                        throw new Error("Number.toLocaleString not allowed.");
                    }
                    return Sandbox.special.numberLocale.call(this, ...args);
                };
                Array.prototype.toLocaleString = function (...args) {
                    if (Sandbox.sandboxed) {
                        throw new Error("Array.toLocaleString not allowed.");
                    }
                    return Sandbox.special.arrayLocale.call(this, ...args);
                };
                if (typeof global.BigInt === "function" && typeof global.BigInt.prototype === "object") {
                    Sandbox.special.bigintLocale = global.BigInt.prototype.toLocaleString;
                    global.BigInt.prototype.toLocaleString = function (...args) {
                        if (Sandbox.sandboxed) {
                            throw new Error("BigInt.toLocaleString not allowed.");
                        }
                        return Sandbox.special.bigintLocale.call(this, ...args);
                    };
                }
                Buffer.allocUnsafe = (...args) => {
                    if (Sandbox.sandboxed) {
                        return Buffer.alloc(...args);
                    }
                    return Sandbox.special.bufferAlloc(...args);
                };
                Buffer.allocUnsafeSlow = (...args) => {
                    if (Sandbox.sandboxed) {
                        return Buffer.alloc(...args);
                    }
                    return Sandbox.special.bufferAllocSlow(...args);
                };
                Function.prototype.toString = function (...args) {
                    if (Sandbox.sandboxed) {
                        throw new Error("Function.toString not allowed.");
                    }
                    return Sandbox.special.functionToString.call(this, ...args);
                };
                delete RegExp.$1;
                delete RegExp.$2;
                delete RegExp.$3;
                delete RegExp.$4;
                delete RegExp.$5;
                delete RegExp.$6;
                delete RegExp.$7;
                delete RegExp.$8;
                delete RegExp.$9;
                delete RegExp.lastMatch;
                delete RegExp["$&"];
                delete RegExp.leftContext;
                delete RegExp["$`"];
                delete RegExp.rightContext;
                delete RegExp["$'"];
                delete RegExp.lastParen;
                delete RegExp["$+"];
                delete RegExp.input;
                delete RegExp.$_;
                JSON.parse = (text, reviver) => {
                    try {
                        return Sandbox.special.JSONParse(text, reviver);
                    }
                    catch (error) {
                        if (Sandbox.sandboxed && error instanceof SyntaxError) {
                            return undefined;
                        }
                        else {
                            throw error;
                        }
                    }
                };
                global.encodeURI = (uri) => {
                    try {
                        return Sandbox.special.encodeURI(uri);
                    }
                    catch (error) {
                        if (Sandbox.sandboxed && error instanceof URIError) {
                            return undefined;
                        }
                        else {
                            throw error;
                        }
                    }
                };
                global.encodeURIComponent = (uriComponent) => {
                    try {
                        return Sandbox.special.encodeURIComponent(uriComponent);
                    }
                    catch (error) {
                        if (Sandbox.sandboxed && error instanceof URIError) {
                            return undefined;
                        }
                        else {
                            throw error;
                        }
                    }
                };
                global.decodeURI = (encodedURI) => {
                    try {
                        return Sandbox.special.decodeURI(encodedURI);
                    }
                    catch (error) {
                        if (Sandbox.sandboxed && error instanceof URIError) {
                            return undefined;
                        }
                        else {
                            throw error;
                        }
                    }
                };
                global.decodeURIComponent = (encodedURIComponent) => {
                    try {
                        return Sandbox.special.decodeURIComponent(encodedURIComponent);
                    }
                    catch (error) {
                        if (Sandbox.sandboxed && error instanceof URIError) {
                            return undefined;
                        }
                        else {
                            throw error;
                        }
                    }
                };
                if (typeof global.URL === "function") {
                    global.URL.parse = (input, base) => {
                        try {
                            return new global.URL(input, base);
                        }
                        catch (error) {
                            if (error instanceof TypeError) {
                                return undefined;
                            }
                            else {
                                throw error;
                            }
                        }
                    };
                }
                Object.seal(global);
                Object.defineProperty(global, "global", { configurable: false, writable: false });
                Object.defineProperty(global, "Error", { configurable: false, writable: false });
                Object.seal(Error);
                Object.freeze(Error.constructor);
                Object.defineProperty(Error, "length", { configurable: false, writable: false });
                Object.defineProperty(Error, "name", { configurable: false, writable: false });
                Object.defineProperty(Error, "captureStackTrace", { configurable: false, writable: false });
                Object.defineProperty(Error, "stackTraceLimit", { configurable: false, writable: true });
                Object.seal(Error.prototype);
                Object.defineProperty(Error.prototype, "constructor", { configurable: false, writable: false });
                Object.defineProperty(Error.prototype, "toString", { configurable: false, writable: false });
                Object.defineProperty(Error.prototype, "message", { configurable: false, writable: false });
                Object.defineProperty(Error.prototype, "name", { configurable: false, writable: true });
                for (const object of Object.getOwnPropertyNames(global)) {
                    if (Sandbox.makeUndefined[object] === undefined && Sandbox.special[object] === undefined) {
                        const prop = Object.getOwnPropertyDescriptor(global, object);
                        if (prop.get !== undefined || prop.set !== undefined) {
                            Object.defineProperty(global, object, { configurable: false, get: prop.get, set: prop.set });
                        }
                        else {
                            Object.defineProperty(global, object, { configurable: false, writable: false });
                        }
                        Object.freeze(global[object]);
                        Object.freeze(global[object].prototype);
                    }
                }
                Object.freeze(Sandbox.processStandin);
                Sandbox.isSetup = true;
            }
            for (const object of Object.keys(Sandbox.makeUndefined)) {
                if (global.hasOwnProperty(object)) {
                    global[object] = undefined;
                }
            }
            process = Sandbox.processStandin;
        }
    }
    static unSandbox() {
        if (Sandbox.sandboxed) {
            Sandbox.sandboxed = false;
            for (const object of Object.keys(Sandbox.makeUndefined)) {
                if (global.hasOwnProperty(object)) {
                    global[object] = Sandbox.makeUndefined[object];
                }
            }
            process = Sandbox.special.process;
        }
    }
    static isSandboxed() {
        return this.sandboxed;
    }
}
exports.Sandbox = Sandbox;
Sandbox.sandboxed = false;
Sandbox.isSetup = false;
Sandbox.processStandin = { env: {} };
Sandbox.makeUndefined = {
    clearImmediate, clearInterval, clearTimeout, setImmediate, setInterval, setTimeout, queueMicrotask: global.queueMicrotask,
    Intl: global.Intl, Atomics: global.Atomics, SharedArrayBuffer: global.SharedArrayBuffer,
    TextDecoder: global.TextDecoder, TextEncoder: global.TextEncoder
};
Sandbox.special = {
    undefined: true, GLOBAL: true, root: true, globalThis: true, global, process, Error, JSONParse: JSON.parse, MathRandom: Math.random,
    DateNow: Date.now, DateParse: Date.parse, Date, stringUpper: String.prototype.toLocaleUpperCase,
    stringLower: String.prototype.toLocaleLowerCase, stringCompare: String.prototype.localeCompare,
    functionToString: Function.prototype.toString, bufferAlloc: Buffer.allocUnsafe, bufferAllocSlow: Buffer.allocUnsafeSlow,
    numberLocale: Number.prototype.toLocaleString, arrayLocale: Array.prototype.toLocaleString,
    encodeURI, decodeURI, encodeURIComponent, decodeURIComponent
};
Sandbox.deterministicDate = class Date extends global.Date {
    constructor(year, month, day, hour, minute, second, millisecond) {
        if ((arguments.length !== 1 || typeof arguments[0] === "string") && Sandbox.sandboxed) {
            if (arguments.length === 0) {
                throw new Error("Use new Date(currentBlockTimestamp) instead.");
            }
            else if (arguments.length === 1) {
                throw new Error("Use 'const date = timestamp.split(/\\D/); date[1]-=1; new Date(Date.UTC(...date))' or similar instead.");
            }
            else {
                throw new Error("Use new Date(Date.UTC(...)) instead.");
            }
        }
        super(...arguments);
    }
    getDate() { if (Sandbox.sandboxed) {
        throw new Error("Use getUTCDate() instead.");
    } return super.getDate(); }
    getFullYear() { if (Sandbox.sandboxed) {
        throw new Error("Use getUTCFullYear() instead.");
    } return super.getFullYear(); }
    getYear() { if (Sandbox.sandboxed) {
        throw new Error("Use getUTCYear() instead.");
    } return super.getYear(); }
    getMonth() { if (Sandbox.sandboxed) {
        throw new Error("Use getUTCMonth() instead.");
    } return super.getMonth(); }
    getDay() { if (Sandbox.sandboxed) {
        throw new Error("Use getUTCDay() instead.");
    } return super.getDay(); }
    getHours() { if (Sandbox.sandboxed) {
        throw new Error("Use getUTCHours() instead.");
    } return super.getHours(); }
    getMinutes() { if (Sandbox.sandboxed) {
        throw new Error("Use getUTCMinutes() instead.");
    } return super.getMinutes(); }
    getSeconds() { if (Sandbox.sandboxed) {
        throw new Error("Use getUTCSeconds() instead.");
    } return super.getSeconds(); }
    getMilliseconds() { if (Sandbox.sandboxed) {
        throw new Error("Use getUTCMilliseconds() instead.");
    } return super.getMilliseconds(); }
    getTimezoneOffset() { if (Sandbox.sandboxed) {
        throw new Error("getTimezoneOffset() not allowed.");
    } return super.getTimezoneOffset(); }
    setDate(date) { if (Sandbox.sandboxed) {
        throw new Error("Use setUTCDate() instead.");
    } return super.setDate(date); }
    setFullYear(year, month, date) {
        if (Sandbox.sandboxed) {
            throw new Error("Use setUTCFullYear() instead.");
        }
        return super.setFullYear(year, month, date);
    }
    setYear(year) { if (Sandbox.sandboxed) {
        throw new Error("Use setUTCYear() instead.");
    } return super.setYear(year); }
    setMonth(month, date) {
        if (Sandbox.sandboxed) {
            throw new Error("Use setUTCMonth() instead.");
        }
        return super.setMonth(month, date);
    }
    setHours(hours, min, sec, ms) {
        if (Sandbox.sandboxed) {
            throw new Error("Use setUTCHours() instead.");
        }
        return super.setHours(hours, min, sec, ms);
    }
    setMinutes(min, sec, ms) {
        if (Sandbox.sandboxed) {
            throw new Error("Use setUTCMinutes() instead.");
        }
        return super.setMinutes(min, sec, ms);
    }
    setSeconds(sec, ms) {
        if (Sandbox.sandboxed) {
            throw new Error("Use setUTCSeconds() instead.");
        }
        return super.setSeconds(sec, ms);
    }
    setMilliseconds(ms) { if (Sandbox.sandboxed) {
        throw new Error("Use setUTCMilliseconds() instead.");
    } return super.setMilliseconds(ms); }
    toDateString() { if (Sandbox.sandboxed) {
        throw new Error("Use toISOString() instead.");
    } return super.toDateString(); }
    toLocaleDateString() { if (Sandbox.sandboxed) {
        throw new Error("Use toISOString() instead.");
    } return super.toLocaleDateString(); }
    toLocaleString() { if (Sandbox.sandboxed) {
        throw new Error("Use toISOString() instead.");
    } return super.toLocaleString(); }
    toString() { if (Sandbox.sandboxed) {
        throw new Error("Use toISOString() instead.");
    } return super.toString(); }
    toTimeString() { if (Sandbox.sandboxed) {
        throw new Error("Use toISOString() instead.");
    } return super.toTimeString(); }
    toGMTString() { if (Sandbox.sandboxed) {
        throw new Error("Use toISOString() instead.");
    } return super.toGMTString(); }
};
//# sourceMappingURL=sandbox.js.map