/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import { Client, QueryResult, QueryConfig, types } from "pg";
import { Log } from "../tools/log";
import { Crypto } from "../tools/crypto";
import { Sandbox } from "./sandbox";
import { Transaction, DBTransaction } from "./transaction";

/** Make sure if we query the database any BIGINT (array)s are returned as a number, instead of a string. */
types.setTypeParser(20, (val: string) => Number.parseInt(val, 10));
types.setTypeParser(1016, (val: string) => val.length === 2 ? [] : val.slice(1, -1).split(",").map((v) => Number.parseInt(v, 10)));

//#region Interfaces

/** Required params to connect to the database. */
export interface DatabaseClient {
	user: string;
	database: string;
	password?: string;
	port: number;
	host: string;
}

/** Possible values for transaction status as found in the database. */
export enum TxStatus {
	New = "new", //Not yet processed by processor
	Invalid = "invalid", //Considered invalid by the processor (e.g. wrong signature, syntax errors in contract execution)
	Accepted = "accepted", //Processed by processor, contract executed without errors
	Rejected = "rejected" //Processed by processor, contract returned that it rejected the result
}

//Make sure code and init funcion are called correctly by giving them a type.
export type InitFunction = (from: string, block: number, processor: string,
	previousBlockTimestamp: number, previousBlockHash: string, transactionId: string, currentBlockTimestamp: number) => Promise<unknown>;
export type CodeFunction = (payload: object, from: string, block: number, processor: string,
	previousBlockTimestamp: number, previousBlockHash: string, transactionId: string, currentBlockTimestamp: number) => Promise<unknown>;

/** Part of a contract that is needed for the processor/node. */
export interface Contract {
	creator: string;
	type: string;
	template: Template;
	code: CodeFunction;
	validanaVersion: ContractVersion;
}
/** Possible versions of a contract. */
export type ContractVersion = 1 | 2;
/** Template of a contract. */
export interface Template {
	[index: string]: {
		type: string;
		desc?: string;
		name?: string;
	};
}
//Payload for the special contracts.
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
	rows: Array<{ [key: string]: any }>;
	rowCount: number | null;
}

//#endregion

/** Basic functionality needed for the processor and node to process transactions and blocks. */
export class Basic {
	//Special contracts
	protected static readonly createContractHash: Buffer = Buffer.alloc(32, 0);
	private static readonly createContractTemplate: Template & { [P in keyof CreatePayload]: { type: string } } = {
		type: { type: "str" },
		version: { type: "str" },
		description: { type: "str" },
		template: { type: "json" },
		init: { type: "base64" },
		code: { type: "base64" },
		validanaVersion: { type: "uint?" }
	};
	protected static readonly deleteContractHash: Buffer = Buffer.alloc(32, 255);
	private static readonly deleteContractTemplate: Template & { [P in keyof DeletePayload]: { type: string } } = {
		hash: { type: "hash" }
	};

	/** Async function constructor. */
	public static readonly AsyncFunction: FunctionConstructor = Object.getPrototypeOf(async () => { }).constructor;

	/** Map with contracts, using the contractHash (as utf8 string) as identifier. */
	protected readonly contractMap = new Map<string, Contract>();

	/** The prefix to use for signing blocks and transactions in this blockchain. */
	protected signPrefix: Buffer | undefined;

	/** Hook to call when it starts and ends an init contract, which may take much longer then normal. */
	private readonly initHook: ((init: boolean) => void) | undefined;
	/** If it is currently processing a transaction or not. */
	protected isProcessing: boolean = false;

	//We have no access to 'this' during contract executions, so in case of problems use static vars instead.
	/** An error that occured during execution of smart contract, will be reported once execution finished. */
	private static txError: Error | undefined;
	private static txErrorExitCode = 0;
	/** Is the current transaction invalid for any reason. Should not be added to the blockchain in this case. */
	private static txInvalidReason: string | undefined;
	/** Did the contract reject the transaction for any reason. Add to blockchain depending on settings. */
	private static txRejectReason: string | undefined;
	/** Did the contract succeed? Add to blockchain in this case. */
	private static txAcceptReason: string | undefined;
	/** Should the transaction be retried later? (e.g. due to having no database connection.) */
	private static txShouldRetry = false;
	/** Any fast processing queries that do not need to be awaited during the contract. */
	private static processFastQueries: Array<Promise<any>> = [];
	/** Contract hash of the transaction being executed. */
	protected static txContractHash: Buffer;
	/** Is a create contract/delete being executed? */
	private static isSpecialContract = false;

	/** The database client */
	protected static client: Client | undefined;
	/** Params used to connect to the database. */
	protected readonly dbclient: DatabaseClient;
	/** Has shutdown() be called (but not yet finished)? */
	protected static isShuttingDown = false;

	/**
	 * Create the basics and make various functions available to smart contracts through global space.
	 * @param dbclient Information for the connection to the database.
	 * @param signPrefix The prefix used for signing and validating, can be set now or later.
	 * @param initHook A hook that will be called when it starts/stops creating a contract.
	 */
	constructor(dbclient: DatabaseClient, signPrefix?: Buffer, initHook?: (init: boolean) => void) {
		this.dbclient = dbclient;
		this.signPrefix = signPrefix;
		this.initHook = initHook;
	}

	/**
	 * Loads existing smart contracts from the database.
	 * Note that it will not connect to the database if it was not yet connected!
	 */
	protected async loadSmartContracts(): Promise<void> {
		const result = await this.query("SELECT contract_hash, creator, contract_type, contract_template, code, validana_version FROM basics.contracts;", []);
		this.contractMap.clear();
		for (const row of result.rows) {
			let code = Crypto.binaryToUtf8(row.code);
			if (row.validana_version !== 1) {
				code = '"use strict";' + code;
			}
			this.contractMap.set(row.contract_hash.toString(), {
				creator: row.creator,
				type: row.contract_type,
				template: row.contract_template,
				code: new Basic.AsyncFunction("payload", "from", "block", "processor", "previousBlockTimestamp",
					"previousBlockHash", "transactionId", "currentBlockTimestamp", code).bind(global) as CodeFunction,
				validanaVersion: row.validana_version
			});
		}
	}

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
	protected async processTx(unvalidatedTx: DBTransaction | Buffer | Transaction, currentBlockId: number, currentBlockTs: number,
		processorAddress: string, previousBlockTs: number, previousBlockHash: Buffer, verifySignature: boolean = true): Promise<ProcessTxResult> {

		//This is not an error with the contract or during processing, but with how this function is used.
		if (this.isProcessing) {
			throw new Error("Was still processing.");
		}
		this.isProcessing = true;

		//Prepare for executing the transaction
		Basic.txError = undefined;
		Basic.txErrorExitCode = 0;
		Basic.txShouldRetry = false;
		Basic.txInvalidReason = undefined;
		Basic.txRejectReason = undefined;
		Basic.processFastQueries.splice(0);
		Basic.isSpecialContract = false;

		//Verify The transaction is valid.
		const validatedTx = this.validateTx(unvalidatedTx, previousBlockTs, verifySignature);
		if (validatedTx === undefined) {
			return this.finishProcessingTx(validatedTx); //Version does not matter
		}

		//Verify the payload matches the template
		Basic.txContractHash = validatedTx.getContractHash();
		const contract = this.contractMap.get(Basic.txContractHash.toString());
		if (Basic.txContractHash.equals(Basic.createContractHash)) { //Verify to create template.
			Basic.txRejectReason = validatedTx.verifyTemplate(Basic.createContractTemplate, 2);
			Basic.isSpecialContract = true;
		} else if (Basic.txContractHash.equals(Basic.deleteContractHash)) { //verify to delete template
			Basic.txRejectReason = validatedTx.verifyTemplate(Basic.deleteContractTemplate, 2);
			Basic.isSpecialContract = true;
		} else { //Verify to template of contract
			if (contract === undefined) {
				Basic.txRejectReason = "Contract does not exist.";
			} else {
				Basic.txRejectReason = validatedTx.verifyTemplate(contract.template, contract.validanaVersion);
			}
		}
		if (Basic.txRejectReason !== undefined) {
			return this.finishProcessingTx(validatedTx); //Version does not matter
		}

		//Execute the smart contract
		const from = validatedTx.getAddress();
		const payload = JSON.parse(validatedTx.getPayloadBinary().toString()); //Make a deep copy for the smart contract to use
		Sandbox.sandbox();
		try {
			if (Basic.txContractHash.equals(Basic.createContractHash)) {
				Basic.txAcceptReason = await this.createContract(payload as CreatePayload, from, currentBlockId, processorAddress,
					previousBlockTs, Crypto.binaryToHex(previousBlockHash), Crypto.binaryToHex(validatedTx.getId()), currentBlockTs) as any;
			} else if (Basic.txContractHash.equals(Basic.deleteContractHash)) {
				Basic.txAcceptReason = await this.deleteContract(payload as DeletePayload, from) as any;
			} else {
				Basic.txAcceptReason = await contract!.code(payload, from, currentBlockId, processorAddress,
					previousBlockTs, Crypto.binaryToHex(previousBlockHash), Crypto.binaryToHex(validatedTx.getId()), currentBlockTs) as any;
				if (typeof Basic.txAcceptReason !== "string") {
					Basic.txAcceptReason = "Unknown result type";
				}
			}
		} catch (error) {
			try { //Escape the error
				error = new Error(error.message.slice(0, 2000));
			} catch (error2) {
				error = new Error("Unknown error message");
			}
			Basic.invalidate("Error during contract execution", false, error);
			return this.finishProcessingTx(validatedTx); //Version does not matter
		}

		//Execution was succesful
		return this.finishProcessingTx(validatedTx, contract === undefined ? 2 : contract.validanaVersion);
	}

	/**
	 * Validate if a transaction is formatted correctly, signed correctly, not expired, etc.
	 * Return undefined if the transaction is not valid.
	 * @param unvalidatedTx A transaction (that has not been validated yet, otherwise this method does nothing)
	 * @param previousBlockTs The previous block timestamp
	 * @param verifySignature Whether the signature must be validated, or if this has been done already
	 */
	private validateTx(unvalidatedTx: DBTransaction | Buffer | Transaction, previousBlockTs: number,
		verifySignature: boolean): Transaction | undefined {

		//If needed create the transaction
		if (!(unvalidatedTx instanceof Transaction)) {
			try {
				unvalidatedTx = new Transaction(unvalidatedTx);
			} catch (error) {
				Basic.invalidate(error.message, false);
				return undefined;
			}
		}

		//If needed verify the signature
		if (verifySignature) {
			//Check if we already have the prefix needed validating.
			if (this.signPrefix === undefined) {
				Basic.invalidate("Cannot validate transaction signature without sign prefix.", true, new Error("Transaction prefix not set."));
				return undefined;
			}
			//Verify the signature
			if (!unvalidatedTx.verifySignature(this.signPrefix)) {
				Basic.invalidate("Invalid signature.", false);
				return undefined;
			}
		}

		//Verify the transaction has not expired yet
		if (unvalidatedTx.validTill !== 0 && previousBlockTs >= unvalidatedTx.validTill) {
			Basic.invalidate("Transaction valid till expired.", false);
			return undefined;
		}

		return unvalidatedTx;
	}

	/**
	 * Finish processing a transaction. Will report back what should be done with the transaction.
	 * @param validatedTx The validated transaction.
	 */
	private async finishProcessingTx(validatedTx: Transaction | undefined, version: ContractVersion = 2): Promise<ProcessTxResult> {
		//Queries are always in order, so this will resolve all fast queries.
		await Promise.all(Basic.processFastQueries);

		//We can leave the sandbox now.
		Sandbox.unSandbox();

		//If it was a properly formatted transaction
		if (validatedTx !== undefined) {
			if (Basic.txError !== undefined) {
				//Report any errors that occured during smart contract execution (that a maintainer needs to do something with).
				//We report them outside the smart contract so we are not bound by the sandbox.
				if (Basic.txErrorExitCode !== 0) {
					await Basic.shutdown(Basic.txErrorExitCode, "Error during contract execution for transaction " +
						`${Crypto.binaryToHex(validatedTx.getId())} (contract: ${Crypto.binaryToHex(Basic.txContractHash)})`, Basic.txError);
				} else {
					await Log.error(`Error during contract execution for transaction ${Crypto.binaryToHex(validatedTx.getId())} ` +
						`(contract: ${Crypto.binaryToHex(Basic.txContractHash)})`, Basic.txError);
				}
			}

			if (validatedTx.getContractHash().equals(Basic.createContractHash) || validatedTx.getContractHash().equals(Basic.deleteContractHash)) {
				//All create/delete contracts must succesfully execute (to make it easier to be backwards compatible)
				if (Basic.txRejectReason !== undefined) {
					Basic.invalidate(Basic.txRejectReason, false);
				}
				//Create/delete cached version of the contract (in case commit fails it must get all contract again)!
				if (Basic.txInvalidReason === undefined) {
					if (validatedTx.getContractHash().equals(Basic.createContractHash)) {
						//Cache a new smart contract
						const payload = validatedTx.getPayloadJson() as CreatePayload;
						if (typeof payload.code === "string" && payload.code !== "") {
							const binaryPayloadCode = Crypto.base64ToBinary(payload.code);
							const validanaVersion = payload.validanaVersion ?? 1;
							let code = Crypto.binaryToUtf8(binaryPayloadCode);
							if (validanaVersion !== 1) {
								code = '"use strict";' + code;
							}
							const contractHash = Crypto.hash256(code);
							const contractFunction: CodeFunction = new Basic.AsyncFunction("payload", "from", "block", "processor",
								"previousBlockTimestamp", "previousBlockHash", "transactionId", "currentBlockTimestamp", code).bind(global) as CodeFunction;
							this.contractMap.set(contractHash.toString(), {
								creator: validatedTx.getAddress(),
								template: typeof payload.template === "string" ? JSON.parse(payload.template) : payload.template,
								validanaVersion,
								code: contractFunction,
								type: payload.type
							});
						}
					} else {
						//Remove a smart contract from cache
						const payload = validatedTx.getPayloadJson() as DeletePayload;
						this.contractMap.delete(Crypto.hexToBinary(payload.hash).toString());
					}
				}
			}
		}

		this.isProcessing = false;

		//Return with instructions on what to do/what happened.
		if (Basic.txShouldRetry) {
			return { status: "retry", message: "" };
		}
		if (Basic.txInvalidReason !== undefined) {
			return { status: TxStatus.Invalid, message: Basic.txInvalidReason };
		}
		if (Basic.txRejectReason !== undefined) {
			return { status: TxStatus.Rejected, message: Basic.txRejectReason };
		}
		if (version === 1 && Basic.txAcceptReason !== "OK") {
			return { status: "v1Rejected", message: Basic.txAcceptReason! };
		} else {
			return { status: TxStatus.Accepted, message: Basic.txAcceptReason! };
		}
	}

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
	private async createContract(payload: CreatePayload, from: string, currentBlockId: number, processor: string,
		previousBlockTs: number, previousBlockHash: string, transactionId: string, currentBlockTs: number): Promise<void | "OK"> {
		//Check if user is allowed to create a contract.
		if (from !== processor) {
			return Basic.reject("User is not allowed to create a contract.");
		}

		//Check if type, version, description and validanaVersion are valid
		if (payload.type.length > 64) {
			return Basic.reject("Trying to create an invalid contract: type too long");
		}
		if (payload.version.length > 32) {
			return Basic.reject("Trying to create an invalid contract: version too long");
		}
		if (payload.description.length > 256) {
			return Basic.reject("Trying to create an invalid contract: description too long");
		}
		const validanaVersion = payload.validanaVersion ?? 1;
		if (validanaVersion < 1 || validanaVersion > 2) {
			return Basic.reject("Unsupported contract version");
		}

		//Check if the contract template is valid (which may throw an error)
		if (typeof payload.template === "string") { //Version 1 format
			payload.template = JSON.parse(payload.template); //Will be undefined in case of failure
		}
		if (typeof payload.template !== "object" || payload.template === null || payload.template instanceof Array) {
			return Basic.reject("Trying to create an invalid contract: template is not an object.");
		}
		for (const key of Object.keys(payload.template)) {
			const value = payload.template[key];
			if (key.length > 64 ||
				typeof value !== "object" || value === null || value instanceof Array || Object.keys(value).length > 3 ||
				typeof value.type !== "string" || value.type.length > 64 ||
				typeof value.name !== "string" || value.name.length > 64 ||
				typeof value.desc !== "string" || value.desc.length > 256) {

				return Basic.reject(`Trying to create an invalid contract: template has invalid values: ${key}`);
			}
		}

		//Check if eighter the init or the code have a value:
		if (payload.init === "" && payload.code === "") {
			return Basic.reject("Trying to create an invalid contract: init and/or code has to be defined");
		}

		//Check if the init code can be turned into a function (which may throw an error) and contains no non-determinism issues.
		let initCode = Crypto.binaryToUtf8(Crypto.base64ToBinary(payload.init));
		if (validanaVersion !== 1) {
			initCode = '"use strict";' + initCode;
		}
		const initCheck = this.checkCode(initCode, payload.type);
		if (initCheck !== undefined) {
			return Basic.reject(initCheck);
		}
		const initFunction = new Basic.AsyncFunction("from", "block", "processor", "previousBlockTimestamp",
			"previousBlockHash", "transactionId", "currentBlockTimestamp", initCode).bind(global) as InitFunction;
		//Check if the code can be turned into a function (which may throw an error) and contains no non-determisism issues.
		const contractBuffer = Crypto.base64ToBinary(payload.code);
		let contractCode = Crypto.binaryToUtf8(contractBuffer);
		if (validanaVersion !== 1) {
			contractCode = '"use strict";' + contractCode;
		}
		const codeCheck = this.checkCode(contractCode, payload.type);
		if (codeCheck !== undefined) {
			return Basic.reject(codeCheck);
		}
		//eslint-disable-next-line @typescript-eslint/no-unused-expressions
		new Basic.AsyncFunction("payload", "from", "block", "processor", "previousBlockTimestamp",
			"previousBlockHash", "transactionId", "currentBlockTimestamp", contractCode).bind(global);

		//Check if this contract already exists
		Basic.querySCFast("SET LOCAL ROLE smartcontractmanager;", []);
		const contractHash = Crypto.hash256(contractCode);
		if (contractHash.equals(Basic.createContractHash) || contractHash.equals(Basic.deleteContractHash)) {
			//Either sha256 is no longer secure or one of the crypto functions was incorrectly implemented.
			return Basic.reject("Trying to create contract: created contract hash has an impossible value");
		} else {
			if ((await Basic.querySC("SELECT FROM basics.contracts WHERE contract_hash = $1;", [contractHash])).rows.length > 0) {
				//Check if contract already exists
				return Basic.reject("Trying to create an invalid contract: contract already exists");
			}
		}

		//Everything is correct execute the init (which may throw an error)
		if (payload.init !== "") {
			const statementTimeout = (await Basic.querySC("SHOW statement_timeout;", [])).rows[0].statement_timeout;
			Basic.querySCFast("SET LOCAL statement_timeout = 0;", []);
			Basic.querySCFast("SET LOCAL ROLE smartcontract;", []);
			this.initHook?.(true);
			Basic.isSpecialContract = false;
			Basic.txContractHash = contractHash;
			//Finally is not supported till node v10, so we have to duplicate some code here.
			await initFunction(from, currentBlockId, processor, previousBlockTs, previousBlockHash, transactionId, currentBlockTs).catch((e) => {
				Basic.txContractHash = Basic.createContractHash;
				this.initHook?.(false);
				throw e;
			});
			Basic.isSpecialContract = true;
			Basic.txContractHash = Basic.createContractHash;
			this.initHook?.(false);
			await Basic.querySC(`SET LOCAL statement_timeout = '${statementTimeout}';`, []);
		}

		//Create the contract
		if (payload.code !== "") {
			const params = [contractHash, payload.type, payload.version, payload.description, from,
				payload.template, Crypto.base64ToBinary(payload.code), validanaVersion];
			Basic.querySCFast("SET LOCAL ROLE smartcontractmanager;", []);
			Basic.querySCFast("INSERT INTO basics.contracts (contract_hash, contract_type, contract_version, description, "
				+ "creator, contract_template, code, validana_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);", params);
		}

		//Indication that everything succeeded
		Basic.querySCFast("SET LOCAL ROLE smartcontract;", []);
		return "OK";
	}

	/**
	 * Checks if a code contains invalid code.
	 * @param code The code to check
	 * @param contractName The name of the contract for which the code is being checked.
	 * @returns An error string if something is wrong with the code or undefined if there were no errors
	 */
	private checkCode(code: string, contractName: string): string | undefined {
		//Contract is not allowed to use try/catch to prevent catching non-deterministic errors.
		if (code.search(/try[^]+?catch/) !== -1) {
			return `Trying to create an invalid contract (${contractName}): contract may not use 'try catch', instead use 'await query().catch()'.`;
		}
		//Contract is not allowed to query without awaiting.
		if (code.search(/(?<!await\s)query\s*\(/) !== -1) {
			return `Trying to create an invalid contract (${contractName}): contract must use 'await query()' instead of 'query()'`;
		}

		return undefined;
	}

	/**
	 * Delete an existing contract.
	 * @param payload The payload of the transaction
	 * @param from Who created this transaction
	 */
	private async deleteContract(payload: DeletePayload, from: string): Promise<void | "OK"> {
		//Delete the contract if we are allowed to.
		Basic.querySCFast("SET LOCAL ROLE smartcontractmanager;", []);
		const result = await Basic.querySC("DELETE FROM basics.contracts WHERE contract_hash = $1 AND creator = $2;",
			[Crypto.hexToBinary(payload.hash), from]);
		if (result.rowCount === 0) {
			return Basic.reject(`Not creator of contract or contract: ${payload.hash} does not exist.`);
		}

		//Indication that everything succeeded
		Basic.querySCFast("SET LOCAL ROLE smartcontract;", []);
		return "OK";
	}

	/**
	 * Connects to the database.
	 * Make sure to only connect at the start of mining a block, to prevent errors and ensure rollbacks occur when needed.
	 * @returns true if it did connect, false if it was already connected
	 */
	protected async connect(): Promise<boolean> {
		if (Basic.client === undefined) {
			try {
				//DB connection for the processor
				Basic.client = new Client(this.dbclient).on("error", (error) => {
					Basic.client = undefined;
					//Do not accidentally capture password
					if (this.dbclient.password !== undefined) {
						error.message = error.message.replace(new RegExp(this.dbclient.password, "g"), "");
					}
					Log.warn("Problem with database connection.", error);
				}).on("end", () => Basic.client = undefined);
				await Basic.client.connect();
			} catch (error) {
				//Do not accidentally capture password
				if (this.dbclient.password !== undefined) {
					error.message = error.message.replace(new RegExp(this.dbclient.password, "g"), "");
				}
				if (error.code === "53300") {
					//Another instance is already running.
					await Basic.shutdown(50, "Another instance is already running, shutting down to prevent errors.", error);
				} else {
					Log.warn("Failed to connect with the database.", error);
					Basic.client = undefined;
				}
			}
			return true;
		} else {
			return false;
		}
	}

	/**
	 * Query the database.
	 * To prevent accidental sql injections params is a required parameter and should just be an empty array if there are none.
	 * @param query The query to execute
	 * @param params The params of the query (to prevent sql-injections)
	 * @param name The name of the transaction (used for prepared statements to speed up the process)
	 */
	protected async query(query: string, params: any[], name?: string): Promise<QueryResult> {
		//The request
		const request: QueryConfig = { text: query, values: params };
		if (name !== undefined) {
			request.name = name;
		}

		if (Basic.client === undefined) {
			throw new Error("No connection");
		}

		try {
			return await Basic.client.query(request);
		} catch (error) {
			if (error.code === "XX001" || error.code === "XX002") {
				Log.info(`Database or index corrupted for query ${query} and params ${JSON.stringify(params)}.`);
				await Basic.shutdown(51, "Database or index corrupted. Shutting down.", error);
			}

			//Failed to retrieve data
			throw error;
		}
	}

	/**
	 * Send a query to the database from inside a smart contract.
	 * To prevent accidental sql injections params is a required parameter and should just be an empty array if there are none.
	 * @param query The query to execute
	 * @param params The params of the query (to prevent sql-injections)
	 * @throws if not called correctly or there are problems with the database connection.
	 */
	public static async querySC(query: string, params: unknown[]): Promise<QuerySCResult> {
		//Convert from the old version (which will throw an error if it is not (valid) old version).
		if (typeof query !== "string" || !(params instanceof Array)) {
			//eslint-disable-next-line prefer-rest-params
			[query, params] = (Basic.convertV1 as any)(...arguments);
		}

		//Fix common mistake, which will also allow us to determine if there are multiple actions or not.
		query = query.trim();
		if (!query.endsWith(";")) {
			query += ";";
		}

		//Action must be a single action (ends with ;), may not contain comments to avoid potential sql injections.
		//Action must not contain requests to current time/date (which is the most likely mistake to make).
		if (query.search(/;|--|localtime|current_(?:date|time)/i) !== query.length - 1) {
			const error = new Error("Invalid query: multiple queries, comments or time request.");
			Basic.invalidate("Invalid query: multiple queries, comments or time request.", false, error);
			throw error;
		}

		//Allowed: alter table/type/index, create unique_index/index/table/type, delete from, drop table/index/type, insert into, select and update
		if (query.search(/^(?:alter\s+(?:index|table|type)|create\s+(?:(?:unique\s+)?index|table|type)|delete|drop\s+(?:index|table|type)|insert|select|update|with)/i) !== 0) {
			//The create/delete contracts are allowed to change role/timeout as well
			if (!Basic.isSpecialContract && query.search(/^SET LOCAL (?:ROLE smartcontract(?:manager)?;|statement_timeout = .*)|SHOW statement_timeout;$/) !== 0) {
				const error = new Error(`Invalid query: invalid action for query ${query}.`);
				Basic.invalidate("Invalid query: action not allowed.", false, error);
				throw error;
			}
		}

		//Check if we have a connection
		if (Basic.client === undefined) {
			const error = new Error("No database connection");
			Basic.invalidate("No database connection.", true, error);
			throw error;
		}

		try {
			//Execute the query
			const result = await Basic.client.query(query, params);
			return { rows: result.rows, rowCount: result.rowCount };
		} catch (error) {
			//See https://www.postgresql.org/docs/current/errcodes-appendix.html
			if (typeof error.code !== "string") { //Non-postgres error
				Basic.invalidate("Unknown error during execution", false, error, 2);
			} else if (error.code === "XX001" || error.code === "XX002") { //Admin needs to resolve this
				Basic.invalidate("Database corrupted", true, new Error(`Database or index corrupted for query ${query} and params ${JSON.stringify(params)}.`), 51);
			} else if ((error.code as string).startsWith("08") && error.code !== "08P01") { //Connection issue, should resolve when tried again
				Basic.invalidate("Database connection problem.", true, error);
			} else if ((error.code as string).startsWith("23")) {
				//User defined contrain violated, user is allowed to .catch() this error. (But not with try-catch.)
				//Rethrow a deterministic error.
				const error2 = new Error(`${error.message}, when executing query: ${query}, and params: ${JSON.stringify(params)}`);
				error2.stack = error2.message;
				(error2 as any).code = error.code;
				throw error2;
			} else { //Other database error. Do not retry and reject the transaction.
				error.message = `${error.message}, while executing contract ${Crypto.binaryToHex(Basic.txContractHash)} for query: ${query}`;
				Basic.invalidate("Error during contract execution", false, error);
			}
			throw error;
		}
	}

	/**
	 * The same as querySC, except this method never returns anything and never throws.
	 * Can be used without awaiting, for example with insert queries, though transactions will be invalidated if it throws.
	 * @param query The query to execute
	 * @param params The params of the query (to prevent sql-injections)
	 */
	public static querySCFast(query: string, params: unknown[]): void {
		Basic.processFastQueries.push(Basic.querySC(query, params).catch((error) =>
			Basic.invalidate("Error during contract execution", false, error)));
	}

	/** Convert the old querySC format to a new one. */
	private static convertV1(action: string, table: string, info: string, params: unknown[], usePrivate: boolean = false): [string, unknown[]] {
		if (typeof action !== "string" || typeof table !== "string" || typeof info !== "string"
			|| typeof usePrivate !== "boolean" || !(params instanceof Array)) {
			const error = new Error(`Invalid query: Smart contract ${Crypto.binaryToHex(Basic.txContractHash)} tried to execute an invalid query (wrong type)`);
			Basic.invalidate("Invalid query: invalid parameters.", false, error);
			throw error;
		}

		//Construct the query
		let query = "";
		switch (action) {
			case "INSERT":
				query += "INSERT INTO ";
				break;
			case "SELECT":
				query += "SELECT * FROM ";
				break;
			case "UPDATE":
				query += "UPDATE ";
				break;
			case "DELETE":
				query += "DELETE FROM ";
				break;
			case "CREATE":
				query += "CREATE TABLE IF NOT EXISTS ";
				break;
			case "DROP":
				query += "DROP TABLE IF EXISTS ";
				break;
			case "ALTER":
				query += "ALTER TABLE ";
				break;
			case "INDEX": //Always provided by the contract, so should be safe.
				query += `CREATE INDEX IF NOT EXISTS ${params[0]} ON `;
				params = [];
				break;
			case "UNIQUE INDEX": //Always provided by the contract, so should be safe.
				query += `CREATE UNIQUE INDEX IF NOT EXISTS ${params[0]} ON `;
				params = [];
				break;
			case "DROP INDEX":
				query += "DROP INDEX IF EXISTS ";
				break;
			default:
				const error = new Error(`Invalid query: Invalid action ${action}`);
				Basic.invalidate("Invalid query: Invalid action", false, error);
				throw error;
		}
		if (action !== "DROP INDEX") {
			query += `${table}${usePrivate ? `_${Crypto.binaryToHex(Basic.txContractHash).slice(0, 32)}` : ""} `;
		}
		query += info;

		return [query, params];
	}

	/**
	 * Allows a smart contract to reject the transaction it is currently executing.
	 * @param reason The reason why the transaction is rejected
	 */
	public static reject(reason: string): void {
		if (Basic.txRejectReason === undefined) {
			Basic.txRejectReason = typeof reason === "string" ? reason : "Unknown reject reason";
		}
	}

	/**
	 * Mark a transaction as invalid.
	 * @param reason The reason this transaction is not valid.
	 * @param retry Should we retry this transaction later or not.
	 * @param error An error that may have occured that is the reason this transaction is invalid.
	 * @param exitCode Should the program exit due to an error it cannot recover from.
	 */
	private static invalidate(reason: string, retry: boolean, error?: Error, exitCode: number = 0): void {
		//Only the first error counts, other errors may result from earlier errors.
		if (Basic.txInvalidReason === undefined) {
			Basic.txInvalidReason = reason;
			Basic.txShouldRetry = retry;
			Basic.txError = error;
			Basic.txErrorExitCode = exitCode;
		}
	}

	/**
	 * Shutdown the process (after closing the database connection). Current block will not be finished anymore.
	 * @param exitCode The exit code. An error code between 50 and 59 means it should stay down due to an error it cannot recover from.
	 * @param message If given this message will be reported as a fatal error before shutdown.
	 * @param error If given this will be reported as a fatal error before shutdown.
	 */
	public static async shutdown(exitCode = 0, message?: string, error?: Error): Promise<never> {
		//Leave the sandbox so we can report errors.
		Sandbox.unSandbox();

		if (Basic.client !== undefined) {
			Basic.isShuttingDown = true;
			try {
				await Basic.client.end();
			} catch (error2) {
				Log.warn("Failed to properly shutdown database client.", error2);
				if (exitCode === 0) {
					exitCode = 1;
				}
			}
		}

		if (message !== undefined) {
			await Log.fatal(message, error);
		}

		return process.exit(exitCode);
	}
}