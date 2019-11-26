/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import { Crypto } from "../tools/crypto";
import { PublicKey } from "./key";
import { Basic } from "./basic";

/**
 * A sandbox that enforces determinism as much as possible and provides security to the system.
 * It is on best effort basis meant to prevent mistakes; smart contracts should be written by a trusted party.
 * Used when executing smart contracts.
 */
export class Sandbox {
	private static sandboxed: boolean = false;
	private static isSetup: boolean = false;
	private static readonly processStandin = { env: {} };
	public static readonly makeUndefined: { [index: string]: unknown } = {
		clearImmediate, clearInterval, clearTimeout, setImmediate, setInterval, setTimeout, queueMicrotask: (global as any).queueMicrotask,
		Intl: (global as any).Intl, Atomics: (global as any).Atomics, SharedArrayBuffer: (global as any).SharedArrayBuffer,
		TextDecoder: (global as any).TextDecoder, TextEncoder: (global as any).TextEncoder
	};
	public static readonly special: { [index: string]: any } = {
		undefined: true, GLOBAL: true, root: true, globalThis: true, global, process, Error, JSONParse: JSON.parse, MathRandom: Math.random,
		DateNow: Date.now, DateParse: Date.parse, Date, stringUpper: String.prototype.toLocaleUpperCase,
		stringLower: String.prototype.toLocaleLowerCase, stringCompare: String.prototype.localeCompare,
		functionToString: Function.prototype.toString, bufferAlloc: Buffer.allocUnsafe, bufferAllocSlow: Buffer.allocUnsafeSlow,
		numberLocale: Number.prototype.toLocaleString, arrayLocale: Array.prototype.toLocaleString,
		encodeURI, decodeURI, encodeURIComponent, decodeURIComponent
	};
	private static readonly deterministicDate: any = class Date extends global.Date {
		//@ts-ignore Ignore unused arguments, we want 7 arguments so Date.constructor.length is the same
		constructor(year?: number | string, month?: number, day?: number, hour?: number, minute?: number, second?: number, millisecond?: number) {
			if ((arguments.length !== 1 || typeof arguments[0] === "string") && Sandbox.sandboxed) {
				if (arguments.length === 0) {
					throw new Error("Use new Date(currentBlockTimestamp) instead.");
				} else if (arguments.length === 1) {
					throw new Error("Use 'const date = timestamp.split(/\\D/); date[1]-=1; new Date(Date.UTC(...date))' or similar instead.");
				} else {
					throw new Error("Use new Date(Date.UTC(...)) instead.");
				}
			}
			//@ts-ignore Sadly there is no good way to do this in with typescript (yet), so just disable the warning.
			super(...arguments);
		}

		public getDate(): number { if (Sandbox.sandboxed) { throw new Error("Use getUTCDate() instead."); } return super.getDate(); }
		public getFullYear(): number { if (Sandbox.sandboxed) { throw new Error("Use getUTCFullYear() instead."); } return super.getFullYear(); }
		// @ts-ignore It does exist, but is depricated
		public getYear(): number { if (Sandbox.sandboxed) { throw new Error("Use getUTCYear() instead."); } return super.getYear(); }
		public getMonth(): number { if (Sandbox.sandboxed) { throw new Error("Use getUTCMonth() instead."); } return super.getMonth(); }
		public getDay(): number { if (Sandbox.sandboxed) { throw new Error("Use getUTCDay() instead."); } return super.getDay(); }
		public getHours(): number { if (Sandbox.sandboxed) { throw new Error("Use getUTCHours() instead."); } return super.getHours(); }
		public getMinutes(): number { if (Sandbox.sandboxed) { throw new Error("Use getUTCMinutes() instead."); } return super.getMinutes(); }
		public getSeconds(): number { if (Sandbox.sandboxed) { throw new Error("Use getUTCSeconds() instead."); } return super.getSeconds(); }
		public getMilliseconds(): number { if (Sandbox.sandboxed) { throw new Error("Use getUTCMilliseconds() instead."); } return super.getMilliseconds(); }
		public getTimezoneOffset(): number { if (Sandbox.sandboxed) { throw new Error("getTimezoneOffset() not allowed."); } return super.getTimezoneOffset(); }
		public setDate(date: number): number { if (Sandbox.sandboxed) { throw new Error("Use setUTCDate() instead."); } return super.setDate(date); }
		public setFullYear(year: number, month?: number, date?: number): number {
			if (Sandbox.sandboxed) { throw new Error("Use setUTCFullYear() instead."); } return super.setFullYear(year, month, date);
		}
		// @ts-ignore It does exist, but is depricated
		public setYear(year: number): number { if (Sandbox.sandboxed) { throw new Error("Use setUTCYear() instead."); } return super.setYear(year); }
		public setMonth(month: number, date?: number): number {
			if (Sandbox.sandboxed) { throw new Error("Use setUTCMonth() instead."); } return super.setMonth(month, date);
		}
		public setHours(hours: number, min?: number, sec?: number, ms?: number): number {
			if (Sandbox.sandboxed) { throw new Error("Use setUTCHours() instead."); } return super.setHours(hours, min, sec, ms);
		}
		public setMinutes(min: number, sec?: number, ms?: number): number {
			if (Sandbox.sandboxed) { throw new Error("Use setUTCMinutes() instead."); } return super.setMinutes(min, sec, ms);
		}
		public setSeconds(sec: number, ms?: number): number {
			if (Sandbox.sandboxed) { throw new Error("Use setUTCSeconds() instead."); } return super.setSeconds(sec, ms);
		}
		public setMilliseconds(ms: number): number { if (Sandbox.sandboxed) { throw new Error("Use setUTCMilliseconds() instead."); } return super.setMilliseconds(ms); }
		public toDateString(): string { if (Sandbox.sandboxed) { throw new Error("Use toISOString() instead."); } return super.toDateString(); }
		public toLocaleDateString(): string { if (Sandbox.sandboxed) { throw new Error("Use toISOString() instead."); } return super.toLocaleDateString(); }
		public toLocaleString(): string { if (Sandbox.sandboxed) { throw new Error("Use toISOString() instead."); } return super.toLocaleString(); }
		public toString(): string { if (Sandbox.sandboxed) { throw new Error("Use toISOString() instead."); } return super.toString(); }
		public toTimeString(): string { if (Sandbox.sandboxed) { throw new Error("Use toISOString() instead."); } return super.toTimeString(); }
		// @ts-ignore It does exist, but is depricated
		public toGMTString(): string { if (Sandbox.sandboxed) { throw new Error("Use toISOString() instead."); } return super.toGMTString(); }
	};

	/**
	 * Enter a sandbox environment. It is safe to call this even if you are currently sandboxed.
	 * Make sure you leave it again after critical code is executed. Note that:
	 * * All global objects are permanently frozen, even after leaving the sandbox.
	 * * Various async functions, the process and require are unavailable in the sandbox.
	 * * It will try to make it deterministed by removing things like Math.random(), Date.now() and setTimeout().
	 * * It will change JSON.parse to return undefined instead of throwing an error.
	 */
	public static sandbox(): void {
		if (!Sandbox.sandboxed) {
			Sandbox.sandboxed = true;

			if (!Sandbox.isSetup) {
				//Make methods globally available for smart contracts (or at least the methods that anyone may call).
				(global as any).sha1 = Crypto.sha1;
				(global as any).sha256 = Crypto.sha256;
				(global as any).sha512 = Crypto.sha512;
				(global as any).md5 = Crypto.md5;
				(global as any).ripemd160 = Crypto.ripemd160;
				(global as any).isValidAddress = PublicKey.isValidAddress;
				(global as any).addressAsString = PublicKey.addressAsString;
				(global as any).addressAsBuffer = PublicKey.addressAsBuffer;
				(global as any).reject = Basic.reject;
				(global as any).query = Basic.querySC;
				(global as any).queryFast = Basic.querySCFast;

				//Change the Math.random method to not allowed while sandboxed.
				Math.random = () => {
					if (Sandbox.sandboxed) { throw new Error("Math.random() not allowed."); }
					return Sandbox.special.MathRandom();
				};
				//Change the date.now() and new Date() methods
				Date.now = () => {
					if (Sandbox.sandboxed) { throw new Error("Use previousBlockTimestamp instead of Date.now()."); }
					return Sandbox.special.DateNow();
				};
				Date.parse = (date: string) => {
					if (Sandbox.sandboxed) {
						throw new Error("Use 'const date = timestamp.split(/\\D/); date[1]-=1; new Date(Date.UTC(...date))' or similar instead.");
					}
					return Sandbox.special.DateParse(date);
				};
				Object.freeze(Date);
				Object.freeze(Date.prototype);
				global.Date = Sandbox.deterministicDate;
				//Change string locale methods
				String.prototype.toLocaleLowerCase = function(this, ...args: any[]): string {
					if (Sandbox.sandboxed) { throw new Error("String.toLocalLowerCase not allowed."); }
					return Sandbox.special.stringLower.call(this, ...args);
				};
				String.prototype.toLocaleUpperCase = function(this, ...args: any[]): string {
					if (Sandbox.sandboxed) { throw new Error("String.toLocaleUpperCase not allowed."); }
					return Sandbox.special.stringUpper.call(this, ...args);
				};
				String.prototype.localeCompare = function(this, ...args: any[]): number {
					if (Sandbox.sandboxed) { throw new Error("String.localeCompare not allowed."); }
					return Sandbox.special.stringCompare.call(this, ...args);
				};
				//Change toLocaleString methods
				Number.prototype.toLocaleString = function(this, ...args: any[]): string {
					if (Sandbox.sandboxed) { throw new Error("Number.toLocaleString not allowed."); }
					return Sandbox.special.numberLocale.call(this, ...args);
				};
				Array.prototype.toLocaleString = function(this, ...args: any[]): string {
					if (Sandbox.sandboxed) { throw new Error("Array.toLocaleString not allowed."); }
					return Sandbox.special.arrayLocale.call(this, ...args);
				};
				if (typeof (global as any).BigInt === "function" && typeof (global as any).BigInt.prototype === "object") {
					Sandbox.special.bigintLocale = (global as any).BigInt.prototype.toLocaleString;
					(global as any).BigInt.prototype.toLocaleString = function(this, ...args: any[]): string {
						if (Sandbox.sandboxed) { throw new Error("BigInt.toLocaleString not allowed."); }
						return Sandbox.special.bigintLocale.call(this, ...args);
					};
				}

				//Change buffer allocUnsafe methods. They return the same thing, so no need to throw.
				Buffer.allocUnsafe = (...args: any[]) => {
					if (Sandbox.sandboxed) { return (Buffer as any).alloc(...args); }
					return Sandbox.special.bufferAlloc(...args);
				};
				Buffer.allocUnsafeSlow = (...args: any[]) => {
					if (Sandbox.sandboxed) { return (Buffer as any).alloc(...args); }
					return Sandbox.special.bufferAllocSlow(...args);
				};

				Function.prototype.toString = function(this, ...args): string {
					if (Sandbox.sandboxed) { throw new Error("Function.toString not allowed."); }
					return Sandbox.special.functionToString.call(this, ...args);
				};

				//These values carry over between smart contracts, but are deletable
				delete RegExp.$1; delete RegExp.$2; delete RegExp.$3; delete RegExp.$4; delete RegExp.$5;
				delete RegExp.$6; delete RegExp.$7; delete RegExp.$8; delete RegExp.$9; delete RegExp.lastMatch;
				delete (RegExp as any)["$&"]; delete (RegExp as any).leftContext; delete (RegExp as any)["$`"];
				delete (RegExp as any).rightContext; delete (RegExp as any)["$'"]; delete (RegExp as any).lastParen;
				delete (RegExp as any)["$+"]; delete (RegExp as any).input; delete (RegExp as any).$_;

				//Change JSON.parse so it doesn't throw an error
				JSON.parse = (text, reviver) => {
					try {
						return Sandbox.special.JSONParse(text, reviver);
					} catch (error) {
						if (Sandbox.sandboxed && error instanceof SyntaxError) {
							//Deterministic error while in sandbox
							return undefined;
						} else {
							throw error;
						}
					}
				};
				//Change encode/decodeURI(component) so it doesn't throw an error
				global.encodeURI = (uri) => {
					try { return Sandbox.special.encodeURI(uri); } catch (error) {
						if (Sandbox.sandboxed && error instanceof URIError) { return undefined; } else { throw error; }
					}
				};
				global.encodeURIComponent = (uriComponent) => {
					try { return Sandbox.special.encodeURIComponent(uriComponent); } catch (error) {
						if (Sandbox.sandboxed && error instanceof URIError) { return undefined; } else { throw error; }
					}
				};
				global.decodeURI = (encodedURI) => {
					try { return Sandbox.special.decodeURI(encodedURI); } catch (error) {
						if (Sandbox.sandboxed && error instanceof URIError) { return undefined; } else { throw error; }
					}
				};
				global.decodeURIComponent = (encodedURIComponent) => {
					try { return Sandbox.special.decodeURIComponent(encodedURIComponent); } catch (error) {
						if (Sandbox.sandboxed && error instanceof URIError) { return undefined; } else { throw error; }
					}
				};

				//Add parse() to the global URL object (if it exists)
				if (typeof (global as any).URL === "function") {
					(global as any).URL.parse = (input: string, base?: any) => {
						try {
							return new (global as any).URL(input, base);
						} catch (error) {
							if (error instanceof TypeError) {
								//Invalid url
								return undefined;
							} else {
								//Non-deterministic error
								throw error;
							}
						}
					};
				}

				//We only seal global as some values need to be modified
				Object.seal(global);
				Object.defineProperty(global, "global", { configurable: false, writable: false });
				//Name and stackTraceLimit of error should remain writable, due to that being used by a library
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

				//Freeze all global objects (except those that will be made undefined and some special objects)
				for (const object of Object.getOwnPropertyNames(global)) {
					if (Sandbox.makeUndefined[object] === undefined && Sandbox.special[object] === undefined) {
						const prop = Object.getOwnPropertyDescriptor(global, object)!;
						if (prop.get !== undefined || prop.set !== undefined) {
							Object.defineProperty(global, object, { configurable: false, get: prop.get, set: prop.set });
						} else {
							Object.defineProperty(global, object, { configurable: false, writable: false });
						}
						Object.freeze((global as any)[object]);
						Object.freeze((global as any)[object].prototype);
					}
				}

				//Freeze the process standin
				Object.freeze(Sandbox.processStandin);

				Sandbox.isSetup = true;
			}

			//Some objects are not allowed in the sandbox
			for (const object of Object.keys(Sandbox.makeUndefined)) {
				if (global.hasOwnProperty(object)) {
					(global as any)[object] = undefined;
				}
			}
			//Process is available as bare object in the sandbox
			process = Sandbox.processStandin as any;
		}
	}

	/** Leave the sandboxed environment again. It is safe to call this even if you are not currently sandboxed. */
	public static unSandbox(): void {
		if (Sandbox.sandboxed) {
			Sandbox.sandboxed = false;

			//Allow async methods again
			for (const object of Object.keys(Sandbox.makeUndefined)) {
				if (global.hasOwnProperty(object)) {
					(global as any)[object] = Sandbox.makeUndefined[object];
				}
			}

			//Process is available again
			process = Sandbox.special.process;
		}
	}

	public static isSandboxed(): boolean {
		return this.sandboxed;
	}
}