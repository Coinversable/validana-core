/* eslint-disable max-len, no-console, @typescript-eslint/ban-ts-comment, no-eval, @typescript-eslint/no-implied-eval */
import { Sandbox } from "../../index";

describe("Sandbox", () => {
	beforeAll(() => {
		try {
			//We do not want to spam console in tests later, but these will be frozen afer sandboxing.
			console.debug = () => { };
			console.log = () => { };
			console.info = () => { };
			console.warn = () => { };
			console.error = () => { };

			//Needed for the test, but not available in the sandbox.
			(Sandbox as any).processStandin.stdout = process.stdout;
			(Sandbox as any).processStandin.listeners = process.listeners;

			//Ensure we have sandboxed once...
			Sandbox.sandbox();
			Sandbox.unSandbox();
		} catch (error) {
			//Already set in the basic test suite
		}
	});

	it("(Un)sandboxing test", () => {
		//Unsandbox while unsandboxed
		expect(() => Sandbox.unSandbox()).not.toThrow();
		expect(Sandbox.isSandboxed()).toBe(false);
		//Sandbox twice
		expect(() => Sandbox.sandbox()).not.toThrow();
		expect(Sandbox.isSandboxed()).toBe(true);
		expect(() => Sandbox.sandbox()).not.toThrow();
		expect(Sandbox.isSandboxed()).toBe(true);
		//Unsandbox again
		expect(() => Sandbox.unSandbox()).not.toThrow();
		expect(Sandbox.isSandboxed()).toBe(false);
	});

	describe("new functions", () => {
		//These functions should now exist:
		it("sha1", () => expect(() => (global as any).sha1("")).not.toThrow());
		it("isValidAddress", () => expect(() => (global as any).isValidAddress("1Es9rxdUBYhTwfcFGeQLqZc9DZ2akLiqhb")).not.toThrow());
		it("addressAsString", () => expect(() => (global as any).addressAsString("1Es9rxdUBYhTwfcFGeQLqZc9DZ2akLiqhb")).not.toThrow());
		it("addressAsBuffer", () => expect(() => (global as any).addressAsBuffer("1Es9rxdUBYhTwfcFGeQLqZc9DZ2akLiqhb")).not.toThrow());
		it("reject", () => expect(() => (global as any).reject("Test")).not.toThrow());
		if (typeof (global as any).URL === "function") {
			it("URL.parse", () => expect(() => (global as any).URL.parse("Test")).not.toThrow());
		}
	});

	it("Inside sandbox", () => {
		Sandbox.sandbox();
		//Async functions
		expect(() => setInterval(() => { }, 1000)).toThrow();
		expect(() => setTimeout(() => { }, 10)).toThrow();
		expect(() => setImmediate(() => { })).toThrow();
		//Non-deterministic functions
		expect(() => Math.random()).toThrow();
		expect(() => Date.now()).toThrow();
		expect(() => new Date()).toThrow();
		//Local format
		expect(() => "".toLocaleLowerCase()).toThrow();
		expect(() => "".toLocaleUpperCase()).toThrow();
		expect(() => "".localeCompare("")).toThrow();
		expect(() => [].toLocaleString()).toThrow();
		expect(() => [123][0].toLocaleString()).toThrow();
		expect(() => eval("[123n][0].toLocaleString()")).toThrow();
		//Uninitialized memory
		expect(() => Buffer.allocUnsafe(10)).not.toThrow();
		expect(() => Buffer.allocUnsafeSlow(10)).not.toThrow();
		//Implementation details
		expect(() => new Function().toString()).toThrow();
		///Local timezone
		expect(() => new Date("1234-1-1")).toThrow();
		expect(() => new Date(1234, 1, 1)).toThrow();
		expect(() => Date.parse("1234-1-1")).toThrow();
		expect(() => new Date(123).toDateString()).toThrow();
		expect(() => new Date(123).toLocaleDateString()).toThrow();
		expect(() => new Date(123).toLocaleString()).toThrow();
		expect(() => new Date(123).toString()).toThrow();
		expect(() => new Date(123).toTimeString()).toThrow();
		expect(() => (new Date(123) as any).toGMTString()).toThrow();
		expect(() => (new Date(123) as any).getYear()).toThrow();
		expect(() => new Date(123).getFullYear()).toThrow();
		expect(() => new Date(123).getMonth()).toThrow();
		expect(() => new Date(123).getDay()).toThrow();
		expect(() => new Date(123).getDate()).toThrow();
		expect(() => new Date(123).getHours()).toThrow();
		expect(() => new Date(123).getMinutes()).toThrow();
		expect(() => new Date(123).getSeconds()).toThrow();
		expect(() => new Date(123).getMilliseconds()).toThrow();
		expect(() => new Date(123).getTimezoneOffset()).toThrow();
		expect(() => (new Date(123) as any).setYear(1)).toThrow();
		expect(() => new Date(123).setFullYear(1)).toThrow();
		expect(() => new Date(123).setMonth(1)).toThrow();
		expect(() => new Date(123).setDate(1)).toThrow();
		expect(() => new Date(123).setHours(1)).toThrow();
		expect(() => new Date(123).setMinutes(1)).toThrow();
		expect(() => new Date(123).setSeconds(1)).toThrow();
		expect(() => new Date(123).setMilliseconds(1)).toThrow();

		//These functions should not throw while sandboxed
		expect(() => JSON.parse("asdfasdfasd")).not.toThrow();
		expect(() => encodeURI("\uD800")).not.toThrow();
		expect(() => encodeURIComponent("\uD800")).not.toThrow();
		expect(() => decodeURI("%E0%A4%A")).not.toThrow();
		expect(() => decodeURIComponent("%E0%A4%A")).not.toThrow();

		Sandbox.unSandbox();
	});

	describe("Outside sandbox", () => {
		it("Async function", () => expect(() => setInterval(() => { }, 1000)).not.toThrow());
		it("Async function", () => expect(() => setTimeout(() => { }, 10)).not.toThrow());
		it("Async function", () => expect(() => setImmediate(() => { })).not.toThrow());
		it("Non-deterministic functions", () => expect(() => Math.random()).not.toThrow());
		it("Non-deterministic functions", () => expect(() => Date.now()).not.toThrow());
		it("Non-deterministic functions", () => expect(() => new Date()).not.toThrow());
		it("Local format", () => expect("A".toLocaleLowerCase()).toBe("a"));
		it("Local format", () => expect("a".toLocaleUpperCase()).toBe("A"));
		it("Local format", () => expect("a".localeCompare("a")).toBe(0));
		it("Local format", () => expect([].toLocaleString()).toBe(""));
		it("Local format", () => expect(Number(123).toLocaleString()).toBe("123"));
		it("Local format", () => expect(Number(12345).toLocaleString()).not.toBe("12345"));
		it("Local format", () => expect(typeof (global as any).BigInt !== "undefined" ? eval("[123n][0].toLocaleString()") : "123").toBe("123"));
		it("Uninitialized memory", () => expect(() => Buffer.allocUnsafe(10)).not.toThrow());
		it("Uninitialized memory", () => expect(() => Buffer.allocUnsafeSlow(10)).not.toThrow());
		it("Implementation details", () => expect(() => new Function().toString()).not.toThrow());
		it("Local timezone", () => expect(() => new Date("1234-1-1")).not.toThrow());
		it("Local timezone", () => expect(() => new Date(1234, 1, 1)).not.toThrow());
		it("Local timezone", () => expect(() => Date.parse("1234-1-1")).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).toDateString()).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).toLocaleDateString()).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).toLocaleString()).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).toString()).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).toTimeString()).not.toThrow());
		it("Local timezone", () => expect(() => (new Date(123) as any).toGMTString()).not.toThrow());
		it("Local timezone", () => expect(() => (new Date(123) as any).getYear()).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).getFullYear()).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).getMonth()).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).getDay()).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).getDate()).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).getHours()).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).getMinutes()).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).getSeconds()).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).getMilliseconds()).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).getTimezoneOffset()).not.toThrow());
		it("Local timezone", () => expect(() => (new Date(123) as any).setYear(1)).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).setFullYear(1)).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).setMonth(1)).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).setDate(1)).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).setHours(1)).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).setMinutes(1)).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).setSeconds(1)).not.toThrow());
		it("Local timezone", () => expect(() => new Date(123).setMilliseconds(1)).not.toThrow());

		//These functions should throw while not sandboxed
		it("JSON.parse", () => expect(() => JSON.parse("asdfasdfasd")).toThrow());
		it("encodeURI", () => expect(() => encodeURI("\uD800")).toThrow());
		it("encodeURIComponent", () => expect(() => encodeURIComponent("\uD800")).toThrow());
		it("decodeURI", () => expect(() => decodeURI("%E0%A4%A")).toThrow());
		it("decodeURIComponent", () => expect(() => decodeURIComponent("%E0%A4%A")).toThrow());
	});
});