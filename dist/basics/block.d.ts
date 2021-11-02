/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
/// <reference types="node" />
import { PrivateKey, PublicKey } from "./key";
/** An unsigned block. */
export interface UnsignedBlock {
    block_id: number;
    previous_block_hash: Buffer;
    processed_ts: number;
    transactions: Buffer;
    version: number;
}
/** Format of a block as found in the database. */
export interface DBBlock extends UnsignedBlock {
    transactions_amount: number;
    signature: Buffer;
}
/** A class representing a block. */
export declare class Block {
    /** The length of a block with no transactions. */
    static readonly emptyLength = 113;
    /** Data consists of 4 bytes block length, 1 version, 8 blockId, 32 previousBlockHash, 8 processedTs, ? transactions, 64 signature */
    readonly data: Buffer;
    /** The version of the block. */
    readonly version: number;
    /** Total length of this block (excluding this field). */
    readonly totalLength: number;
    /** Id of this block. */
    readonly id: number;
    /** Timestamp at which this block was processed (milliseconds since unix epoch) */
    readonly processedTs: number;
    /** Amount of transactions in this block. */
    readonly transactionsAmount: number;
    /**
     * Create a new block based on data send from other nodes, or based on a block found in the database.
     * @param block The block
     * @throws If the block could not be constructed, but will not check the correctness of
     *  the previousBlockHash, the signature or the transactions inside the block.
     */
    constructor(block: Buffer | DBBlock);
    /**
     * Merge a list of blocks into a binary blob to be transferred or stored.
     * @param blocks A list of blocks.
     */
    static merge(blocks: Block[]): Buffer;
    /**
     * Unmerge a list of blocks that were transfered or stored as binary data.
     * @param blocks A list of blocks.
     * @throws if the data is not a valid list of blocks.
     */
    static unmerge(blocks: Buffer): Block[];
    /**
     * Create a signed block from an unsigned block.
     * @param block The unsigned block
     * @param signPrefix The prefix to use for signing
     * @param privKey The private key to use for signing
     * @throws If a block could not be constructed, but will not verify the correctness of all values.
     */
    static sign(block: UnsignedBlock, signPrefix: Buffer, privKey: PrivateKey): Block;
    /** Get the previous block hash. */
    getPreviousBlockHash(): Buffer;
    /**
     * Get the transactions in this block.
     * You can use Transaction.unmerge() to get an array of transactions from this.
     */
    getTransactions(): Buffer;
    /** Get the signature of this block. */
    getSignature(): Buffer;
    /**
     * Calculates the hash of this block.
     * @param signPrefix the prefix to use.
     */
    getHash(signPrefix: Buffer): Buffer;
    /**
     * Verify if this signature is correct.
     * @param signPrefix The prefix to check against.
     * @param pubKey The public key of the processor.
     */
    verifySignature(signPrefix: Buffer, pubKey: PublicKey): boolean;
    /**
     * Verify that the previousBlockHash and processedTimestamp are indeed correct compared to the previous block.
     * @param signPrefix The prefix to use to determine the currentblock and previous block hashes.
     * @param previousBlock The previous block or undefined if this is the first block.
     * @throws If the previous block id is not correct.
     */
    verifyWithPreviousBlock(signPrefix: Buffer, previousBlock: Block | undefined): boolean;
}
