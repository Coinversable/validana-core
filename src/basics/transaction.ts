/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import { Crypto } from "../tools/crypto";
import { Template } from "./basic";
import { randomBytes } from "crypto";
import { PublicKey, PrivateKey } from "./key";

/** An unsigned transaction. */
export interface UnsignedTx {
	version: number;
	transaction_id: Buffer;
	contract_hash: Buffer;
	valid_till: number;
	payload: string;
}

/** Transaction as found in the database. Note that the json payload should be selected as text to ensure all whitespace is preserved. */
export interface DBTransaction extends UnsignedTx {
	signature: Buffer;
	public_key: Buffer;
}

/** A class representing a transaction. */
export class Transaction {
	/** This is the maximum length a transaction payload may be to be considered valid. */
	public static readonly maxPayloadLength = 100000;
	/** The length of a transaction with an empty payload. */
	public static readonly emptyLength = 154;
	/** Data consists of 4 bytes totalLength, 1 version, 16 transactionId, 32 contractHash, 8 validtill, ? payload, (64 signature, 33 publickey) */
	public readonly data: Buffer;
	/** The version of the transaction. */
	public readonly version: number;
	/**
	 * Until and including what previousBlockTimestamp! this transaction is valid. (Milliseconds since unix epoch.)
	 * Must be a whole number, 0 = no expiration.
	 */
	public readonly validTill: number;
	/** Total length of the transaction (excluding this field itsself). */
	public readonly totalLength: number;
	/** Total length of the payload in the transaction. */
	public readonly payloadLength: number;

	//We cache the payload as it may be needed more often.
	private verifiedPayload: boolean = false;
	private payload: { [key: string]: unknown } | undefined;

	/**
	 * Create a new transaction from a database transaction or a transaction transfered between nodes or inside a block.
	 * @param transaction The transaction
	 * @throws if the transaction could not be constructed, but will not check the correctness of the payload or signature.
	 */
	constructor(transaction: Buffer | DBTransaction) {
		if (transaction instanceof Buffer) {
			this.data = transaction;
			this.version = Crypto.binaryToUInt8(this.data.slice(4, 5));
			this.validTill = Crypto.binaryToULong(this.data.slice(53, 61));
		} else {
			const binaryPayload = Crypto.utf8ToBinary(transaction.payload);
			this.version = transaction.version;
			this.validTill = transaction.valid_till;
			this.data = Buffer.concat([
				Crypto.uInt32ToBinary(binaryPayload.length + Transaction.emptyLength),
				Crypto.uInt8ToBinary(transaction.version), //This will throw an error if version <0 or >255
				transaction.transaction_id,
				transaction.contract_hash,
				Crypto.uLongToBinary(transaction.valid_till),
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
		if (!PublicKey.isValidPublic(this.getPublicKeyBuffer())) {
			throw new Error("Invalid public key.");
		}
	}

	/**
	 * Merge a list of transactions into a binary blob to be transferred or stored.
	 * @param transactions A list of transactions.
	 */
	public static merge(transactions: Transaction[]): Buffer {
		const data: Buffer[] = [];
		for (const transaction of transactions) {
			data.push(transaction.data);
		}
		return Buffer.concat(data);
	}

	/**
	 * Unmerge a list of transactions that were stored in a block or stored as binary data.
	 * @param transactions A list of transactions.
	 * @throws if the data is not a valid list of transactions.
	 */
	public static unmerge(transactions: Buffer): Transaction[] {
		const result: Transaction[] = [];
		let location = 0;
		while (location <= transactions.length - 4) {
			const totalTransactionLength = Crypto.binaryToUInt32(transactions.slice(location, location + 4));
			if (location + 4 + totalTransactionLength > transactions.length) {
				throw new Error("Length of next transaction exceeds total length of data.");
			}
			//This may throw an error as well
			result.push(new Transaction(transactions.slice(location, location + 4 + totalTransactionLength)));

			location += 4 + totalTransactionLength;
		}
		if (location !== transactions.length) {
			throw new Error("Length of remaining data does not match a full transaction.");
		}

		return result;
	}

	/**
	 * Create a signed transaction from an unsigned transaction.
	 * @param tx The unsigned transaction
	 * @param signPrefix The prefix to use for signing
	 * @param privKey The private key to use for signing
	 * @throws if a transaction could not be constructed, but will not verify the correctness of all values.
	 */
	public static sign(tx: Buffer | UnsignedTx, signPrefix: Buffer, privKey: PrivateKey): Transaction {
		const toSign = tx instanceof Buffer ? tx.slice(4) : Buffer.concat([
			Crypto.uInt8ToBinary(tx.version),
			tx.transaction_id,
			tx.contract_hash,
			Crypto.uLongToBinary(tx.valid_till),
			Crypto.utf8ToBinary(tx.payload)
		]);
		const signature = privKey.sign(Buffer.concat([signPrefix, toSign]));
		const pubKey = privKey.publicKey;
		return new Transaction(Buffer.concat([
			Crypto.uInt32ToBinary(toSign.length + signature.length + pubKey.length),
			toSign,
			signature,
			pubKey
		]));
	}

	/** Generate a (pseudo-)random id. */
	public static generateId(): Buffer {
		try {
			//It will throw an error if no good random source can be found.
			return randomBytes(16);
		} catch (error) {
			//Use a less random source, which is good enough as security doesn't depend on it.
			//We use use a better random to ensure there are no collisions.
			let result: string = "";
			for (let i = 0; i < 32; i++) {
				result += (Math.random() * 16 | 0).toString(16);
			}
			return Crypto.hexToBinary(result);
		}
	}

	public getId(): Buffer {
		return this.data.slice(5, 21);
	}

	public getContractHash(): Buffer {
		return this.data.slice(21, 53);
	}

	/** Get the payload of this transaction in binary format, does not validate if the payload is a valid json object. */
	public getPayloadBinary(): Buffer {
		return this.data.slice(61, - 97);
	}

	/** Get the signature of this transaction. Consists of 32 bytes r, followed by 32 bytes s. */
	public getSignature(): Buffer {
		return this.data.slice(- 97, - 33);
	}

	/** Get the public key as binary data. You can use new PublicKey(data) to generate a public key from this. */
	public getPublicKeyBuffer(): Buffer {
		return this.data.slice(- 33);
	}

	/** Get the address from the public key of this transaction. */
	public getAddress(): string {
		return new PublicKey(this.getPublicKeyBuffer(), true).getAddress();
	}

	/** Get the payload of this transaction or undefined if it is not a valid json object. */
	public getPayloadJson(): object | undefined {
		//If we don't know yet if it is valid parse it now.
		if (!this.verifiedPayload) {
			this.verifiedPayload = true;
			try {
				const result = JSON.parse(Crypto.binaryToUtf8(this.getPayloadBinary()));
				if (typeof result === "object" && result !== null && !(result instanceof Array)) {
					this.payload = result;
				}
			} catch (error) { }
		}

		return this.payload;
	}

	/** Get whether or not the signature for this transaction is valid. */
	public verifySignature(signPrefix: Buffer): boolean {
		try {
			return new PublicKey(this.getPublicKeyBuffer(), true).verify(Buffer.concat([signPrefix, this.data.slice(4, - 97)]), this.getSignature());
		} catch (error) {
			return false;
		}
	}

	/** Validate if this payload is valid for a given template. Will return an error string or undefined. */
	public verifyTemplate(template: Template, version: 1 | 2): string | undefined {
		//If we did not validate the json yet do this now.
		if (!this.verifiedPayload) {
			this.getPayloadJson();
		}
		if (this.payload === undefined) {
			return "Payload is invalid json.";
		}

		//Check if there aren't too many parameters.
		const templateKeys = Object.keys(template);
		if (Object.keys(this.payload).some((payloadKey) => template[payloadKey] === undefined)) {
			return "Payload has extra key.";
		}

		//Check if each key is valid
		for (const key of templateKeys) {
			const payloadKey = this.payload[key];
			const templateKeyType = template[key].type;
			if (templateKeyType.endsWith("Array")) {
				//If it is an array type check if it is indeed an array and all values inside are valid.
				if (!(payloadKey instanceof Array)) {
					return "Payload has invalid or missing array type";

				}
				const subType = templateKeyType.slice(0, -5);
				for (const payloadSubKey of payloadKey) {
					const checkTypeResult = this.checkType(payloadSubKey, subType, version);
					if (checkTypeResult !== undefined) {
						return checkTypeResult + " in array";
					}
				}
			} else if (templateKeyType.endsWith("?") && version !== 1) {
				const subType = templateKeyType.slice(0, -1);
				//If it is an optional single type
				if (payloadKey !== undefined) {
					const checkTypeResult = this.checkType(payloadKey, subType, version);
					if (checkTypeResult !== undefined) {
						return checkTypeResult;
					}
				}
			} else {
				//If it is a single type
				const checkTypeResult = this.checkType(payloadKey, templateKeyType, version);
				if (checkTypeResult !== undefined) {
					return checkTypeResult;
				}
			}
		}
		return undefined;
	}

	/**
	 * Check if a value is of a valid type. Returns an error string or undefined.
	 * @param value The value to check.
	 * @param type The type to check against.
	 */
	private checkType(value: any, type: string, version: 1 | 2): string | undefined {
		//Check what type of payload the contract requires for a certain key.
		switch (type) {
			case "bool":
				if (typeof value !== "boolean") { return "Payload has invalid or missing boolean type"; }
				break;
			case "int":
				//Will filter out non-numbers, NaN, Infinity, -Infinity and everything out of safe integer range.
				if (!Number.isSafeInteger(value)) { return "Payload has invalid or missing int type"; }
				break;
			case "uint":
				//Will filter out non-numbers, NaN, Infinity, -Infinity and everything out of safe integer range or below 0.
				if (!Number.isSafeInteger(value) || value < 0) { return "Payload has invalid or missing uint type"; }
				break;
			case "float":
				//Will filter out non-numbers, NaN, Infinity and -Infinity.
				if (!Number.isFinite(value)) { return "Payload has invalid or missing float type"; }
				break;
			case "addr":
				if (typeof value !== "string" || !PublicKey.isValidAddress(value)) { return "Payload has invalid or missing address type"; }
				break;
			case "hex":
				if (typeof value !== "string" || !Crypto.isHex(value)) { return "Payload has invalid or missing hex type"; }
				break;
			case "hash":
				if (typeof value !== "string" || value.length !== 64 || !Crypto.isHex(value)) { return "Payload has invalid or missing hash type"; }
				break;
			case "base64":
				if (typeof value !== "string" || !Crypto.isBase64(value)) { return "Payload has invalid or missing base64 type"; }
				break;
			case "json":
				if (version === 1) {
					if (typeof value !== "string") { return "Payload has invalid or missing json type"; }
					try { JSON.parse(value); } catch (error) { return "Payload has invalid or missing json type"; }
				}
				break;
			case "id":
				if (typeof value !== "string" || (version !== 1 && (value.length !== 32 || !Crypto.isHex(value)))) { return "Payload has invalid or missing id type"; }
				break;
			case "str":
			default:
				//It is a string or any other type, which will be treated as such.
				if (typeof value !== "string") { return "Payload has invalid or missing string type"; }
		}
		return undefined;
	}
}