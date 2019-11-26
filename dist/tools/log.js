"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Raven = require("raven");
const os = require("os");
var c;
(function (c) {
    c["red"] = "\u001B[31m";
    c["green"] = "\u001B[32m";
    c["yellow"] = "\u001B[33m";
    c["blue"] = "\u001B[34m";
    c["mangata"] = "\u001B[35m";
    c["cyan"] = "\u001B[36m";
    c["white"] = "\u001B[37m";
    c["grey"] = "\u001B[90m";
})(c || (c = {}));
class Log {
    static setReportErrors(dns) {
        Log.reportErrors = true;
        Raven.config(dns);
    }
    static isReportingErrors() {
        return Log.reportErrors;
    }
    static debug(msg, error) {
        if (Log.Level <= Log.Debug) {
            console.log(`${c.grey}${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}${c.white}`);
        }
    }
    static info(msg, error) {
        if (Log.Level <= Log.Info) {
            console.log(`${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}`);
        }
        if (Log.reportErrors) {
            if (error !== undefined) {
                Raven.captureBreadcrumb({ level: "info", message: msg, data: { stack: error.stack } });
            }
            else {
                Raven.captureBreadcrumb({ level: "info", message: msg });
            }
        }
    }
    static warn(msg, error) {
        if (Log.Level <= Log.Warning) {
            console.log(`${c.yellow}${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}${c.white}`);
        }
        if (Log.reportErrors) {
            if (error !== undefined) {
                Raven.captureBreadcrumb({ level: "warning", message: msg, data: { stack: error.stack } });
            }
            else {
                Raven.captureBreadcrumb({ level: "warning", message: msg });
            }
        }
    }
    static async error(msg, error) {
        if (Log.Level <= Log.Error) {
            console.error(`${c.red}${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}${c.white}`);
        }
        if (Log.reportErrors) {
            Log.options.level = "error";
            if (error !== undefined) {
                Log.options.extra.message = msg;
                return Log.captureError(error, Log.options);
            }
            else {
                return Log.captureMessage(msg, Log.options);
            }
        }
    }
    static async fatal(msg, error) {
        if (Log.Level <= Log.Fatal) {
            console.error(`${c.red}${new Date().toISOString()}: ${msg}${error !== undefined ? `: ${error.stack}` : ""}${c.white}`);
        }
        if (Log.reportErrors) {
            Log.options.level = "fatal";
            if (error !== undefined) {
                Log.options.extra.message = msg;
                return Log.captureError(error, Log.options);
            }
            else {
                return Log.captureMessage(msg, Log.options);
            }
        }
    }
    static captureError(error, options) {
        return new Promise((resolve) => {
            Raven.captureException(error, options, (err) => {
                if (err !== null && err !== undefined) {
                    Log.warn("Could not report error, is the sentry url valid?");
                }
                resolve();
            });
        });
    }
    static captureMessage(message, options) {
        return new Promise((resolve) => {
            Raven.captureMessage(message, options, (err) => {
                if (err !== null && err !== undefined) {
                    Log.warn("Could not report error, is the sentry url valid?");
                }
                resolve();
            });
        });
    }
}
exports.Log = Log;
Log.Debug = 0;
Log.Info = 1;
Log.Warning = 2;
Log.Error = 3;
Log.Fatal = 4;
Log.None = 5;
Log.Level = Log.Warning;
Log.reportErrors = false;
Log.options = {
    tags: {
        coreVersion: "1.0.0",
        nodejsVersion: process.versions.node,
        arch: process.arch,
        platform: process.platform,
        platformVersion: os.release(),
        endian: os.endianness()
    },
    extra: {}
};
