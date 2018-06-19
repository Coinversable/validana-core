import * as Raven from "raven";
export declare class Log {
    static readonly Debug: number;
    static readonly Info: number;
    static readonly Warning: number;
    static readonly Error: number;
    static readonly Fatal: number;
    static readonly None: number;
    static Level: number;
    private static reportErrors;
    static options: Raven.CaptureOptions;
    static setReportErrors(dns: string): void;
    static isReportingErrors(): boolean;
    static debug(msg: string, error?: Error): void;
    static info(msg: string, error?: Error): void;
    static warn(msg: string, error?: Error): void;
    static error(msg: string, error?: Error | undefined): Promise<void>;
    static fatal(msg: string, error?: Error | undefined): Promise<void>;
    private static captureError(error, options);
    private static captureMessage(message, options);
}
