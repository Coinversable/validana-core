
import { Log } from "../../index";

// tslint:disable:no-console
describe("Log", () => {
	beforeAll(() => {
		//Do not spam process output. If sandboxing is done first this is no longer needed nor possible.
		try {
			console.debug = () => { };
			console.log = () => { };
			console.info = () => { };
			console.warn = () => { };
			console.error = () => { };
		} catch (error) { }
	});

	describe("Log level none", () => {
		beforeAll(() => Log.Level = Log.None);

		it("Log debug error", () => expect(() => Log.debug("test")).not.toThrow());
		it("Log debug error", () => expect(() => Log.debug("test", new Error("test"))).not.toThrow());
		it("Log info error", () => expect(() => Log.info("test")).not.toThrow());
		it("Log info error", () => expect(() => Log.info("test", new Error("test"))).not.toThrow());
		it("Log warn error", () => expect(() => Log.warn("test")).not.toThrow());
		it("Log warn error", () => expect(() => Log.warn("test", new Error("test"))).not.toThrow());
		it("Log error error", () => expect(() => Log.error("test")).not.toThrow());
		it("Log error error", () => expect(() => Log.error("test", new Error("test123"))).not.toThrow());
		it("Log fatal error", () => expect(() => Log.fatal("test")).not.toThrow());
		it("Log fatal error", () => expect(() => Log.fatal("test", new Error("test123"))).not.toThrow());
	});
	describe("Log level debug", () => {
		beforeAll(() => Log.Level = Log.Debug);

		it("Log debug error", () => expect(() => Log.debug("test")).not.toThrow());
		it("Log debug error", () => expect(() => Log.debug("test", new Error("test"))).not.toThrow());
		it("Log info error", () => expect(() => Log.info("test")).not.toThrow());
		it("Log info error", () => expect(() => Log.info("test", new Error("test"))).not.toThrow());
		it("Log warn error", () => expect(() => Log.warn("test")).not.toThrow());
		it("Log warn error", () => expect(() => Log.warn("test", new Error("test"))).not.toThrow());
		it("Log error error", () => expect(() => Log.error("test")).not.toThrow());
		it("Log error error", () => expect(() => Log.error("test", new Error("test"))).not.toThrow());
		it("Log fatal error", () => expect(() => Log.fatal("test")).not.toThrow());
		it("Log fatal error", () => expect(() => Log.fatal("test", new Error("test"))).not.toThrow());
	});

	//it("Is reporting errors status start", () => expect(Log.isReportingErrors()).toBe(false));
	//it("Set report errors invalid url", () => expect(() => Log.setReportErrors("asdf")).toThrow());
	describe("Log with sentry", () => {
		beforeAll(() => {
			Log.Level = Log.Debug;
			Log.setReportErrors("https://abcdef1234567890abcdef1234567890:abcdef1234567890abcdef1234567890@localhost:23748/3");
		});

		afterAll(() => {
			Log.setReportErrors(undefined);
		});

		//We use localhost with a random port for testing to not spam a server. This means all error reporting will fail.
		it("Is reporting errors status", () => expect(Log.isReportingErrors()).toBe(true));
		it("Log info error", () => expect(() => Log.info("test")).not.toThrow());
		it("Log info error", () => expect(() => Log.info("test", new Error("test"))).not.toThrow());
		it("Log warn error", () => expect(() => Log.warn("test")).not.toThrow());
		it("Log warn error", () => expect(() => Log.warn("test", new Error("test"))).not.toThrow());
		it("Log error error", async () => await expectAsync(Log.error("test")).toBeResolved());
		it("Log error error", async () => await expectAsync(Log.error("test", new Error("test"))).toBeResolved());
		it("Log fatal error", async () => await expectAsync(Log.fatal("test")).toBeResolved());
		it("Log fatal error", async () => await expectAsync(Log.fatal("test", new Error("test"))).toBeResolved());
	});
});