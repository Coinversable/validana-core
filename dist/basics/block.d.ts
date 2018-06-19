/// <reference types="node" />
import { PrivateKey, PublicKey } from "./key";
export interface UnsignedBlock {
    block_id: number;
    previous_block_hash: Buffer;
    processed_ts: number;
    transactions: Buffer;
    version: number;
}
export interface DBBlock extends UnsignedBlock {
    transactions_amount: number;
    signature: Buffer;
}
export declare class Block {
    static readonly emptyLength: number;
    readonly data: Buffer;
    readonly version: number;
    readonly totalLength: number;
    readonly id: number;
    readonly processedTs: number;
    readonly transactionsAmount: number;
    constructor(block: Buffer | DBBlock);
    static merge(blocks: Block[]): Buffer;
    static unmerge(blocks: Buffer): Block[];
    static sign(block: UnsignedBlock, signPrefix: Buffer, privKey: PrivateKey): Block;
    getPreviousBlockHash(): Buffer;
    getTransactions(): Buffer;
    getSignature(): Buffer;
    getHash(signPrefix: Buffer): Buffer;
    verifySignature(signPrefix: Buffer, pubKey: PublicKey): boolean;
    verifyWithPreviousBlock(signPrefix: Buffer, previousBlock: Block | undefined): boolean;
}
