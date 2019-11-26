/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
/// <reference types="node" />
import { Client, QueryResult } from "pg";
import { Transaction, DBTransaction } from "./transaction";
/** Required params to connect to the database. */
export interface DatabaseClient {
    user: string;
    database: string;
    password?: string;
    port: number;
    host: string;
}
/** Possible values for transaction status as found in the database. */
export declare enum TxStatus {
    New = "new",
    Invalid = "invalid",
    Accepted = "accepted",
    Rejected = "rejected"
}
export declare type InitFunction = (from: string, block: number, processor: string, previousBlockTimestamp: number, previousBlockHash: string, transactionId: string, currentBlockTimestamp: number) => Promise<unknown>;
export declare type CodeFunction = (payload: object, from: string, block: number, processor: string, previousBlockTimestamp: number, previousBlockHash: string, transactionId: string, currentBlockTimestamp: number) => Promise<unknown>;
/** Part of a contract that is needed for the processor/node. */
export interface Contract {
    creator: string;
    type: string;
    template: Template;
    code: CodeFunction;
    validanaVersion: ContractVersion;
}
/** Possible versions of a contract. */
export declare type ContractVersion = 1 | 2;
/** Template of a contract. */
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
    template: string | Template;
    init: string;
    code: string;
    validanaVersion?: ContractVersion;
}
export interface DeletePayload {
    hash: string;
}
/** The result of processTx. */
export interface ProcessTxResult {
    /**
     * Transactions should be rolled back if (and only if) it is not put in a block.
     * accepted and v1Rejected SHOULD be put into a block.
     * rejected MAY be put into a block.
     * Invalid and retry SHOULD NOT be put into a block.
     */
    status: TxStatus.Accepted | TxStatus.Rejected | TxStatus.Invalid | "v1Rejected" | "retry";
    message: string;
}
/** The result of query for smart contracts. */
export interface QuerySCResult {
    rows: Array<{
        [key: string]: any;
    }>;
    rowCount: number | null;
}
/** Basic functionality needed for the processor and node to process transactions and blocks. */
export declare class Basic {
    protected static readonly createContractHash: Buffer;
    private static readonly createContractTemplate;
    protected static readonly deleteContractHash: Buffer;
    private static readonly deleteContractTemplate;
    /** Async function constructor. */
    static readonly AsyncFunction: FunctionConstructor;
    /** Map with contracts, using the contractHash (as utf8 string) as identifier. */
    protected readonly contractMap: Map<string, Contract>;
    /** The prefix to use for signing blocks and transactions in this blockchain. */
    protected signPrefix: Buffer | undefined;
    /** Hook to call when it starts and ends an init contract, which may take much longer then normal. */
    private readonly initHook;
    /** If it is currently processing a transaction or not. */
    protected isProcessing: boolean;
    /** An error that occured during execution of smart contract, will be reported once execution finished. */
    private static txError;
    private static txErrorExitCode;
    /** Is the current transaction invalid for any reason. Should not be added to the blockchain in this case. */
    private static txInvalidReason;
    /** Did the contract reject the transaction for any reason. Add to blockchain depending on settings. */
    private static txRejectReason;
    /** Did the contract succeed? Add to blockchain in this case. */
    private static txAcceptReason;
    /** Should the transaction be retried later? (e.g. due to having no database connection.) */
    private static txShouldRetry;
    /** Any fast processing queries that do not need to be awaited during the contract. */
    private static processFastQueries;
    /** Contract hash of the transaction being executed. */
    protected static txContractHash: Buffer;
    /** Is a create contract/delete being executed? */
    private static isSpecialContract;
    /** The database client */
    protected static client: Client | undefined;
    /** Params used to connect to the database. */
    protected readonly dbclient: DatabaseClient;
    /** Has shutdown() be called (but not yet finished)? */
    protected static isShuttingDown: boolean;
    /**
     * Create the basics and make various functions available to smart contracts through global space.
     * @param dbclient Information for the connection to the database.
     * @param signPrefix The prefix used for signing and validating, can be set now or later.
     * @param initHook A hook that will be called when it starts/stops creating a contract.
     */
    constructor(dbclient: DatabaseClient, signPrefix?: Buffer, initHook?: (init: boolean) => void);
    /**
     * Loads existing smart contracts from the database.
     * Note that it will not connect to the database if it was not yet connected!
     */
    protected loadSmartContracts(): Promise<void>;
    /**
     * Executes the smart contract of a transaction.
     * The executor must run "BEGIN; SET LOCAL ROLE smartcontract;" prior to calling this method.
     * In case retry is returned the transaction should be retried later.
     * In case rollback is returned the database should "ROLLBACK;" and loadSmartContracts() should be called again before continuing.
     * @param tx The transaction to process
     * @param currentBlockId The id of the current block
     * @param currentBlockTs The time at which the current block is being processed
     * @param processorAddress The address of the processor
     * @param previousBlockTs The time at which the previous block was processed
     * @param previousBlockHash The hash of the previous block
     * @param verifySignature Whether or not the signature of the transaction should be verified
     */
    protected processTx(unvalidatedTx: DBTransaction | Buffer | Transaction, currentBlockId: number, currentBlockTs: number, processorAddress: string, previousBlockTs: number, previousBlockHash: Buffer, verifySignature?: boolean): Promise<ProcessTxResult>;
    /**
     * Validate if a transaction is formatted correctly, signed correctly, not expired, etc.
     * Return undefined if the transaction is not valid.
     * @param unvalidatedTx A transaction (that has not been validated yet, otherwise this method does nothing)
     * @param previousBlockTs The previous block timestamp
     * @param verifySignature Whether the signature must be validated, or if this has been done already
     */
    private validateTx;
    /**
     * Finish processing a transaction. Will report back what should be done with the transaction.
     * @param validatedTx The validated transaction.
     */
    private finishProcessingTx;
    /**
     * Create a new contract.
     * @param payload The payload of the transaction
     * @param from Who created this transaction
     * @param currentBlockId The id of the current block
     * @param processorAddress The address of the processor
     * @param previousBlockTs The time at which the previous block was processed
     * @param previousBlockHash The hash of the previous block
     * @throws May throw if there are problems, but properly just rejects.
     */
    private createContract;
    /**
     * Checks if a code contains invalid code.
     * @param code The code to check
     * @param contractName The name of the contract for which the code is being checked.
     * @returns An error string if something is wrong with the code or undefined if there were no errors
     */
    private checkCode;
    /**
     * Delete an existing contract.
     * @param payload The payload of the transaction
     * @param from Who created this transaction
     */
    private deleteContract;
    /**
     * Connects to the database.
     * Make sure to only connect at the start of mining a block, to prevent errors and ensure rollbacks occur when needed.
     * @returns true if it did connect, false if it was already connected
     */
    protected connect(): Promise<boolean>;
    /**
     * Query the database.
     * To prevent accidental sql injections params is a required parameter and should just be an empty array if there are none.
     * @param query The query to execute
     * @param params The params of the query (to prevent sql-injections)
     * @param name The name of the transaction (used for prepared statements to speed up the process)
     */
    protected query(query: string, params: any[], name?: string): Promise<QueryResult>;
    /**
     * Send a query to the database from inside a smart contract.
     * To prevent accidental sql injections params is a required parameter and should just be an empty array if there are none.
     * @param query The query to execute
     * @param params The params of the query (to prevent sql-injections)
     * @throws if not called correctly or there are problems with the database connection.
     */
    static querySC(query: string, params: unknown[]): Promise<QuerySCResult>;
    /**
     * The same as querySC, except this method never returns anything and never throws.
     * Can be used without awaiting, for example with insert queries, though transactions will be invalidated if it throws.
     * @param query The query to execute
     * @param params The params of the query (to prevent sql-injections)
     */
    static querySCFast(query: string, params: unknown[]): void;
    /** Convert the old querySC format to a new one. */
    private static convertV1;
    /**
     * Allows a smart contract to reject the transaction it is currently executing.
     * @param reason The reason why the transaction is rejected
     */
    static reject(reason: string): void;
    /**
     * Mark a transaction as invalid.
     * @param reason The reason this transaction is not valid.
     * @param retry Should we retry this transaction later or not.
     * @param error An error that may have occured that is the reason this transaction is invalid.
     * @param exitCode Should the program exit due to an error it cannot recover from.
     */
    private static invalidate;
    /**
     * Shutdown the process (after closing the database connection). Current block will not be finished anymore.
     * @param exitCode The exit code. An error code between 50 and 59 means it should stay down due to an error it cannot recover from.
     * @param message If given this message will be reported as a fatal error before shutdown.
     * @param error If given this will be reported as a fatal error before shutdown.
     */
    static shutdown(exitCode?: number, message?: string, error?: Error): Promise<never>;
}
