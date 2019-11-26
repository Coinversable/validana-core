/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
import * as Raven from "raven";
/** Different colors for the terminal to provide a better overview. */
export declare enum c {
    red = "\u001B[31m",
    green = "\u001B[32m",
    yellow = "\u001B[33m",
    blue = "\u001B[34m",
    magenta = "\u001B[35m",
    cyan = "\u001B[36m",
    grey = "\u001B[90m",
    lred = "\u001B[91m",
    lgreen = "\u001B[92m",
    lyellow = "\u001B[93m",
    lblue = "\u001B[94m",
    lmagenta = "\u001B[95m",
    lcyan = "\u001B[96m",
    white = "\u001B[39m"
}
export declare class Log {
    private static reportErrors;
    static readonly Debug = 0;
    static readonly Info = 1;
    static readonly Warning = 2;
    static readonly Error = 3;
    static readonly Fatal = 4;
    static readonly None = 5;
    static Level: number;
    /** Available options: $color, $timestamp, $message, $error, $severity */
    static LogFormat: string;
    static options: Raven.CaptureOptions & {
        tags: {};
        extra: {};
    };
    /**
     * Set this logger to report errors. Will log a warning if errors cannot be reported.
     * @throws If the url is not properly formatted.
     */
    static setReportErrors(dns: string | undefined): void;
    /** Is this logger registerd to report errors. */
    static isReportingErrors(): boolean;
    /**
     * Detailed information about the program flow that is used for debugging problems.
     * @param msg Description of the issue
     * @param error An optional error that may have arisen
     */
    static debug(msg: string, error?: Error): void;
    /**
     * Significant things that occur in normal circumstances.
     * @param msg Description of the issue
     * @param error An optional error that may have arisen
     */
    static info(msg: string, error?: Error): void;
    /**
     * Problems which may occur in abnormal circumstances (loss of connection, etc), but are dealt with by the program.
     * @param msg Description of the issue
     * @param error An optional error that may have arisen
     */
    static warn(msg: string, error?: Error): void;
    /**
     * Errors which require modifying the program, because they should never happen.
     * @param msg Description of the issue, if no error is provided make sure it is a fixed text message.
     * @param error An optional error that may have arisen
     */
    static error(msg: string, error?: Error | undefined): Promise<void>;
    /**
     * The kind of errors for which no recovery is possible, possibly including restarting the program.
     * @param msg Description of the issue, if no error is provided make sure it is a fixed text message.
     * @param error An optional error that may have arisen
     */
    static fatal(msg: string, error?: Error | undefined): Promise<void>;
    private static captureError;
    private static captureMessage;
}
