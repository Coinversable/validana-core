/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

/**
 * A sandbox that enforces determinism as much as possible and provides security to the system.
 * It is on best effort basis meant to prevent mistakes; smart contracts should be written by a trusted party.
 * Used when executing smart contracts.
 */
export class Sandbox {
	private static sandboxed: boolean = false;
	private static isSetup: boolean = false;
	private static makeUndefined: { [index: string]: any } = {
		process, clearImmediate, clearInterval, clearTimeout, setImmediate, setInterval, setTimeout
	};
	private static special = {
		require, JSON, JSONParse: JSON.parse, JSONStringify: JSON.stringify, MathRandom: Math.random,
		DateNow: Date.now, DateNew: Date.prototype.constructor as any, global, GLOBAL: global.GLOBAL, root: global.root
	};
	private static deterministicDate: any = class DDate extends Date {
		constructor(...args: any[]) {
			if (args.length === 0 && Sandbox.sandboxed) {
				throw new Error("new Date() without parameters not allowed.");
			}
			//@ts-ignore Sadly there is no good way to do this in with typescript, so just disable the warning.
			super(...args);
		}
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
				//Change the Math.random method to not allowed while sandboxed.
				Math.random = () => {
					if (Sandbox.sandboxed) {
						throw new Error("Math.random() not allowed.");
					}
					return Sandbox.special.MathRandom();
				};
				//Change the date.now() and new Date() methods
				global.Date = Sandbox.deterministicDate;
				Date.now = () => {
					if (Sandbox.sandboxed) {
						throw new Error("Date.now() not allowed.");
					}
					return Sandbox.special.DateNow();
				};

				//Freeze all global objects (except JSON/global itsself and those that will be made undefined)
				for (const object of Object.getOwnPropertyNames(global)) {
					if (Sandbox.makeUndefined[object] === undefined && (Sandbox.special as any)[object] === undefined) {
						Object.freeze((global as any)[object]);
					}
				}
				Sandbox.isSetup = true;
			}

			//Some objects are not allowed in the sandbox
			for (const object of Object.keys(Sandbox.makeUndefined)) {
				(global as any)[object] = undefined;
			}

			//We do not allow external libs
			require = undefined as any;

			//Change it so it doesn't throw an error
			JSON.parse = (text, reviver) => {
				try {
					return Sandbox.special.JSONParse(text, reviver);
				} catch (error) {
					if (error instanceof SyntaxError) {
						return undefined;
					} else {
						throw error;
					}
				}
			};

			//Remove non-determinism of timezones
			/*Date.prototype.getDate = undefined as any;
			Date.prototype.getDay = undefined as any;
			Date.prototype.getFullYear = undefined as any;
			Date.prototype.getHours = undefined as any;
			Date.prototype.getMilliseconds = undefined as any;
			Date.prototype.getMinutes = undefined as any;
			Date.prototype.getMonth = undefined as any;
			Date.prototype.getTimezoneOffset = undefined as any;
			Date.prototype.setDate = undefined as any;
			Date.prototype.setFullYear = undefined as any;
			Date.prototype.setHours = undefined as any;
			Date.prototype.setMilliseconds = undefined as any;
			Date.prototype.setMinutes = undefined as any;
			Date.prototype.setMonth = undefined as any;
			Date.prototype.setSeconds = undefined as any;
			Date.prototype.toDateString = undefined as any;
			Date.prototype.toLocaleDateString = undefined as any;
			Date.prototype.toLocaleString = undefined as any;
			Date.prototype.toLocaleTimeString = undefined as any;
			Date.prototype.toString = undefined as any;
			Date.prototype.toTimeString = undefined as any;*/
		}
	}

	/** Leave the sandboxed environment again. It is safe to call this even if you are not currently sandboxed. */
	public static unSandbox(): void {
		if (Sandbox.sandboxed) {
			Sandbox.sandboxed = false;

			//Allow async methods again
			for (const object of Object.keys(Sandbox.makeUndefined)) {
				(global as any)[object] = Sandbox.makeUndefined[object];
			}

			//Allow external libs agian
			require = Sandbox.special.require;

			//Reset objects in case smart contracts modified them
			global = Sandbox.special.global;
			global.GLOBAL = Sandbox.special.GLOBAL;
			global.root = Sandbox.special.root;
			global.JSON = Sandbox.special.JSON;
			JSON.stringify = Sandbox.special.JSONStringify;
			//Also use normal JSON.parse again
			JSON.parse = Sandbox.special.JSONParse;
		}
	}

	public static isSandboxed(): boolean {
		return this.sandboxed;
	}
}