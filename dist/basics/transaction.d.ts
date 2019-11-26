/// <reference types="node" />
import { Template } from "./basic";
import { PrivateKey } from "./key";
export interface UnsignedTx {
    version: number;
    transaction_id: Buffer;
    contract_hash: Buffer;
    valid_till: number;
    payload: string;
}
export interface DBTransaction extends UnsignedTx {
    signature: Buffer;
    public_key: Buffer;
}
export declare class Transaction {
    static readonly maxPayloadLength = 100000;
    static readonly emptyLength = 154;
    readonly data: Buffer;
    readonly version: number;
    readonly validTill: number;
    readonly totalLength: number;
    readonly payloadLength: number;
    private verifiedPayload;
    private payload;
    constructor(transaction: Buffer | DBTransaction);
    static merge(transactions: Transaction[]): Buffer;
    static unmerge(transactions: Buffer): Transaction[];
    static sign(tx: UnsignedTx, signPrefix: Buffer, privKey: PrivateKey): Transaction;
    static generateId(): Buffer;
    getId(): Buffer;
    getContractHash(): Buffer;
    getPayloadBinary(): Buffer;
    getSignature(): Buffer;
    getPublicKeyBuffer(): Buffer;
    getAddress(): string;
    getPayloadJson(): object | undefined;
    verifySignature(signPrefix: Buffer): boolean;
    verifyTemplate(template: Template | undefined): string | undefined;
    private checkType;
}
