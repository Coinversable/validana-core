/// <reference types="node" />
import { Client, QueryResult } from "pg";
import { Transaction, DBTransaction } from "./transaction";
export declare type InitFunction = (from: string, block: number, processor: string, previousBlockTimestamp: number, previousBlockHash: string, query: Function) => {} | undefined;
export declare type CodeFunction = (payload: object, from: string, block: number, processor: string, previousBlockTimestamp: number, previousBlockHash: string, query: Function) => {} | undefined;
export interface Template {
    [index: string]: {
        type: string;
        desc?: string;
        name?: string;
    };
}
export interface CreatePayload {
    type: string;
    version: string;
    description: string;
    template: string;
    init: string;
    code: string;
}
export interface DeletePayload {
    hash: string;
}
export interface DatabaseClient {
    user: string;
    database: string;
    password?: string;
    port: number;
    host: string;
}
export declare enum TxStatus {
    New = "new",
    ProcessingAccepted = "processing_accepted",
    ProcessingRejected = "processing_rejected",
    Invalid = "invalid",
    Accepted = "accepted",
    Rejected = "rejected",
}
export interface Contract {
    creator: string;
    type: string;
    template: Template;
    code: CodeFunction;
}
export interface QueryStatus extends QueryResult {
    error?: Error;
}
export declare class Basic {
    protected static readonly createContractHash: Buffer;
    private static readonly createContractTemplate;
    protected static readonly deleteContractHash: Buffer;
    private static readonly deleteContractTemplate;
    static readonly AsyncFunction: FunctionConstructor;
    protected readonly contractMap: Map<string, Contract>;
    protected signPrefix: Buffer | undefined;
    protected static txInvalidReason: string | undefined;
    protected static txRejectReason: string | undefined;
    protected static txShouldRetry: boolean;
    protected static txContractHash: Buffer;
    private static isCreatingContract;
    private static isSpecialContract;
    protected static client: Client | undefined;
    protected readonly dbclient: DatabaseClient;
    constructor(dbclient: DatabaseClient, signPrefix?: Buffer);
    protected loadSmartContracts(): Promise<Error | undefined>;
    protected processTx(tx: DBTransaction | Buffer | Transaction, currentBlockId: number, processorAddress: string, previousBlockTs: number, previousBlockHash: Buffer, verifySignature?: boolean): Promise<void>;
    private createContract(payload, from, currentBlockId, processor, previousBlockTs, previousBlockHash);
    private checkCode(code, contractName);
    private deleteContract(payload, from);
    protected connect(): Promise<void>;
    protected query(query: string, values: Array<string | number | boolean | Buffer>, name?: string): Promise<QueryStatus>;
    private querySC(action, table, info, params, usePrivate?);
    static shutdown(exitCode?: number): Promise<never>;
}
