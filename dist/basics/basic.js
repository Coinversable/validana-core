"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const log_1 = require("../tools/log");
const crypto_1 = require("../tools/crypto");
const sandbox_1 = require("./sandbox");
const transaction_1 = require("./transaction");
const key_1 = require("./key");
pg_1.types.setTypeParser(20, (val) => {
    return Number.parseInt(val, 10);
});
var TxStatus;
(function (TxStatus) {
    TxStatus["New"] = "new";
    TxStatus["ProcessingAccepted"] = "processing_accepted";
    TxStatus["ProcessingRejected"] = "processing_rejected";
    TxStatus["Invalid"] = "invalid";
    TxStatus["Accepted"] = "accepted";
    TxStatus["Rejected"] = "rejected";
})(TxStatus = exports.TxStatus || (exports.TxStatus = {}));
class Basic {
    constructor(dbclient, signPrefix) {
        this.contractMap = new Map();
        this.dbclient = dbclient;
        this.signPrefix = signPrefix;
        global.sha1 = crypto_1.Crypto.sha1;
        global.sha256 = crypto_1.Crypto.sha256;
        global.sha512 = crypto_1.Crypto.sha512;
        global.md5 = crypto_1.Crypto.md5;
        global.ripemd160 = crypto_1.Crypto.ripemd160;
        global.isValidAddress = key_1.PublicKey.isValidAddress;
    }
    async loadSmartContracts() {
        const result = await this.query("SELECT contract_hash, creator, contract_type, contract_template, code FROM basics.contracts;", []);
        if (result.error === undefined) {
            this.contractMap.clear();
            for (const row of result.rows) {
                this.contractMap.set(row.contract_hash.toString(), {
                    creator: row.creator,
                    type: row.contract_type,
                    template: row.contract_template,
                    code: new Basic.AsyncFunction("payload", "from", "block", "processor", "previousBlockTimestamp", "previousBlockHash", "query", crypto_1.Crypto.binaryToUtf8(row.code))
                });
            }
        }
        return result.error;
    }
    async processTx(tx, currentBlockId, processorAddress, previousBlockTs, previousBlockHash, verifySignature = true) {
        Basic.txShouldRetry = false;
        Basic.txInvalidReason = undefined;
        Basic.txRejectReason = undefined;
        Basic.isCreatingContract = false;
        Basic.isSpecialContract = false;
        if (!(tx instanceof transaction_1.Transaction)) {
            try {
                tx = new transaction_1.Transaction(tx);
            }
            catch (error) {
                Basic.txInvalidReason = error.message;
                return;
            }
        }
        if (verifySignature) {
            if (this.signPrefix === undefined) {
                Basic.txShouldRetry = true;
                Basic.txInvalidReason = "Cannot validate transaction signature without sign prefix.";
                log_1.Log.error("Transaction prefix not set.");
                return;
            }
            if (!tx.verifySignature(this.signPrefix)) {
                Basic.txInvalidReason = "Invalid signature.";
                return;
            }
        }
        if (tx.validTill !== 0 && previousBlockTs >= tx.validTill) {
            Basic.txInvalidReason = "Transaction valid till expired.";
            return;
        }
        const payload = tx.getPayloadJson();
        if (payload === undefined) {
            Basic.txInvalidReason = "Transaction payload is not a valid json object.";
            return;
        }
        Basic.txContractHash = tx.getContractHash();
        const contract = this.contractMap.get(Basic.txContractHash.toString());
        if (Basic.txContractHash.equals(Basic.createContractHash)) {
            Basic.txInvalidReason = tx.verifyTemplate(Basic.createContractTemplate);
        }
        else if (Basic.txContractHash.equals(Basic.deleteContractHash)) {
            Basic.txInvalidReason = tx.verifyTemplate(Basic.deleteContractTemplate);
        }
        else {
            Basic.txRejectReason = tx.verifyTemplate(contract !== undefined ? contract.template : undefined);
        }
        if (Basic.txRejectReason !== undefined || Basic.txInvalidReason !== undefined) {
            return;
        }
        const from = tx.getAddress();
        sandbox_1.Sandbox.sandbox();
        let result;
        try {
            if (Basic.txContractHash.equals(Basic.createContractHash)) {
                Basic.isSpecialContract = true;
                result = await this.createContract(payload, from, currentBlockId, processorAddress, previousBlockTs, crypto_1.Crypto.binaryToHex(previousBlockHash));
            }
            else if (Basic.txContractHash.equals(Basic.deleteContractHash)) {
                Basic.isSpecialContract = true;
                result = await this.deleteContract(payload, from);
            }
            else {
                result = await contract.code(payload, from, currentBlockId, processorAddress, previousBlockTs, crypto_1.Crypto.binaryToHex(previousBlockHash), this.querySC);
            }
        }
        catch (error) {
            Basic.txContractHash = tx.getContractHash();
            if (!Basic.txShouldRetry) {
                if (typeof error === "string" || typeof error === "number") {
                    sandbox_1.Sandbox.unSandbox();
                    Basic.txInvalidReason = error.toString();
                    log_1.Log.error(`Error during contract execution for transaction ${crypto_1.Crypto.binaryToHex(tx.getId())} ` +
                        `(contract: ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)})`, new Error(error.toString()));
                }
                else if (error instanceof Error) {
                    try {
                        error = new Error(error.message);
                    }
                    catch (_a) {
                        error = new Error("Unknown error message");
                    }
                    sandbox_1.Sandbox.unSandbox();
                    Basic.txInvalidReason = error.message;
                    log_1.Log.error(`Error during contract execution for transaction ${crypto_1.Crypto.binaryToHex(tx.getId())} ` +
                        `(contract: ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)})`, error);
                }
                else {
                    sandbox_1.Sandbox.unSandbox();
                    Basic.txInvalidReason = "Unknown error type";
                    log_1.Log.error(`Error during contract execution for transaction ${crypto_1.Crypto.binaryToHex(tx.getId())} ` +
                        `(contract: ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)})`, new Error("Unknown contract return type"));
                }
                return;
            }
        }
        sandbox_1.Sandbox.unSandbox();
        if (typeof result !== "string") {
            Basic.txRejectReason = "Unknown result type";
        }
        else if (result !== "OK") {
            Basic.txRejectReason = result;
        }
        if ((tx.getContractHash().equals(Basic.createContractHash) || tx.getContractHash().equals(Basic.deleteContractHash)) && Basic.txRejectReason !== undefined) {
            Basic.txInvalidReason = Basic.txRejectReason;
        }
        if (Basic.txInvalidReason === undefined && !Basic.txShouldRetry) {
            if (Basic.txContractHash.equals(Basic.createContractHash)) {
                if (payload.code !== "") {
                    const binaryPayloadCode = crypto_1.Crypto.base64ToBinary(payload.code);
                    const contractHash = crypto_1.Crypto.hash256(binaryPayloadCode);
                    const contractFunction = new Basic.AsyncFunction("payload", "from", "block", "processor", "previousBlockTimestamp", "previousBlockHash", "query", crypto_1.Crypto.binaryToUtf8(binaryPayloadCode));
                    this.contractMap.set(contractHash.toString(), {
                        creator: from,
                        template: JSON.parse(payload.template),
                        code: contractFunction,
                        type: payload.type
                    });
                }
            }
            else if (Basic.txContractHash.equals(Basic.deleteContractHash)) {
                this.contractMap.delete(crypto_1.Crypto.hexToBinary(payload.hash).toString());
            }
        }
    }
    async createContract(payload, from, currentBlockId, processor, previousBlockTs, previousBlockHash) {
        if (from !== processor) {
            return "User is not allowed to create a contract.";
        }
        if (payload.type.length > 64) {
            return "Trying to create an invalid contract: type too long";
        }
        if (payload.version.length > 32) {
            return "Trying to create an invalid contract: version too long";
        }
        if (payload.description.length > 256) {
            return "Trying to create an invalid contract: description too long";
        }
        const contractTemplate = JSON.parse(payload.template);
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
        if (payload.init === "" && payload.code === "") {
            return "Trying to create an invalid contract: init and/or code has to be defined";
        }
        const initCode = crypto_1.Crypto.binaryToUtf8(crypto_1.Crypto.base64ToBinary(payload.init));
        const initCheck = this.checkCode(initCode, payload.type);
        if (initCheck !== undefined) {
            return initCheck;
        }
        const initFunction = new Basic.AsyncFunction("from", "block", "processor", "previousBlockTimestamp", "previousBlockHash", "query", initCode);
        const contractBuffer = crypto_1.Crypto.base64ToBinary(payload.code);
        const contractCode = crypto_1.Crypto.binaryToUtf8(contractBuffer);
        const codeCheck = this.checkCode(contractCode, payload.type);
        if (codeCheck !== undefined) {
            return codeCheck;
        }
        new Basic.AsyncFunction("payload", "from", "block", "processor", "previousBlockTimestamp", "previousBlockHash", "query", contractCode);
        const contractHash = crypto_1.Crypto.hash256(contractBuffer);
        if (contractHash.equals(Basic.createContractHash) || contractHash.equals(Basic.deleteContractHash)) {
            return "Trying to create contract: created contract hash has an impossible value";
        }
        else if ((await this.querySC("SELECT", "basics.contracts", "WHERE contract_hash = $1;", [contractHash])).rows.length > 0) {
            return `Trying to create an invalid contract: contract already exists`;
        }
        if (payload.init !== "") {
            Basic.isCreatingContract = true;
            Basic.isSpecialContract = false;
            Basic.txContractHash = contractHash;
            await Promise.resolve(initFunction(from, currentBlockId, processor, previousBlockTs, previousBlockHash, this.querySC));
            Basic.isCreatingContract = false;
            Basic.isSpecialContract = true;
            Basic.txContractHash = Basic.createContractHash;
        }
        if (payload.code !== "") {
            const params = [contractHash, payload.type, payload.version, payload.description, from, payload.template, crypto_1.Crypto.base64ToBinary(payload.code)];
            await this.querySC("INSERT", "basics.contracts", "(contract_hash, contract_type, contract_version, description, creator, contract_template, code) " +
                "VALUES ($1, $2, $3, $4, $5, $6, $7);", params);
        }
        return "OK";
    }
    checkCode(code, contractName) {
        if (code.search(/try.*catch/s) !== -1) {
            return `Trying to create an invalid contract (${contractName}): contract may not use 'try catch'`;
        }
        if (code.indexOf("throw") !== -1) {
            return `Trying to create an invalid contract (${contractName}): contract may not use 'throw'`;
        }
        if (code.search(/(?<!await\s)query\s*\(/) !== -1) {
            return `Trying to create an invalid contract (${contractName}): contract must use 'await query()' instead of 'query()'`;
        }
        return undefined;
    }
    async deleteContract(payload, from) {
        const binaryHash = crypto_1.Crypto.hexToBinary(payload.hash);
        const result = await this.querySC("SELECT", "basics.contracts", "WHERE contract_hash = $1", [binaryHash]);
        if (result.rows.length === 0) {
            return `Trying to delete an unexisting contract: ${payload.hash}`;
        }
        if (from !== result.rows[0].creator) {
            return "Only the creator is allowed to delete a contract.";
        }
        await this.querySC("DELETE", "basics.contracts", "WHERE contract_hash = $1;", [binaryHash]);
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
                log_1.Log.warn("Failed to connect with the database.", error);
                Basic.client = undefined;
            }
        }
    }
    async query(query, values, name) {
        const request = { text: query, values };
        if (name !== undefined) {
            request.name = name;
        }
        if (Basic.client === undefined) {
            return { command: query, rowCount: 0, rows: [], oid: 0, error: new Error("No connection"), fields: [] };
        }
        try {
            return await Basic.client.query(request);
        }
        catch (error) {
            if (error.code === "53300") {
                await log_1.Log.fatal("Another instance is already running, shutting down to prevent errors.", error);
                await Basic.shutdown(50);
            }
            else if (error.code === "XX001" || error.code === "XX002") {
                log_1.Log.info(`Database or index corrupted for query ${query} and params ${values}.`);
                await log_1.Log.fatal("Database or index corrupted. Shutting down.", error);
                await Basic.shutdown(51);
            }
            return { command: query, rowCount: 0, rows: [], oid: 0, error, fields: [] };
        }
    }
    async querySC(action, table, info, params, usePrivate = false) {
        if (typeof action !== "string" || typeof table !== "string" || typeof info !== "string"
            || typeof usePrivate !== "boolean" || !(params instanceof Array)) {
            sandbox_1.Sandbox.unSandbox();
            log_1.Log.error(`Smart contract ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)} tried to execute an invalid query (wrong type)`);
            sandbox_1.Sandbox.sandbox();
            throw new Error("Invalid query request: missing or wrong type of parameters.");
        }
        params = new Array(...params);
        for (let i = 0; i < params.length; i++) {
            if (typeof params[i] === "object") {
                if (params[i] instanceof Buffer) {
                    params[i] = Buffer.from(params[i]);
                }
                else {
                    throw new Error("Invalid query request: params may not contain non-Buffer objects.");
                }
            }
        }
        sandbox_1.Sandbox.unSandbox();
        if ((action === "CREATE" || action === "DROP" || action === "ALTER" || action === "INDEX" || action === "UNIQUE INDEX" || action === "DROP INDEX")) {
            if (!Basic.isCreatingContract) {
                log_1.Log.error(`Smart contract ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)} tried to execute an invalid query during create (action ${action})`);
                sandbox_1.Sandbox.sandbox();
                throw new Error("Action not allowed for smart contracts");
            }
        }
        else if (action !== "SELECT" && action !== "INSERT" && action !== "UPDATE" && action !== "DELETE") {
            log_1.Log.error(`Smart contract ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)} tried to execute an invalid query (action: ${action})`);
            sandbox_1.Sandbox.sandbox();
            throw new Error("Action not allowed for smart contracts");
        }
        if (table === "basics.contracts") {
            if (!Basic.isSpecialContract) {
                log_1.Log.error(`Smart contract ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)} tried to execute an invalid query as non-special contract (table: ${table})`);
                sandbox_1.Sandbox.sandbox();
                throw new Error("Table not allowed for smart contracts");
            }
        }
        else if ((table === "" && action !== "DROP INDEX") || table.length >= 30 || table.indexOf(".") !== -1) {
            log_1.Log.error(`Smart contract ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)} tried to execute an invalid query (table: ${table})`);
            sandbox_1.Sandbox.sandbox();
            throw new Error("Table not allowed for smart contracts");
        }
        if (!info.endsWith(";")) {
            info += ";";
        }
        if (table.match(/;|--/) !== null || info.match(/;|--/g).length > 1) {
            log_1.Log.error(`Smart contract ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)} tried to execute an invalid query (multiple or comments: ${table} ${info})`);
            sandbox_1.Sandbox.sandbox();
            throw new Error("Smart contracts are not allowed to execute multiple queries or use comments.");
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
                log_1.Log.error(`Invalid query ${action} action after checking the query actions.`);
                sandbox_1.Sandbox.sandbox();
                throw new Error("Action not allowed for smart contracts");
        }
        if (action !== "DROP INDEX") {
            query += `${table}${usePrivate ? `_${crypto_1.Crypto.binaryToHex(Basic.txContractHash).slice(0, 32)}` : ""} `;
        }
        query += info;
        const request = { text: query, values: params };
        if (Basic.client === undefined) {
            Basic.txShouldRetry = true;
            sandbox_1.Sandbox.sandbox();
            throw new Error("No connection");
        }
        try {
            const result = await Basic.client.query(request);
            sandbox_1.Sandbox.sandbox();
            return result;
        }
        catch (error) {
            if (typeof error.code !== "string") {
                Basic.txShouldRetry = true;
                Basic.txInvalidReason = "Unknown error during executions";
                await log_1.Log.fatal("Unknown error while querying database for smart contract.", error);
                await Basic.shutdown(2);
            }
            else if (error.code === "53300") {
                Basic.txShouldRetry = true;
                Basic.txInvalidReason = "Multiple instances running";
                await log_1.Log.fatal("Another instance is already running, shutting down to prevent errors.", error);
                await Basic.shutdown(50);
            }
            else if (error.code === "XX001" || error.code === "XX002") {
                Basic.txShouldRetry = true;
                Basic.txInvalidReason = "Database corrupted";
                log_1.Log.info(`Database or index corrupted for query ${query} and params ${params}.`);
                await log_1.Log.fatal("Database or index corrupted. Shutting down.", error);
                await Basic.shutdown(51);
            }
            else if (!Basic.txShouldRetry && Basic.txInvalidReason === undefined) {
                if (error.code.startsWith("2") || error.code.startsWith("4") || error.code === "08P01" || error.code === "0A000") {
                    log_1.Log.error(`Contract ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)} is executing an invalid query: ${query}, with values: ${params}`, error);
                }
                else {
                    log_1.Log.warn(`Error while executing contract ${crypto_1.Crypto.binaryToHex(Basic.txContractHash)} for query: ${query}`, error);
                    Basic.txShouldRetry = true;
                }
            }
            sandbox_1.Sandbox.sandbox();
            throw error;
        }
    }
    static async shutdown(exitCode = 0) {
        if (Basic.client !== undefined) {
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
        return process.exit(exitCode);
    }
}
Basic.createContractHash = Buffer.alloc(32, 0);
Basic.createContractTemplate = {
    type: { type: "string" },
    version: { type: "string" },
    description: { type: "string" },
    template: { type: "json" },
    init: { type: "base64" },
    code: { type: "base64" }
};
Basic.deleteContractHash = Buffer.alloc(32, 255);
Basic.deleteContractTemplate = {
    hash: { type: "hash" }
};
Basic.AsyncFunction = Object.getPrototypeOf(async () => { }).constructor;
Basic.txShouldRetry = false;
Basic.isCreatingContract = false;
Basic.isSpecialContract = false;
exports.Basic = Basic;
//# sourceMappingURL=basic.js.map