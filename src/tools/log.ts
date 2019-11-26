/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import * as Raven from "raven";
import * as os from "os";
import { Sandbox } from "../basics/sandbox";
Raven.disableConsoleAlerts();

/** Different colors for the terminal to provide a better overview. */
export enum c {
	red = "\x1b[31m", green = "\x1b[32m", yellow = "\x1b[33m", blue = "\x1b[34m", magenta = "\x1b[35m", cyan = "\x1b[36m", grey = "\x1b[90m",
	lred = "\x1b[91m", lgreen = "\x1b[92m", lyellow = "\x1b[93m", lblue = "\x1b[94m", lmagenta = "\x1b[95m", lcyan = "\x1b[96m", white = "\x1b[39m"
}

// tslint:disable:no-console , no-null-keyword
export class Log {
	private static reportErrors: boolean = false;

	public static readonly Debug = 0;
	public static readonly Info = 1;
	public static readonly Warning = 2;
	public static readonly Error = 3;
	public static readonly Fatal = 4;
	public static readonly None = 5;
	public static Level = Log.Warning;
	/** Available options: $color, $timestamp, $message, $error, $severity */
	public static LogFormat = "$color$timestamp: $message: $error";
	public static options: Raven.CaptureOptions & { tags: {}; extra: {} } = {
		tags: {
			coreVersion: require("../../package.json").version,
			nodejsVersion: process.versions.node,
			arch: process.arch,
			platform: process.platform,
			platformVersion: os.release(),
			endian: os.endianness() //Almost all systems use LE, leaving BE mostly untested both for Node.js and this program
		},
		extra: {}
	};

	/**
	 * Set this logger to report errors. Will log a warning if errors cannot be reported.
	 * @throws If the url is not properly formatted.
	 */
	public static setReportErrors(dns: string | undefined): void {
		if (dns === undefined) {
			Log.reportErrors = false;
		} else {
			Log.reportErrors = true;
			Raven.config(dns);
			//Hack to allow capturing breadcrumbs without creating uncaughtException handler
			//https://github.com/getsentry/raven-node/issues/307
			(Raven as any).installed = true;
		}
	}

	/** Is this logger registerd to report errors. */
	public static isReportingErrors(): boolean {
		return Log.reportErrors;
	}

	/**
	 * Detailed information about the program flow that is used for debugging problems.
	 * @param msg Description of the issue
	 * @param error An optional error that may have arisen
	 */
	public static debug(msg: string, error?: Error): void {
		if (Log.Level <= Log.Debug) {
			console.log(Log.LogFormat
				.replace("$color", c.grey)
				.replace("$timestamp", new Sandbox.special.Date().toISOString())
				.replace("$severity", "debug")
				.replace("$message", msg)
				.replace("$error", error == null ? "" : error.stack!)
				.concat(c.white));
		}
		//We never capture debug information for reporting errors.
	}

	/**
	 * Significant things that occur in normal circumstances.
	 * @param msg Description of the issue
	 * @param error An optional error that may have arisen
	 */
	public static info(msg: string, error?: Error): void {
		if (Log.Level <= Log.Info) {
			console.log(Log.LogFormat
				.replace("$color", c.white)
				.replace("$timestamp", new Sandbox.special.Date().toISOString())
				.replace("$severity", "info")
				.replace("$message", msg)
				.replace("$error", error == null ? "" : error.stack!)
				.concat(c.white));
		}
		if (Log.reportErrors) {
			if (error != null) {
				Raven.captureBreadcrumb({ level: "info", message: msg, data: { stack: error.stack } });
			} else {
				Raven.captureBreadcrumb({ level: "info", message: msg });
			}
		}
	}

	/**
	 * Problems which may occur in abnormal circumstances (loss of connection, etc), but are dealt with by the program.
	 * @param msg Description of the issue
	 * @param error An optional error that may have arisen
	 */
	public static warn(msg: string, error?: Error): void {
		if (Log.Level <= Log.Warning) {
			console.log(Log.LogFormat
				.replace("$color", c.yellow)
				.replace("$timestamp", new Sandbox.special.Date().toISOString())
				.replace("$severity", "warning")
				.replace("$message", msg)
				.replace("$error", error == null ? "" : error.stack!)
				.concat(c.white));
		}
		if (Log.reportErrors) {
			if (error != null) {
				Raven.captureBreadcrumb({ level: "warning", message: msg, data: { stack: error.stack } });
			} else {
				Raven.captureBreadcrumb({ level: "warning", message: msg });
			}
		}
	}

	/**
	 * Errors which require modifying the program, because they should never happen.
	 * @param msg Description of the issue, if no error is provided make sure it is a fixed text message.
	 * @param error An optional error that may have arisen
	 */
	public static async error(msg: string, error?: Error | undefined): Promise<void> {
		if (Log.Level <= Log.Error) {
			console.error(Log.LogFormat
				.replace("$color", c.lred)
				.replace("$timestamp", new Sandbox.special.Date().toISOString())
				.replace("$severity", "error")
				.replace("$message", msg)
				.replace("$error", error == null ? "" : error.stack!)
				.concat(c.white));
		}
		if (Log.reportErrors) {
			Log.options.level = "error";
			if (error != null) {
				Log.options.extra.message = msg;
				return Log.captureError(error, Log.options);
			} else {
				return Log.captureMessage(msg, Log.options);
			}
		}
	}

	/**
	 * The kind of errors for which no recovery is possible, possibly including restarting the program.
	 * @param msg Description of the issue, if no error is provided make sure it is a fixed text message.
	 * @param error An optional error that may have arisen
	 */
	public static async fatal(msg: string, error?: Error | undefined): Promise<void> {
		if (Log.Level <= Log.Fatal) {
			console.error(Log.LogFormat
				.replace("$color", c.red)
				.replace("$timestamp", new Sandbox.special.Date().toISOString())
				.replace("$severity", "fatal")
				.replace("$message", msg)
				.replace("$error", error == null ? "" : error.stack!)
				.concat(c.white));
		}
		if (Log.reportErrors) {
			Log.options.level = "fatal";
			if (error != null) {
				Log.options.extra.message = msg;
				return Log.captureError(error, Log.options);
			} else {
				return Log.captureMessage(msg, Log.options);
			}
		}
	}

	private static captureError(error: Error, options: Raven.CaptureOptions): Promise<void> {
		return new Promise<void>((resolve) => {
			Raven.captureException(error, options, (err) => {
				if (err != null) {
					Log.warn("Could not report error, is the sentry url valid?", err);
				}
				resolve();
			});
		});
	}

	private static captureMessage(message: string, options: Raven.CaptureOptions): Promise<void> {
		return new Promise<void>((resolve) => {
			Raven.captureMessage(message, options, (err) => {
				if (err != null) {
					Log.warn("Could not report error, is the sentry url valid?", err);
				}
				resolve();
			});
		});
	}
}