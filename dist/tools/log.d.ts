import * as Raven from "raven";
export declare class Log {
    static readonly Debug = 0;
    static readonly Info = 1;
    static readonly Warning = 2;
    static readonly Error = 3;
    static readonly Fatal = 4;
    static readonly None = 5;
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
    private static captureError;
    private static captureMessage;
}
