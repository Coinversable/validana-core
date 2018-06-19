/**
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
import { PublicKey } from "./key";

/** Make sure if we query the database any BIGINTs are returned as a number, instead of a string. */
types.setTypeParser(20, (val: string) => {
	return Number.parseInt(val, 10);
});

//Make sure code and init funcion are called correctly by giving them a type.
export type InitFunction = (from: string, block: number, processor: string, // tslint:disable-next-line:ban-types
	previousBlockTimestamp: number, previousBlockHash: string, query: Function) => {} | undefined;
export type CodeFunction = (payload: object, from: string, block: number, processor: string, // tslint:disable-next-line:ban-types
	previousBlockTimestamp: number, previousBlockHash: string, query: Function) => {} | undefined;

/** Template of a contract */
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
	ProcessingAccepted = "processing_accepted", //Has been processed in the state, but not yet in a block.
	ProcessingRejected = "processing_rejected",
	Invalid = "invalid", //Considered invalid by the processor (e.g. wrong signature, syntax errors in contract execution)
	Accepted = "accepted", //Processed by processor, contract executed without errors
	Rejected = "rejected" //Processed by processor, contract returned that it rejected the result
}

/** Part of a contract that is needed for the processor/node. */
export interface Contract {
	creator: string;
	type: string;
	template: Template;
	code: CodeFunction;
}

/** Extension to the standard QueryResult that puts any errors into the result rather then throwing a seperate error. */
export interface QueryStatus extends QueryResult {
	error?: Error;
}

/** Basic functionality needed for the processor and node to process transactions and blocks. */
export class Basic {
	//Special contracts
	protected static readonly createContractHash: Buffer = Buffer.alloc(32, 0);
	private static readonly createContractTemplate: Template & { [P in keyof CreatePayload]: { type: string } } = {
		type: { type: "string" },
		version: { type: "string" },
		description: { type: "string" },
		template: { type: "json" },
		init: { type: "base64" },
		code: { type: "base64" }
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

	//We have no access to 'this' during contract executions, so in case of problems use global vars instead.
	/** Is the current contract invalid for any reason. Should not be added to the blockchain in this case. */
	protected static txInvalidReason: string | undefined;
	/** Did the contract reject the transaction for any reason. */
	protected static txRejectReason: string | undefined;
	/** Should the transaction be retried later? (e.g. due to having no database connection.) */
	protected static txShouldRetry = false;
	/** Contract hash of the transaction being executed. */
	protected static txContractHash: Buffer;
	private static isCreatingContract = false;
	private static isSpecialContract = false;

	//The database client
	protected static client: Client | undefined;
	protected readonly dbclient: DatabaseClient;

	/**
	 * Create the basics and make various functions available to smart contracts through global space.
	 * @param dbclient Information for the connection to the database.
	 * @param signPrefix The prefix used for signing and validating, can be set now or later.
	 */
	constructor(dbclient: DatabaseClient, signPrefix?: Buffer) {
		this.dbclient = dbclient;
		this.signPrefix = signPrefix;

		//Make methods globally available for smart contracts.
		(global as any).sha1 = Crypto.sha1;
		(global as any).sha256 = Crypto.sha256;
		(global as any).sha512 = Crypto.sha512;
		(global as any).md5 = Crypto.md5;
		(global as any).ripemd160 = Crypto.ripemd160;
		(global as any).isValidAddress = PublicKey.isValidAddress;
	}

	/**
	 * Loads existing smart contracts from the database. Will return an error as result if it failed. (But it will never throw!)
	 * Note that it will not connect to the database if it was not yet connected!
	 */
	protected async loadSmartContracts(): Promise<Error | undefined> {
		const result = await this.query("SELECT contract_hash, creator, contract_type, contract_template, code FROM basics.contracts;", []);
		if (result.error === undefined) {
			this.contractMap.clear();
			for (const row of result.rows) {
				this.contractMap.set(row.contract_hash.toString(), {
					creator: row.creator,
					type: row.contract_type,
					template: row.contract_template,
					code: new Basic.AsyncFunction("payload", "from", "block", "processor", "previousBlockTimestamp", "previousBlockHash", "query",
						Crypto.binaryToUtf8(row.code)) as CodeFunction
				});
			}
		}
		return result.error;
	}

	/**
	 * Executes the smart contract of a transaction.
	 * Returns if the execution was succesful or there were errors, such as no database connection.
	 * In case of create/delete contracts and everything was succesful it is created/deleted internally as well,
	 * 	for futher transactions that are processed and make use of them.
	 * Note that it will not connect to the database if it was not yet connected!
	 * @param tx The transaction to process
	 * @param currentBlockId The id of the current block
	 * @param processorAddress The address of the processor
	 * @param previousBlockTs The time at which the previous block was processed
	 * @param previousBlockHash The hash of the previous block
	 * @param verifySignature Whether or not the signature of the transaction should be verified
	 */
	protected async processTx(tx: DBTransaction | Buffer | Transaction, currentBlockId: number, processorAddress: string,
		previousBlockTs: number, previousBlockHash: Buffer, verifySignature: boolean = true): Promise<void> {

		//Prepare for executing the transaction
		Basic.txShouldRetry = false;
		Basic.txInvalidReason = undefined;
		Basic.txRejectReason = undefined;
		Basic.isCreatingContract = false;
		Basic.isSpecialContract = false;

		//If needed create the transaction
		if (!(tx instanceof Transaction)) {
			try {
				tx = new Transaction(tx);
			} catch (error) {
				Basic.txInvalidReason = (error as Error).message;
				return;
			}
		}

		//Verify the transaction is valid and should be added to the blockchain.
		if (verifySignature) {
			//Check if we already have the prefix needed validating.
			if (this.signPrefix === undefined) {
				Basic.txShouldRetry = true;
				Basic.txInvalidReason = "Cannot validate transaction signature without sign prefix.";
				Log.error("Transaction prefix not set.");
				return;
			}
			//Verify the signature
			if (!tx.verifySignature(this.signPrefix)) {
				Basic.txInvalidReason = "Invalid signature.";
				return;
			}
		}

		//Verify it has not yet expired
		if (tx.validTill !== 0 && previousBlockTs >= tx.validTill) {
			Basic.txInvalidReason = "Transaction valid till expired.";
			return;
		}

		//Verify that the payload is valid json
		const payload = tx.getPayloadJson();
		if (payload === undefined) {
			Basic.txInvalidReason = "Transaction payload is not a valid json object.";
			return;
		}

		//Verify the payload to the template.
		//Note that create/delete contract transactions must follow a valid template to be considered a valid transaction.
		Basic.txContractHash = tx.getContractHash();
		const contract = this.contractMap.get(Basic.txContractHash.toString());
		if (Basic.txContractHash.equals(Basic.createContractHash)) {
			//Verify to create template.
			Basic.txInvalidReason = tx.verifyTemplate(Basic.createContractTemplate);
		} else if (Basic.txContractHash.equals(Basic.deleteContractHash)) {
			//verify to delete template
			Basic.txInvalidReason = tx.verifyTemplate(Basic.deleteContractTemplate);
		} else {
			//Verify to template of contract
			Basic.txRejectReason = tx.verifyTemplate(contract !== undefined ? contract.template : undefined);
		}
		if (Basic.txRejectReason !== undefined || Basic.txInvalidReason !== undefined) {
			return;
		}

		//Execute the contract
		const from = tx.getAddress();
		Sandbox.sandbox();
		let result;
		try {
			if (Basic.txContractHash.equals(Basic.createContractHash)) {
				Basic.isSpecialContract = true;
				result = await this.createContract(
					payload as CreatePayload,
					from,
					currentBlockId,
					processorAddress,
					previousBlockTs,
					Crypto.binaryToHex(previousBlockHash)
				);
			} else if (Basic.txContractHash.equals(Basic.deleteContractHash)) {
				Basic.isSpecialContract = true;
				result = await this.deleteContract(payload as DeletePayload, from);
			} else {
				result = await contract!.code(
					payload, //payload
					from, //from
					currentBlockId, //current block id
					processorAddress, //processor address
					previousBlockTs, //previous block timestamp
					Crypto.binaryToHex(previousBlockHash), //previous block hash
					this.querySC //query method
				);
			}
		} catch (error) {
			//This may have temporarily been changed by the create contract, so reset it.
			Basic.txContractHash = tx.getContractHash();

			//We cannot know what kind of errors are thrown during contract execution
			//(such as out of memory, which is non-deterministic), so do not validate transaction.
			if (!Basic.txShouldRetry) {
				if (typeof error === "string" || typeof error === "number") {
					//If it is an error message or code
					Sandbox.unSandbox(); //We are safe, it is a primitive type
					Basic.txInvalidReason = error.toString();
					Log.error(`Error during contract execution for transaction ${Crypto.binaryToHex(tx.getId())} ` +
						`(contract: ${Crypto.binaryToHex(Basic.txContractHash)})`, new Error(error.toString()));
				} else if (error instanceof Error) {
					//If it is an error object
					try {
						//Create a new error object, as the old object may be unsafe
						error = new Error(error.message);
					} catch {
						error = new Error("Unknown error message");
					}
					Sandbox.unSandbox(); //Now that we are safe leave the sandbox
					Basic.txInvalidReason = error.message;
					Log.error(`Error during contract execution for transaction ${Crypto.binaryToHex(tx.getId())} ` +
						`(contract: ${Crypto.binaryToHex(Basic.txContractHash)})`, error);
				} else {
					//If it is an other type of error
					Sandbox.unSandbox(); //We are safe, because we will ignore the error
					Basic.txInvalidReason = "Unknown error type";
					Log.error(`Error during contract execution for transaction ${Crypto.binaryToHex(tx.getId())} ` +
						`(contract: ${Crypto.binaryToHex(Basic.txContractHash)})`, new Error("Unknown contract return type"));
				}
				return;
			}
		}
		//Unsandbox after we are done
		Sandbox.unSandbox();

		//Set the reject reason if any. Note that this has no influcence on what the contract did or did not do and is used solely for user feedback.
		if (typeof result !== "string") {
			Basic.txRejectReason = "Unknown result type";
		} else if (result !== "OK") {
			//The return string "OK" is an indication from the smart contract that is accepted it.
			Basic.txRejectReason = result;
		}

		//In case the contract is rejected for any reason and it is a create or delete contract mark it as invalid instead.
		if ((tx.getContractHash().equals(Basic.createContractHash) || tx.getContractHash().equals(Basic.deleteContractHash)) && Basic.txRejectReason !== undefined) {
			Basic.txInvalidReason = Basic.txRejectReason;
		}

		//If it was a create/delete contract: save/delete it locally as well.
		if (Basic.txInvalidReason === undefined && !Basic.txShouldRetry) {
			if (Basic.txContractHash.equals(Basic.createContractHash)) {
				if ((payload as CreatePayload).code !== "") {
					const binaryPayloadCode = Crypto.base64ToBinary((payload as CreatePayload).code);
					const contractHash = Crypto.hash256(binaryPayloadCode);
					const contractFunction: CodeFunction = new Basic.AsyncFunction("payload", "from", "block", "processor", "previousBlockTimestamp", "previousBlockHash", "query",
						Crypto.binaryToUtf8(binaryPayloadCode)) as CodeFunction;
					this.contractMap.set(contractHash.toString(), {
						creator: from,
						template: JSON.parse((payload as CreatePayload).template),
						code: contractFunction,
						type: (payload as CreatePayload).type
					});
				}
			} else if (Basic.txContractHash.equals(Basic.deleteContractHash)) {
				this.contractMap.delete(Crypto.hexToBinary((payload as DeletePayload).hash).toString());
			}
		}
	}

	/**
	 * Create a new contract. May throw an error if there are problems.
	 * @param payload The payload of the transaction
	 * @param from Who created this transaction
	 * @param currentBlockId The id of the current block
	 * @param processorAddress The address of the processor
	 * @param previousBlockTs The time at which the previous block was processed
	 * @param previousBlockHash The hash of the previous block
	 * @returns An error string if there are problems.
	 */
	private async createContract(payload: CreatePayload, from: string, currentBlockId: number,
		processor: string, previousBlockTs: number, previousBlockHash: string): Promise<string> {
		//Check if user is allowed to create a contract.
		if (from !== processor) {
			return "User is not allowed to create a contract.";
		}

		//Check if type, version and description are valid
		if (payload.type.length > 64) {
			return "Trying to create an invalid contract: type too long";
		}
		if (payload.version.length > 32) {
			return "Trying to create an invalid contract: version too long";
		}
		if (payload.description.length > 256) {
			return "Trying to create an invalid contract: description too long";
		}

		//Check if the contract template is valid (which may throw an error)
		const contractTemplate: Template = JSON.parse(payload.template);
		if (typeof contractTemplate !== "object") {
			return "Trying to create an invalid contract: template is not an object.";
		}
		for (const value of Object.keys(contractTemplate)) {
			if (typeof contractTemplate[value] !== "object" || Object.keys(contractTemplate[value]).length > 3 ||
				typeof contractTemplate[value].type !== "string" || typeof contractTemplate[value].desc !== "string" ||
				typeof contractTemplate[value].name !== "string") {

				return `Trying to create an invalid contract: template has invalid values: ${value}`;
			}
		}

		//Check if eighter the init or the code have a value:
		if (payload.init === "" && payload.code === "") {
			return "Trying to create an invalid contract: init and/or code has to be defined";
		}

		//Check if the init code can be turned into a function (which may throw an error) and contains no non-determinism issues.
		const initCode = Crypto.binaryToUtf8(Crypto.base64ToBinary(payload.init));
		const initCheck = this.checkCode(initCode, payload.type);
		if (initCheck !== undefined) {
			return initCheck;
		}
		const initFunction = new Basic.AsyncFunction("from", "block", "processor", "previousBlockTimestamp", "previousBlockHash", "query", initCode) as InitFunction;
		//Check if the code can be turned into a function (which may throw an error) and contains no non-determisism issues.
		const contractBuffer = Crypto.base64ToBinary(payload.code);
		const contractCode = Crypto.binaryToUtf8(contractBuffer);
		const codeCheck = this.checkCode(contractCode, payload.type);
		if (codeCheck !== undefined) {
			return codeCheck;
		}
		// tslint:disable-next-line:no-unused-expression
		new Basic.AsyncFunction("payload", "from", "block", "processor", "previousBlockTimestamp", "previousBlockHash", "query", contractCode);

		//Check if this contract already exists
		const contractHash = Crypto.hash256(contractBuffer);
		if (contractHash.equals(Basic.createContractHash) || contractHash.equals(Basic.deleteContractHash)) {
			//Either sha256 is no longer secure or one of the crypto functions was incorrectly implemented.
			return "Trying to create contract: created contract hash has an impossible value";
		} else if ((await this.querySC("SELECT", "basics.contracts", "WHERE contract_hash = $1;", [contractHash])).rows.length > 0) {
			//Check if contract already exists
			return `Trying to create an invalid contract: contract already exists`;
		}

		//Everything is correct execute the init (which may throw an error)
		if (payload.init !== "") {
			Basic.isCreatingContract = true;
			Basic.isSpecialContract = false;
			Basic.txContractHash = contractHash;
			await Promise.resolve(initFunction(
				from, //from
				currentBlockId, //current block id
				processor, //processor address
				previousBlockTs, //previous block timestamp
				previousBlockHash, //previous block hash
				this.querySC //query method
			));
			Basic.isCreatingContract = false;
			Basic.isSpecialContract = true;
			Basic.txContractHash = Basic.createContractHash;
		}

		//Create the contract
		if (payload.code !== "") {
			const params = [contractHash, payload.type, payload.version, payload.description, from, payload.template, Crypto.base64ToBinary(payload.code)];
			await this.querySC("INSERT", "basics.contracts",
				"(contract_hash, contract_type, contract_version, description, creator, contract_template, code) " +
				"VALUES ($1, $2, $3, $4, $5, $6, $7);", params);
		}

		//Indication that everything succeeded
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
		if (code.search(/try.*catch/s) !== -1) {
			return `Trying to create an invalid contract (${contractName}): contract may not use 'try catch'`;
		}
		//Contract is not allowed to throw objects.
		if (code.indexOf("throw") !== -1) {
			return `Trying to create an invalid contract (${contractName}): contract may not use 'throw'`;
		}
		//Contract is not allowed to query without awaiting.
		if (code.search(/(?<!await\s)query\s*\(/) !== -1) {
			return `Trying to create an invalid contract (${contractName}): contract must use 'await query()' instead of 'query()'`;
		}

		return undefined;
	}

	/**
	 * Delete an existing contract. Will return an error string if there are problems.
	 * @param payload The payload of the transaction
	 * @param from Who created this transaction
	 */
	private async deleteContract(payload: DeletePayload, from: string): Promise<string> {
		const binaryHash = Crypto.hexToBinary(payload.hash);

		//Check if this contract exists
		const result = await this.querySC("SELECT", "basics.contracts", "WHERE contract_hash = $1", [binaryHash]);
		if (result.rows.length === 0) {
			return `Trying to delete an unexisting contract: ${payload.hash}`;
		}

		//Check if user is allowed to delete the contract.
		if (from !== result.rows[0].creator) {
			return "Only the creator is allowed to delete a contract.";
		}

		//Delete the contract
		await this.querySC("DELETE", "basics.contracts", "WHERE contract_hash = $1;", [binaryHash]);

		//Indication that everything succeeded
		return "OK";
	}

	/**
	 * Connects to the database.
	 * Make sure to only connect at the start of mining a block, to prevent errors and ensure rollbacks occur when needed.
	 */
	protected async connect(): Promise<void> {
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
				Log.warn("Failed to connect with the database.", error);
				Basic.client = undefined;
			}
		}
	}

	/**
	 * Query the database.
	 * To prevent accidental sql injections values is a required parameter and should just be an empty array if there are none.
	 * @param query The query to execute
	 * @param values The values of the query (to prevent sql-injections)
	 * @param name The name of the transaction (used for prepared statements to speed up the process)
	 */
	protected async query(query: string, values: Array<string | number | boolean | Buffer>, name?: string): Promise<QueryStatus> {
		//The request
		const request: QueryConfig = { text: query, values };
		if (name !== undefined) {
			request.name = name;
		}

		if (Basic.client === undefined) {
			return { command: query, rowCount: 0, rows: [], oid: 0, error: new Error("No connection"), fields: [] };
		}

		try {
			return await Basic.client.query(request);
		} catch (error) {
			if (error.code === "53300") {
				//Another instance is already running.
				await Log.fatal("Another instance is already running, shutting down to prevent errors.", error);
				await Basic.shutdown(50);
			} else if (error.code === "XX001" || error.code === "XX002") {
				Log.info(`Database or index corrupted for query ${query} and params ${values}.`);
				await Log.fatal("Database or index corrupted. Shutting down.", error);
				await Basic.shutdown(51);
			}

			//Failed to retrieve data
			return { command: query, rowCount: 0, rows: [], oid: 0, error, fields: [] };
		}
	}

	/**
	 * Query for smart contracts to use to store and retrieve data.
	 * Similar to query(), except that some operations are not allowed and problems will mark the transaction for rollback.
	 * Note that this is not meant to provide security, but to prevent accidental mistakes!
	 * @param action The action to use
	 * @param table The table to perform the action on
	 * @param info A where clause or other info for the action
	 * @param params The params for the query
	 * @param usePrivate Use the private (this contract specific) table or the public one with that name?
	 */
	private async querySC(action: string, table: string, info: string, params: any[], usePrivate: boolean = false): Promise<QueryResult> {
		//Check if the contract is using the correct values.
		if (typeof action !== "string" || typeof table !== "string" || typeof info !== "string"
			|| typeof usePrivate !== "boolean" || !(params instanceof Array)) {
			Sandbox.unSandbox();
			Log.error(`Smart contract ${Crypto.binaryToHex(Basic.txContractHash)} tried to execute an invalid query (wrong type)`);
			Sandbox.sandbox();
			throw new Error("Invalid query request: missing or wrong type of parameters.");
		}
		//Make new objects, as old objects are unsafe
		params = new Array(...params);
		for (let i = 0; i < params.length; i++) {
			if (typeof params[i] === "object") {
				if (params[i] instanceof Buffer) {
					params[i] = Buffer.from(params[i]);
				} else {
					throw new Error("Invalid query request: params may not contain non-Buffer objects.");
				}
			}
		}
		//Now that we are safe leave the sandbox.
		Sandbox.unSandbox();

		if ((action === "CREATE" || action === "DROP" || action === "ALTER" || action === "INDEX" || action === "UNIQUE INDEX" || action === "DROP INDEX")) {
			if (!Basic.isCreatingContract) {
				Log.error(`Smart contract ${Crypto.binaryToHex(Basic.txContractHash)} tried to execute an invalid query during create (action ${action})`);
				Sandbox.sandbox();
				throw new Error("Action not allowed for smart contracts");
			}
		} else if (action !== "SELECT" && action !== "INSERT" && action !== "UPDATE" && action !== "DELETE") {
			Log.error(`Smart contract ${Crypto.binaryToHex(Basic.txContractHash)} tried to execute an invalid query (action: ${action})`);
			Sandbox.sandbox();
			throw new Error("Action not allowed for smart contracts");
		}
		if (table === "basics.contracts") {
			if (!Basic.isSpecialContract) {
				Log.error(`Smart contract ${Crypto.binaryToHex(Basic.txContractHash)} tried to execute an invalid query as non-special contract (table: ${table})`);
				Sandbox.sandbox();
				throw new Error("Table not allowed for smart contracts");
			}
		} else if ((table === "" && action !== "DROP INDEX") || table.length >= 30 || table.indexOf(".") !== -1) {
			Log.error(`Smart contract ${Crypto.binaryToHex(Basic.txContractHash)} tried to execute an invalid query (table: ${table})`);
			Sandbox.sandbox();
			throw new Error("Table not allowed for smart contracts");
		}

		//Fix common mistake with info queries.
		if (!info.endsWith(";")) {
			info += ";";
		}

		//Check if there is nothing weird in table and info.
		if (table.match(/;|--/) !== null || info.match(/;|--/g)!.length > 1) {
			Log.error(`Smart contract ${Crypto.binaryToHex(Basic.txContractHash)} tried to execute an invalid query (multiple or comments: ${table} ${info})`);
			Sandbox.sandbox();
			throw new Error("Smart contracts are not allowed to execute multiple queries or use comments.");
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
				Log.error(`Invalid query ${action} action after checking the query actions.`);
				Sandbox.sandbox();
				throw new Error("Action not allowed for smart contracts");
		}
		if (action !== "DROP INDEX") {
			query += `${table}${usePrivate ? `_${Crypto.binaryToHex(Basic.txContractHash).slice(0, 32)}` : ""} `;
		}
		query += info;

		const request: QueryConfig = { text: query, values: params };

		if (Basic.client === undefined) {
			Basic.txShouldRetry = true;
			Sandbox.sandbox();
			throw new Error("No connection");
		}

		try {
			const result = await Basic.client.query(request);
			//Sandbox again before going back to the smart contract
			Sandbox.sandbox();
			return result;
		} catch (error) {
			if (typeof error.code !== "string") {
				Basic.txShouldRetry = true;
				Basic.txInvalidReason = "Unknown error during executions";
				await Log.fatal("Unknown error while querying database for smart contract.", error);
				await Basic.shutdown(2);
			} else if (error.code === "53300") {
				//Another instance is already running.
				Basic.txShouldRetry = true;
				Basic.txInvalidReason = "Multiple instances running";
				await Log.fatal("Another instance is already running, shutting down to prevent errors.", error);
				await Basic.shutdown(50);
			} else if (error.code === "XX001" || error.code === "XX002") {
				Basic.txShouldRetry = true;
				Basic.txInvalidReason = "Database corrupted";
				Log.info(`Database or index corrupted for query ${query} and params ${params}.`);
				await Log.fatal("Database or index corrupted. Shutting down.", error);
				await Basic.shutdown(51);
			} else if (!Basic.txShouldRetry && Basic.txInvalidReason === undefined) {
				//See https://www.postgresql.org/docs/10/static/errcodes-appendix.html
				if (error.code.startsWith("2") || error.code.startsWith("4") || error.code === "08P01" || error.code === "0A000") {
					//We don't have to retry, its the contracts own fault that this happens.
					//Log the error, the contract should be replaced by one that doesn't produce errors.
					Log.error(`Contract ${Crypto.binaryToHex(Basic.txContractHash)} is executing an invalid query: ${query}, with values: ${params}`, error);
				} else {
					Log.warn(`Error while executing contract ${Crypto.binaryToHex(Basic.txContractHash)} for query: ${query}`, error);
					Basic.txShouldRetry = true;
				}
			}
			//Sandbox again before going back to the smart contract
			Sandbox.sandbox();
			throw error;
		}
	}

	/** Shutdown the process. An error code between 50 and 59 means it should stay down due to an error it cannot recover from. */
	public static async shutdown(exitCode = 0): Promise<never> {
		if (Basic.client !== undefined) {
			try {
				await Basic.client.end();
			} catch (error) {
				Log.warn("Failed to properly shutdown database client.", error);
				if (exitCode === 0) {
					exitCode = 1;
				}
			}
		}

		return process.exit(exitCode);
	}
}