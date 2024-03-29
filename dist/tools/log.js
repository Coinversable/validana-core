"use strict";
/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Log = exports.c = void 0;
const os = require("os");
const Sentry = require("@sentry/node");
const sandbox_1 = require("../basics/sandbox");
var c;
(function (c) {
    c["red"] = "\u001B[31m";
    c["green"] = "\u001B[32m";
    c["yellow"] = "\u001B[33m";
    c["blue"] = "\u001B[34m";
    c["magenta"] = "\u001B[35m";
    c["cyan"] = "\u001B[36m";
    c["grey"] = "\u001B[90m";
    c["lred"] = "\u001B[91m";
    c["lgreen"] = "\u001B[92m";
    c["lyellow"] = "\u001B[93m";
    c["lblue"] = "\u001B[94m";
    c["lmagenta"] = "\u001B[95m";
    c["lcyan"] = "\u001B[96m";
    c["white"] = "\u001B[39m";
})(c = exports.c || (exports.c = {}));
class Log {
    static setReportErrors(dsn) {
        if (dsn === undefined) {
            Log.reportErrors = false;
        }
        else {
            Log.reportErrors = true;
            Sentry.init({
                dsn,
                defaultIntegrations: false
            });
        }
    }
    static isReportingErrors() {
        return Log.reportErrors;
    }
    static debug(msg, error) {
        if (Log.Level <= Log.Debug) {
            console.log(Log.LogFormat
                .replace("$color", c.grey)
                .replace("$timestamp", new sandbox_1.Sandbox.special.Date().toISOString())
                .replace("$severity", "debug")
                .replace("$message", msg)
                .replace("$error", error == null ? "" : error.stack)
                .concat(c.white));
        }
    }
    static info(msg, error) {
        if (Log.Level <= Log.Info) {
            console.log(Log.LogFormat
                .replace("$color", c.white)
                .replace("$timestamp", new sandbox_1.Sandbox.special.Date().toISOString())
                .replace("$severity", "info")
                .replace("$message", msg)
                .replace("$error", error == null ? "" : error.stack)
                .concat(c.white));
        }
        if (Log.reportErrors) {
            if (error != null) {
                Sentry.addBreadcrumb({ level: Sentry.Severity.Info, message: msg, data: { stack: error.stack } });
            }
            else {
                Sentry.addBreadcrumb({ level: Sentry.Severity.Info, message: msg });
            }
        }
    }
    static warn(msg, error) {
        if (Log.Level <= Log.Warning) {
            console.log(Log.LogFormat
                .replace("$color", c.yellow)
                .replace("$timestamp", new sandbox_1.Sandbox.special.Date().toISOString())
                .replace("$severity", "warning")
                .replace("$message", msg)
                .replace("$error", error == null ? "" : error.stack)
                .concat(c.white));
        }
        if (Log.reportErrors) {
            if (error != null) {
                Sentry.addBreadcrumb({ level: Sentry.Severity.Warning, message: msg, data: { stack: error.stack } });
            }
            else {
                Sentry.addBreadcrumb({ level: Sentry.Severity.Warning, message: msg });
            }
        }
    }
    static async error(msg, error) {
        if (Log.Level <= Log.Error) {
            console.error(Log.LogFormat
                .replace("$color", c.lred)
                .replace("$timestamp", new sandbox_1.Sandbox.special.Date().toISOString())
                .replace("$severity", "error")
                .replace("$message", msg)
                .replace("$error", error == null ? "" : error.stack)
                .concat(c.white));
        }
        if (Log.reportErrors) {
            if (error != null) {
                Sentry.captureException(error, Object.assign({ level: Sentry.Severity.Error, extra: { message: msg } }, this.options));
                return Sentry.flush(2000);
            }
            else {
                Sentry.captureMessage(msg, Object.assign({ level: Sentry.Severity.Error }, this.options));
                return Sentry.flush(2000);
            }
        }
        else {
            return false;
        }
    }
    static async fatal(msg, error) {
        if (Log.Level <= Log.Fatal) {
            console.error(Log.LogFormat
                .replace("$color", c.red)
                .replace("$timestamp", new sandbox_1.Sandbox.special.Date().toISOString())
                .replace("$severity", "fatal")
                .replace("$message", msg)
                .replace("$error", error == null ? "" : error.stack)
                .concat(c.white));
        }
        if (Log.reportErrors) {
            if (error != null) {
                Sentry.captureException(error, Object.assign({ level: Sentry.Severity.Fatal, extra: { message: msg } }, this.options));
                return Sentry.flush(2000);
            }
            else {
                Sentry.captureException(error, Object.assign({ level: Sentry.Severity.Fatal }, this.options));
                return Sentry.flush(2000);
            }
        }
        else {
            return false;
        }
    }
}
exports.Log = Log;
Log.reportErrors = false;
Log.Debug = 0;
Log.Info = 1;
Log.Warning = 2;
Log.Error = 3;
Log.Fatal = 4;
Log.None = 5;
Log.Level = Log.Warning;
Log.LogFormat = "$color$timestamp: $message: $error";
Log.options = {
    tags: {
        coreVersion: require("../../package.json").version,
        nodejsVersion: process.versions.node,
        arch: process.arch,
        platform: process.platform,
        platformVersion: os.release(),
        endian: os.endianness()
    },
    extra: {}
};
//# sourceMappingURL=log.js.map