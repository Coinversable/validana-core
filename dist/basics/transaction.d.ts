/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
/// <reference types="node" />
import { Template } from "./basic";
import { PrivateKey } from "./key";
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
export declare class Transaction {
    /** This is the maximum length a transaction payload may be to be considered valid. */
    static readonly maxPayloadLength = 100000;
    /** The length of a transaction with an empty payload. */
    static readonly emptyLength = 154;
    /** Data consists of 4 bytes totalLength, 1 version, 16 transactionId, 32 contractHash, 8 validtill, ? payload, (64 signature, 33 publickey) */
    readonly data: Buffer;
    /** The version of the transaction. */
    readonly version: number;
    /**
     * Until and including what previousBlockTimestamp! this transaction is valid. (Milliseconds since unix epoch.)
     * Must be a whole number, 0 = no expiration.
     */
    readonly validTill: number;
    /** Total length of the transaction (excluding this field itsself). */
    readonly totalLength: number;
    /** Total length of the payload in the transaction. */
    readonly payloadLength: number;
    private verifiedPayload;
    private payload;
    /**
     * Create a new transaction from a database transaction or a transaction transfered between nodes or inside a block.
     * @param transaction The transaction
     * @throws if the transaction could not be constructed, but will not check the correctness of the payload or signature.
     */
    constructor(transaction: Buffer | DBTransaction);
    /**
     * Merge a list of transactions into a binary blob to be transferred or stored.
     * @param transactions A list of transactions.
     */
    static merge(transactions: Transaction[]): Buffer;
    /**
     * Unmerge a list of transactions that were stored in a block or stored as binary data.
     * @param transactions A list of transactions.
     * @throws if the data is not a valid list of transactions.
     */
    static unmerge(transactions: Buffer): Transaction[];
    /**
     * Create a signed transaction from an unsigned transaction.
     * @param tx The unsigned transaction
     * @param signPrefix The prefix to use for signing
     * @param privKey The private key to use for signing
     * @throws if a transaction could not be constructed, but will not verify the correctness of all values.
     */
    static sign(tx: Buffer | UnsignedTx, signPrefix: Buffer, privKey: PrivateKey): Transaction;
    /** Generate a (pseudo-)random id. */
    static generateId(): Buffer;
    getId(): Buffer;
    getContractHash(): Buffer;
    /** Get the payload of this transaction in binary format, does not validate if the payload is a valid json object. */
    getPayloadBinary(): Buffer;
    /** Get the signature of this transaction. Consists of 32 bytes r, followed by 32 bytes s. */
    getSignature(): Buffer;
    /** Get the public key as binary data. You can use new PublicKey(data) to generate a public key from this. */
    getPublicKeyBuffer(): Buffer;
    /** Get the address from the public key of this transaction. */
    getAddress(): string;
    /** Get the payload of this transaction or undefined if it is not a valid json object. */
    getPayloadJson(): object | undefined;
    /** Get whether or not the signature for this transaction is valid. */
    verifySignature(signPrefix: Buffer): boolean;
    /** Validate if this payload is valid for a given template. Will return an error string or undefined. */
    verifyTemplate(template: Template, version: 1 | 2): string | undefined;
    /**
     * Check if a value is of a valid type. Returns an error string or undefined.
     * @param value The value to check.
     * @param type The type to check against.
     */
    private checkType;
}
