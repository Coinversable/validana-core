/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import { Crypto } from "../tools/crypto";
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
export class Block {
	/** The length of a block with no transactions. */
	public static readonly emptyLength = 113;
	/** Data consists of 4 bytes block length, 1 version, 8 blockId, 32 previousBlockHash, 8 processedTs, ? transactions, 64 signature */
	public readonly data: Buffer;
	/** The version of the block. */
	public readonly version: number;
	/** Total length of this block (excluding this field). */
	public readonly totalLength: number;
	/** Id of this block. */
	public readonly id: number;
	/** Timestamp at which this block was processed (milliseconds since unix epoch) */
	public readonly processedTs: number;
	/** Amount of transactions in this block. */
	public readonly transactionsAmount: number;

	/**
	 * Create a new block based on data send from other nodes, or based on a block found in the database.
	 * @param block The block
	 * @throws If the block could not be constructed, but will not check the correctness of
	 * 	the previousBlockHash, the signature or the transactions inside the block.
	 */
	constructor(block: Buffer | DBBlock) {
		if (block instanceof Buffer) {
			this.data = block;
			//May throw an error if the buffer is too short.
			this.totalLength = Crypto.binaryToUInt32(block.slice(0, 4));
			this.version = Crypto.binaryToUInt8(block.slice(4, 5));
			this.id = Crypto.binaryToULong(block.slice(5, 13));
			this.processedTs = Crypto.binaryToULong(block.slice(45, 53));
		} else {
			this.id = block.block_id;
			this.processedTs = block.processed_ts;
			this.version = block.version;
			this.data = Buffer.concat([
				Crypto.uInt32ToBinary(block.transactions.length + Block.emptyLength),
				Crypto.uInt8ToBinary(1),
				Crypto.uLongToBinary(this.id),
				block.previous_block_hash,
				Crypto.uLongToBinary(this.processedTs),
				block.transactions,
				block.signature
			]);
		}

		if (this.version !== 1) {
			throw new Error("Unsupported version.");
		}

		this.totalLength = this.data.length - 4;
		if (this.totalLength < Block.emptyLength) {
			throw new Error("Unable to construct block.");
		}

		if (this.id < 0 || !Number.isSafeInteger(this.id)) {
			throw new Error("Invalid blockId.");
		}

		if (this.processedTs < 0 || !Number.isSafeInteger(this.processedTs)) {
			throw new Error("Invalid block processed timestamp");
		}

		this.transactionsAmount = 0;
		let location = 53;
		while (location + 4 <= this.data.length - 64) {
			location += Crypto.binaryToUInt32(this.data.slice(location, location + 4)) + 4;
			this.transactionsAmount++;
		}
		if (location !== this.data.length - 64) {
			throw new Error("Invalid format for transactions inside block.");
		}
	}

	/**
	 * Merge a list of blocks into a binary blob to be transferred or stored.
	 * @param blocks A list of blocks.
	 */
	public static merge(blocks: Block[]): Buffer {
		const data: Buffer[] = [];
		for (const block of blocks) {
			data.push(block.data);
		}
		return Buffer.concat(data);
	}

	/**
	 * Unmerge a list of blocks that were transfered or stored as binary data.
	 * @param blocks A list of blocks.
	 * @throws if the data is not a valid list of blocks.
	 */
	public static unmerge(blocks: Buffer): Block[] {
		const result: Block[] = [];
		let location = 0;
		while (location <= blocks.length - 4) {
			const totalTransactionLength = Crypto.binaryToUInt32(blocks.slice(location, location + 4));
			if (location + 4 + totalTransactionLength > blocks.length) {
				throw new Error("Length of next block exceeds total length of data.");
			}
			//This may throw an error as well
			result.push(new Block(blocks.slice(location, location + 4 + totalTransactionLength)));

			location += 4 + totalTransactionLength;
		}
		if (location !== blocks.length) {
			throw new Error("Length of remaining data does not match a full block.");
		}

		return result;
	}

	/**
	 * Create a signed block from an unsigned block.
	 * @param block The unsigned block
	 * @param signPrefix The prefix to use for signing
	 * @param privKey The private key to use for signing
	 * @throws If a block could not be constructed, but will not verify the correctness of all values.
	 */
	public static sign(block: UnsignedBlock, signPrefix: Buffer, privKey: PrivateKey): Block {
		if (block.version !== 1) {
			throw new Error("Unsupported version.");
		}
		const data = Buffer.concat([
			Crypto.uInt8ToBinary(block.version),
			Crypto.uLongToBinary(block.block_id),
			block.previous_block_hash,
			Crypto.uLongToBinary(block.processed_ts),
			block.transactions
		]);
		const signature = privKey.sign(Buffer.concat([signPrefix, data]));
		return new Block(Buffer.concat([
			Crypto.uInt32ToBinary(data.length + signature.length),
			data,
			signature
		]));
	}

	/** Get the previous block hash. */
	public getPreviousBlockHash(): Buffer {
		return this.data.slice(13, 45);
	}

	/**
	 * Get the transactions in this block.
	 * You can use Transaction.unmerge() to get an array of transactions from this.
	 */
	public getTransactions(): Buffer {
		return this.data.slice(53, -64);
	}

	/** Get the signature of this block. */
	public getSignature(): Buffer {
		return this.data.slice(-64);
	}

	/**
	 * Calculates the hash of this block.
	 * @param signPrefix the prefix to use.
	 */
	public getHash(signPrefix: Buffer): Buffer {
		return Crypto.hash256(Buffer.concat([
			signPrefix,
			this.data.slice(4, -64)
		]));
	}

	/**
	 * Verify if this signature is correct.
	 * @param signPrefix The prefix to check against.
	 * @param pubKey The public key of the processor.
	 */
	public verifySignature(signPrefix: Buffer, pubKey: PublicKey): boolean {
		//If we don't know yet if this signature is valid validate it now.
		try {
			return pubKey.verify(Buffer.concat([signPrefix, this.data.slice(4, -64)]), this.getSignature());
		} catch (error) {
			return false;
		}
	}

	/**
	 * Verify that the previousBlockHash and processedTimestamp are indeed correct compared to the previous block.
	 * @param signPrefix The prefix to use to determine the currentblock and previous block hashes.
	 * @param previousBlock The previous block or undefined if this is the first block.
	 * @throws If the previous block id is not correct.
	 */
	public verifyWithPreviousBlock(signPrefix: Buffer, previousBlock: Block | undefined): boolean {
		if (previousBlock !== undefined) {
			if (this.id === previousBlock.id + 1) {
				//Verify previous block hash and make sure we go forwards in time.
				return this.getPreviousBlockHash().equals(previousBlock.getHash(signPrefix)) &&
					this.processedTs > previousBlock.processedTs;
			} else {
				throw new Error("Given previous block is not the previous block.");
			}
		} else {
			if (this.id === 0) {
				//Verify the previousBlockHash is indeed only zeros
				return this.getPreviousBlockHash().equals(Buffer.alloc(32, 0));
			} else {
				throw new Error("Given previous block is not the previous block.");
			}
		}
	}
}