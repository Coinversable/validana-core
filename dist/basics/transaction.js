"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("../tools/crypto");
const crypto_2 = require("crypto");
const key_1 = require("./key");
class Transaction {
    constructor(transaction) {
        this.verifiedPayload = false;
        if (transaction instanceof Buffer) {
            this.data = transaction;
            this.version = crypto_1.Crypto.binaryToUInt8(this.data.slice(4, 5));
            this.validTill = crypto_1.Crypto.binaryToULong(this.data.slice(53, 61));
        }
        else {
            const binaryPayload = crypto_1.Crypto.utf8ToBinary(transaction.payload);
            this.version = transaction.version;
            this.validTill = transaction.valid_till;
            this.data = Buffer.concat([
                crypto_1.Crypto.uInt32ToBinary(binaryPayload.length + Transaction.emptyLength),
                crypto_1.Crypto.uInt8ToBinary(transaction.version),
                transaction.transaction_id,
                transaction.contract_hash,
                crypto_1.Crypto.uLongToBinary(transaction.valid_till),
                binaryPayload,
                transaction.signature,
                transaction.public_key
            ]);
        }
        if (this.version !== 1) {
            throw new Error("Unsupported version.");
        }
        if (this.validTill < 0 || !Number.isSafeInteger(this.validTill)) {
            throw new Error("Invalid 'valid till'.");
        }
        this.totalLength = this.data.length - 4;
        this.payloadLength = this.totalLength - Transaction.emptyLength;
        if (this.totalLength < Transaction.emptyLength) {
            throw new Error("Unable to construct transaction.");
        }
        if (this.payloadLength > Transaction.maxPayloadLength) {
            throw new Error("Payload too large.");
        }
        if (!key_1.PublicKey.isValidPublic(this.getPublicKeyBuffer())) {
            throw new Error("Invalid public key.");
        }
    }
    static merge(transactions) {
        const data = [];
        for (const transaction of transactions) {
            data.push(transaction.data);
        }
        return Buffer.concat(data);
    }
    static unmerge(transactions) {
        const result = [];
        let location = 0;
        while (location < transactions.length - 4) {
            const totalTransactionLength = crypto_1.Crypto.binaryToUInt32(transactions.slice(location, location + 4));
            if (location + 4 + totalTransactionLength > transactions.length) {
                throw new Error("Length of next transaction exceeds total length of data.");
            }
            result.push(new Transaction(transactions.slice(location, location + 4 + totalTransactionLength)));
            location += 4 + totalTransactionLength;
        }
        if (location !== transactions.length) {
            throw new Error("Length of remaining data does not match a full transaction.");
        }
        return result;
    }
    static sign(tx, signPrefix, privKey) {
        if (tx.version !== 1) {
            throw new Error("Unsupported version.");
        }
        const data = Buffer.concat([
            crypto_1.Crypto.uInt8ToBinary(tx.version),
            tx.transaction_id,
            tx.contract_hash,
            crypto_1.Crypto.uLongToBinary(tx.valid_till),
            crypto_1.Crypto.utf8ToBinary(tx.payload)
        ]);
        const signature = privKey.sign(Buffer.concat([signPrefix, data]));
        const pubKey = privKey.publicKey;
        return new Transaction(Buffer.concat([
            crypto_1.Crypto.uInt32ToBinary(data.length + signature.length + pubKey.length),
            data,
            signature,
            pubKey
        ]));
    }
    static generateId() {
        try {
            return crypto_2.randomBytes(16);
        }
        catch (_a) {
            let result = "";
            for (let i = 0; i < 4; i++) {
                result += (Math.random() * 16).toString(16).slice(2, 10);
            }
            return crypto_1.Crypto.hexToBinary(result);
        }
    }
    getId() {
        return this.data.slice(5, 21);
    }
    getContractHash() {
        return this.data.slice(21, 53);
    }
    getPayloadBinary() {
        return this.data.slice(61, -97);
    }
    getSignature() {
        return this.data.slice(-97, -33);
    }
    getPublicKeyBuffer() {
        return this.data.slice(-33);
    }
    getAddress() {
        return new key_1.PublicKey(this.getPublicKeyBuffer()).getAddress();
    }
    getPayloadJson() {
        if (!this.verifiedPayload) {
            this.verifiedPayload = true;
            try {
                const result = JSON.parse(crypto_1.Crypto.binaryToUtf8(this.getPayloadBinary()));
                if (typeof result === "object") {
                    this.payload = result;
                }
            }
            catch (_a) { }
        }
        return this.payload;
    }
    verifySignature(signPrefix) {
        try {
            return new key_1.PublicKey(this.getPublicKeyBuffer()).verify(Buffer.concat([signPrefix, this.data.slice(4, -97)]), this.getSignature());
        }
        catch (error) {
            return false;
        }
    }
    verifyTemplate(template) {
        if (!this.verifiedPayload) {
            this.getPayloadJson();
        }
        if (this.payload === undefined) {
            return "Payload is invalid json.";
        }
        if (template === undefined) {
            return "Contract does not exist.";
        }
        const templateKeys = Object.keys(template);
        if (Object.keys(this.payload).length > templateKeys.length) {
            return "Payload has too many parameters";
        }
        for (const key of templateKeys) {
            const payloadKey = this.payload[key];
            if (template[key].type.endsWith("Array")) {
                if (!(payloadKey instanceof Array)) {
                    return "Payload has invalid or missing array type";
                }
                const subType = template[key].type.slice(0, template[key].type.lastIndexOf("Array"));
                for (const payloadSubKey of payloadKey) {
                    const checkTypeResult = this.checkType(payloadSubKey, subType);
                    if (checkTypeResult !== undefined) {
                        return checkTypeResult + " in array";
                    }
                }
            }
            else {
                const checkTypeResult = this.checkType(payloadKey, template[key].type);
                if (checkTypeResult !== undefined) {
                    return checkTypeResult;
                }
            }
        }
        return undefined;
    }
    checkType(value, type) {
        switch (type) {
            case "bool":
                if (typeof value !== "boolean") {
                    return "Payload has invalid or missing boolean type";
                }
                break;
            case "int":
                if (!Number.isSafeInteger(value)) {
                    return "Payload has invalid or missing int type";
                }
                break;
            case "uint":
                if (!Number.isSafeInteger(value) || value < 0) {
                    return "Payload has invalid or missing uint type";
                }
                break;
            case "float":
                if (!Number.isFinite(value)) {
                    return "Payload has invalid or missing float type";
                }
                break;
            case "addr":
                if (typeof value !== "string" || !key_1.PublicKey.isValidAddress(value)) {
                    return "Payload has invalid or missing address type";
                }
                break;
            case "hex":
                if (typeof value !== "string" || !crypto_1.Crypto.isHex(value)) {
                    return "Payload has invalid or missing hex type";
                }
                break;
            case "hash":
                if (typeof value !== "string" || value.length !== 64 || !crypto_1.Crypto.isHex(value)) {
                    return "Payload has invalid or missing hash type";
                }
                break;
            case "base64":
                if (typeof value !== "string" || !crypto_1.Crypto.isBase64(value)) {
                    return "Payload has invalid or missing base64 type";
                }
                break;
            case "json":
                if (typeof value !== "string") {
                    return "Payload has invalid or missing json type";
                }
                try {
                    JSON.parse(value);
                }
                catch (_a) {
                    return "Payload has invalid or missing json type";
                }
                break;
            case "str":
            default:
                if (typeof value !== "string") {
                    return "Payload has invalid or missing string type";
                }
        }
        return undefined;
    }
}
Transaction.maxPayloadLength = 100000;
Transaction.emptyLength = 154;
exports.Transaction = Transaction;
//# sourceMappingURL=transaction.js.map