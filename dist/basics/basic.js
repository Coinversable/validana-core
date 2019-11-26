"use strict";
/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const log_1 = require("../tools/log");
const crypto_1 = require("../tools/crypto");
const sandbox_1 = require("./sandbox");
const transaction_1 = require("./transaction");
pg_1.types.setTypeParser(20, (val) => Number.parseInt(val, 10));
pg_1.types.setTypeParser(1016, (val) => val.length === 2 ? [] : val.slice(1, -1).split(",").map((v) => Number.parseInt(v, 10)));
var TxStatus;
(function (TxStatus) {
    TxStatus["New"] = "new";
    TxStatus["Invalid"] = "invalid";
    TxStatus["Accepted"] = "accepted";
    TxStatus["Rejected"] = "rejected";
})(TxStatus = exports.TxStatus || (exports.TxStatus = {}));
class Basic {
    constructor(dbclient, signPrefix, initHook) {
        this.contractMap = new Map();
        this.isProcessing = false;
        this.dbclient = dbclient;
        this.signPrefix = signPrefix;
        this.initHook = initHook;
    }
    async loadSmartContracts() {
        const result = await this.query("SELECT contract_hash, creator, contract_type, contract_template, code, validana_version FROM basics.contracts;", []);
        this.contractMap.clear();
        for (const row of result.rows) {
            let code = crypto_1.Crypto.binaryToUtf8(row.code);
            if (row.validana_version !== 1) {
                code = '"use strict";' + code;
            }
            this.contractMap.set(row.contract_hash.toString(), {
                creator: row.creator,
                type: row.contract_type,
                template: row.contract_template,
                code: new Basic.AsyncFunction("payload", "from", "block", "processor", "previousBlockTimestamp", "previousBlockHash", "transactionId", "currentBlockTimestamp", code).bind(global),
                validanaVersion: row.validana_version
            });
        }
    }
    async processTx(unvalidatedTx, currentBlockId, currentBlockTs, processorAddress, previousBlockTs, previousBlockHash, verifySignature = true) {
        if (this.isProcessing) {
            throw new Error("Was still processing.");
        }
        this.isProcessing = true;
        Basic.txError = undefined;
        Basic.txErrorExitCode = 0;
        Basic.txShouldRetry = false;
        Basic.txInvalidReason = undefined;
        Basic.txRejectReason = undefined;
        Basic.processFastQueries.splice(0);
        Basic.isSpecialContract = false;
        const validatedTx = await this.validateTx(unvalidatedTx, previousBlockTs, verifySignature);
        if (validatedTx === undefined) {
            return this.finishProcessingTx(validatedTx);
        }
        Basic.txContractHash = validatedTx.getContractHash();
        const contract = this.contractMap.get(Basic.txContractHash.toString());
        if (Basic.txContractHash.equals(Basic.createContractHash)) {
            Basic.txRejectReason = validatedTx.verifyTemplate(Basic.createContractTemplate, 2);
            Basic.isSpecialContract = true;
        }
        else if (Basic.txContractHash.equals(Basic.deleteContractHash)) {
            Basic.txRejectReason = validatedTx.verifyTemplate(Basic.deleteContractTemplate, 2);
            Basic.isSpecialContract = true;
        }
        else {
            if (contract === undefined) {
                Basic.txRejectReason = "Contract does not exist.";
            }
            else {
                Basic.txRejectReason = validatedTx.verifyTemplate(contract.template, contract.validanaVersion);
            }
        }
        if (Basic.txRejectReason !== undefined) {
            return this.finishProcessingTx(validatedTx);
        }
        const from = validatedTx.getAddress();
        const payload = JSON.parse(validatedTx.getPayloadBinary().toString());
        sandbox_1.Sandbox.sandbox();
        try {
            if (Basic.txContractHash.equals(Basic.createContractHash)) {
                Basic.txAcceptReason = await this.createContract(payload, from, currentBlockId, processorAddress, previousBlockTs, crypto_1.Crypto.binaryToHex(previousBlockHash), crypto_1.Crypto.binaryToHex(validatedTx.getId()), currentBlockTs);
            }
            else if (Basic.txContractHash.equals(Basic.deleteContractHash)) {
                Basic.txAcceptReason = await this.deleteContract(payload, from);
            }
            else {
                Basic.txAcceptReason = await contract.code(payload, from, currentBlockId, processorAddress, previousBlockTs, crypto_1.Crypto.binaryToHex(previousBlockHash), crypto_1.Crypto.binaryToHex(validatedTx.getId()), currentBlockTs);
                if (typeof Basic.txAcceptReason !== "string") {
                    Basic.txAcceptReason = "Unknown result type";
                }
            }
        }
        catch (error) {
            try {
                error = new Error(error.message.slice(0, 2000));
            }
            catch (error2) {
                error = new Error("Unknown error message");
            }
            Basic.invalidate("Error during contract execution", false, error);
            return this.finishProcessingTx(validatedTx);
        }
        return this.finishProcessingTx(validatedTx, contract === undefined ? 2 : contract.validanaVersion);
    }
    async validateTx(unvalidatedTx, previousBlockTs, verifySignature) {
        if (!(unvalidatedTx instanceof transaction_1.Transaction)) {
            try {
                unvalidatedTx = new transaction_1.Transaction(unvalidatedTx);
            }
            catch (error) {
                Basic.invalidate(error.message, false);
                return undefined;
            }
        }
        if (verifySignature) {
            if (this.signPrefix === undefined) {
                Basic.invalidate("Cannot validate transaction signature without sign prefix.", true, new Error("Transaction prefix not set."));
                return undefined;
            }
            if (!unvalidatedTx.verifySignature(this.signPrefix)) {
                Basic.invalidate("Invalid signature.", false);
                return undefined;
            }
        }
        if (unvalidatedTx.validTill !== 0 && previousBlockTs >= unvalidatedTx.validTill) {
            Basic.invalidate("Transaction valid till expired.", false);
            return undefined;
        }
        return unvalidatedTx;
    }
    async finishProcessingTx(validatedTx, version = 2) {
        var _a;
        await Promise.all(Basic.processFastQueries);
        sandbox_1.Sandbox.unSandbox();
        if (validatedTx !== undefined) {
            if (Basic.txError !== undefined) {
                if (Basic.txErrorExitCode !== 0) {
                    await Basic.shutdown(Basic.txErrorExitCode, "Error during contract execution for transaction " +
                        `${crypto_1.Crypto.binaryToHex(validatedTx.getId())} (contract: ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)})`, Basic.txError);
                }
                else {
                    await log_1.Log.error(`Error during contract execution for transaction ${crypto_1.Crypto.binaryToHex(validatedTx.getId())} ` +
                        `(contract: ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)})`, Basic.txError);
                }
            }
            if (validatedTx.getContractHash().equals(Basic.createContractHash) || validatedTx.getContractHash().equals(Basic.deleteContractHash)) {
                if (Basic.txRejectReason !== undefined) {
                    Basic.invalidate(Basic.txRejectReason, false);
                }
                if (Basic.txInvalidReason === undefined) {
                    if (validatedTx.getContractHash().equals(Basic.createContractHash)) {
                        const payload = validatedTx.getPayloadJson();
                        if (typeof payload.code === "string" && payload.code !== "") {
                            const binaryPayloadCode = crypto_1.Crypto.base64ToBinary(payload.code);
                            const validanaVersion = (_a = payload.validanaVersion, (_a !== null && _a !== void 0 ? _a : 1));
                            let code = crypto_1.Crypto.binaryToUtf8(binaryPayloadCode);
                            if (validanaVersion !== 1) {
                                code = '"use strict";' + code;
                            }
                            const contractHash = crypto_1.Crypto.hash256(code);
                            const contractFunction = new Basic.AsyncFunction("payload", "from", "block", "processor", "previousBlockTimestamp", "previousBlockHash", "transactionId", "currentBlockTimestamp", code).bind(global);
                            this.contractMap.set(contractHash.toString(), {
                                creator: validatedTx.getAddress(),
                                template: typeof payload.template === "string" ? JSON.parse(payload.template) : payload.template,
                                validanaVersion,
                                code: contractFunction,
                                type: payload.type
                            });
                        }
                    }
                    else {
                        const payload = validatedTx.getPayloadJson();
                        this.contractMap.delete(crypto_1.Crypto.hexToBinary(payload.hash).toString());
                    }
                }
            }
        }
        this.isProcessing = false;
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
            return { status: "v1Rejected", message: Basic.txAcceptReason };
        }
        else {
            return { status: TxStatus.Accepted, message: Basic.txAcceptReason };
        }
    }
    async createContract(payload, from, currentBlockId, processor, previousBlockTs, previousBlockHash, transactionId, currentBlockTs) {
        var _a, _b, _c, _d, _e;
        if (from !== processor) {
            return Basic.reject("User is not allowed to create a contract.");
        }
        if (payload.type.length > 64) {
            return Basic.reject("Trying to create an invalid contract: type too long");
        }
        if (payload.version.length > 32) {
            return Basic.reject("Trying to create an invalid contract: version too long");
        }
        if (payload.description.length > 256) {
            return Basic.reject("Trying to create an invalid contract: description too long");
        }
        const validanaVersion = (_a = payload.validanaVersion, (_a !== null && _a !== void 0 ? _a : 1));
        if (validanaVersion < 1 || validanaVersion > 2) {
            return Basic.reject("Unsupported contract version");
        }
        if (typeof payload.template === "string") {
            payload.template = JSON.parse(payload.template);
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
        if (payload.init === "" && payload.code === "") {
            return Basic.reject("Trying to create an invalid contract: init and/or code has to be defined");
        }
        let initCode = crypto_1.Crypto.binaryToUtf8(crypto_1.Crypto.base64ToBinary(payload.init));
        if (validanaVersion !== 1) {
            initCode = '"use strict";' + initCode;
        }
        const initCheck = this.checkCode(initCode, payload.type);
        if (initCheck !== undefined) {
            return Basic.reject(initCheck);
        }
        const initFunction = new Basic.AsyncFunction("from", "block", "processor", "previousBlockTimestamp", "previousBlockHash", "transactionId", "currentBlockTimestamp", initCode).bind(global);
        const contractBuffer = crypto_1.Crypto.base64ToBinary(payload.code);
        let contractCode = crypto_1.Crypto.binaryToUtf8(contractBuffer);
        if (validanaVersion !== 1) {
            contractCode = '"use strict";' + contractCode;
        }
        const codeCheck = this.checkCode(contractCode, payload.type);
        if (codeCheck !== undefined) {
            return Basic.reject(codeCheck);
        }
        new Basic.AsyncFunction("payload", "from", "block", "processor", "previousBlockTimestamp", "previousBlockHash", "transactionId", "currentBlockTimestamp", contractCode).bind(global);
        Basic.querySCFast("SET LOCAL ROLE smartcontractmanager;", []);
        const contractHash = crypto_1.Crypto.hash256(contractCode);
        if (contractHash.equals(Basic.createContractHash) || contractHash.equals(Basic.deleteContractHash)) {
            return Basic.reject("Trying to create contract: created contract hash has an impossible value");
        }
        else {
            if ((await Basic.querySC("SELECT FROM basics.contracts WHERE contract_hash = $1;", [contractHash])).rows.length > 0) {
                return Basic.reject("Trying to create an invalid contract: contract already exists");
            }
        }
        if (payload.init !== "") {
            const statementTimeout = (await Basic.querySC("SHOW statement_timeout;", [])).rows[0].statement_timeout;
            Basic.querySCFast("SET LOCAL statement_timeout = 0;", []);
            Basic.querySCFast("SET LOCAL ROLE smartcontract;", []);
            (_c = (_b = this).initHook) === null || _c === void 0 ? void 0 : _c.call(_b, true);
            Basic.isSpecialContract = false;
            Basic.txContractHash = contractHash;
            await initFunction(from, currentBlockId, processor, previousBlockTs, previousBlockHash, transactionId, currentBlockTs).catch((e) => {
                var _a, _b;
                Basic.txContractHash = Basic.createContractHash;
                (_b = (_a = this).initHook) === null || _b === void 0 ? void 0 : _b.call(_a, false);
                throw e;
            });
            Basic.isSpecialContract = true;
            Basic.txContractHash = Basic.createContractHash;
            (_e = (_d = this).initHook) === null || _e === void 0 ? void 0 : _e.call(_d, false);
            await Basic.querySC(`SET LOCAL statement_timeout = '${statementTimeout}';`, []);
        }
        if (payload.code !== "") {
            const params = [contractHash, payload.type, payload.version, payload.description, from,
                payload.template, crypto_1.Crypto.base64ToBinary(payload.code), validanaVersion];
            Basic.querySCFast("SET LOCAL ROLE smartcontractmanager;", []);
            Basic.querySCFast("INSERT INTO basics.contracts (contract_hash, contract_type, contract_version, description, "
                + "creator, contract_template, code, validana_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);", params);
        }
        Basic.querySCFast("SET LOCAL ROLE smartcontract;", []);
        return "OK";
    }
    checkCode(code, contractName) {
        if (code.search(/try[^]+?catch/) !== -1) {
            return `Trying to create an invalid contract (${contractName}): contract may not use 'try catch', instead use 'await query().catch()'.`;
        }
        if (code.search(/(?<!await\s)query\s*\(/) !== -1) {
            return `Trying to create an invalid contract (${contractName}): contract must use 'await query()' instead of 'query()'`;
        }
        return undefined;
    }
    async deleteContract(payload, from) {
        Basic.querySCFast("SET LOCAL ROLE smartcontractmanager;", []);
        const result = await Basic.querySC("DELETE FROM basics.contracts WHERE contract_hash = $1 AND creator = $2;", [crypto_1.Crypto.hexToBinary(payload.hash), from]);
        if (result.rowCount === 0) {
            return Basic.reject(`Not creator of contract or contract: ${payload.hash} does not exist.`);
        }
        Basic.querySCFast("SET LOCAL ROLE smartcontract;", []);
        return "OK";
    }
    async connect() {
        if (Basic.client === undefined) {
            try {
                Basic.client = new pg_1.Client(this.dbclient).on("error", (error) => {
                    Basic.client = undefined;
                    if (this.dbclient.password !== undefined) {
                        error.message = error.message.replace(new RegExp(this.dbclient.password, "g"), "");
                    }
                    log_1.Log.warn("Problem with database connection.", error);
                }).on("end", () => Basic.client = undefined);
                await Basic.client.connect();
            }
            catch (error) {
                if (this.dbclient.password !== undefined) {
                    error.message = error.message.replace(new RegExp(this.dbclient.password, "g"), "");
                }
                if (error.code === "53300") {
                    await Basic.shutdown(50, "Another instance is already running, shutting down to prevent errors.", error);
                }
                else {
                    log_1.Log.warn("Failed to connect with the database.", error);
                    Basic.client = undefined;
                }
            }
            return true;
        }
        else {
            return false;
        }
    }
    async query(query, params, name) {
        const request = { text: query, values: params };
        if (name !== undefined) {
            request.name = name;
        }
        if (Basic.client === undefined) {
            throw new Error("No connection");
        }
        try {
            return await Basic.client.query(request);
        }
        catch (error) {
            if (error.code === "XX001" || error.code === "XX002") {
                log_1.Log.info(`Database or index corrupted for query ${query} and params ${JSON.stringify(params)}.`);
                await Basic.shutdown(51, "Database or index corrupted. Shutting down.", error);
            }
            throw error;
        }
    }
    static async querySC(query, params) {
        if (typeof query !== "string" || !(params instanceof Array)) {
            [query, params] = Basic.convertV1(...arguments);
        }
        query = query.trim();
        if (!query.endsWith(";")) {
            query += ";";
        }
        if (query.search(/;|--|localtime|current_(?:date|time)/i) !== query.length - 1) {
            const error = new Error("Invalid query: multiple queries, comments or time request.");
            Basic.invalidate("Invalid query: multiple queries, comments or time request.", false, error);
            throw error;
        }
        if (query.search(/^(?:alter\s+(?:index|table|type)|create\s+(?:(?:unique\s+)?index|table|type)|delete|drop\s+(?:index|table|type)|insert|select|update|with)/i) !== 0) {
            if (!Basic.isSpecialContract && query.search(/^SET LOCAL (?:ROLE smartcontract(?:manager)?;|statement_timeout = .*)|SHOW statement_timeout;$/) !== 0) {
                const error = new Error(`Invalid query: invalid action for query ${query}.`);
                Basic.invalidate("Invalid query: action not allowed.", false, error);
                throw error;
            }
        }
        if (Basic.client === undefined) {
            const error = new Error("No database connection");
            Basic.invalidate("No database connection.", true, error);
            throw error;
        }
        try {
            const result = await Basic.client.query(query, params);
            return { rows: result.rows, rowCount: result.rowCount };
        }
        catch (error) {
            if (typeof error.code !== "string") {
                Basic.invalidate("Unknown error during execution", false, error, 2);
            }
            else if (error.code === "XX001" || error.code === "XX002") {
                Basic.invalidate("Database corrupted", true, new Error(`Database or index corrupted for query ${query} and params ${JSON.stringify(params)}.`), 51);
            }
            else if (error.code.startsWith("08") && error.code !== "08P01") {
                Basic.invalidate("Database connection problem.", true, error);
            }
            else if (error.code.startsWith("23")) {
                const error2 = new Error(`${error.message}, when executing query: ${query}, and params: ${JSON.stringify(params)}`);
                error2.stack = error2.message;
                error2.code = error.code;
                throw error2;
            }
            else {
                error.message = `${error.message}, while executing contract ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)} for query: ${query}`;
                Basic.invalidate("Error during contract execution", false, error);
            }
            throw error;
        }
    }
    static querySCFast(query, params) {
        Basic.processFastQueries.push(Basic.querySC(query, params).catch((error) => Basic.invalidate("Error during contract execution", false, error)));
    }
    static convertV1(action, table, info, params, usePrivate = false) {
        if (typeof action !== "string" || typeof table !== "string" || typeof info !== "string"
            || typeof usePrivate !== "boolean" || !(params instanceof Array)) {
            const error = new Error(`Invalid query: Smart contract ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)} tried to execute an invalid query (wrong type)`);
            Basic.invalidate("Invalid query: invalid parameters.", false, error);
            throw error;
        }
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
            case "INDEX":
                query += `CREATE INDEX IF NOT EXISTS ${params[0]} ON `;
                params = [];
                break;
            case "UNIQUE INDEX":
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
            query += `${table}${usePrivate ? `_${crypto_1.Crypto.binaryToHex(Basic.txContractHash).slice(0, 32)}` : ""} `;
        }
        query += info;
        return [query, params];
    }
    static reject(reason) {
        if (Basic.txRejectReason === undefined) {
            Basic.txRejectReason = typeof reason === "string" ? reason : "Unknown reject reason";
        }
    }
    static invalidate(reason, retry, error, exitCode = 0) {
        if (Basic.txInvalidReason === undefined) {
            Basic.txInvalidReason = reason;
            Basic.txShouldRetry = retry;
            Basic.txError = error;
            Basic.txErrorExitCode = exitCode;
        }
    }
    static async shutdown(exitCode = 0, message, error) {
        sandbox_1.Sandbox.unSandbox();
        if (Basic.client !== undefined) {
            Basic.isShuttingDown = true;
            try {
                await Basic.client.end();
            }
            catch (error) {
                log_1.Log.warn("Failed to properly shutdown database client.", error);
                if (exitCode === 0) {
                    exitCode = 1;
                }
            }
        }
        if (message !== undefined) {
            await log_1.Log.fatal(message, error);
        }
        return process.exit(exitCode);
    }
}
exports.Basic = Basic;
Basic.createContractHash = Buffer.alloc(32, 0);
Basic.createContractTemplate = {
    type: { type: "str" },
    version: { type: "str" },
    description: { type: "str" },
    template: { type: "json" },
    init: { type: "base64" },
    code: { type: "base64" },
    validanaVersion: { type: "uint?" }
};
Basic.deleteContractHash = Buffer.alloc(32, 255);
Basic.deleteContractTemplate = {
    hash: { type: "hash" }
};
Basic.AsyncFunction = Object.getPrototypeOf(async () => { }).constructor;
Basic.txErrorExitCode = 0;
Basic.txShouldRetry = false;
Basic.processFastQueries = [];
Basic.isSpecialContract = false;
Basic.isShuttingDown = false;
//# sourceMappingURL=basic.js.map