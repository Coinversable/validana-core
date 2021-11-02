/* eslint-disable max-len */
import { Block, Crypto, UnsignedBlock, DBBlock, PrivateKey, Transaction } from "../../index";

describe("Block", () => {
	const prefix = Buffer.from("test");
	const privateKey = PrivateKey.fromWIF("KzKm6K2eShL2AhSzPFrR5WsWaMFnmWvw48g1JsQUeaRmZfThXQJT");
	const tx = Transaction.sign({ transaction_id: Buffer.alloc(16, 4), version: 1, contract_hash: Buffer.alloc(32, 8), valid_till: 123, payload: '{"key":"value"}' }, prefix, privateKey);
	const mergedTransactions = Transaction.merge([tx, tx, tx]);
	const unsignedBlock: UnsignedBlock = { block_id: 0, previous_block_hash: Buffer.alloc(32), processed_ts: 123, transactions: mergedTransactions, version: 1 };
	const unsignedBlock2: UnsignedBlock = { block_id: 1, previous_block_hash: Buffer.alloc(32), processed_ts: 1234, transactions: Buffer.alloc(0), version: 1 };
	describe("Sign block", () => {
		it("Valid", () => expect(() => Block.sign(unsignedBlock, prefix, privateKey)).not.toThrow());
		it("Valid", () => expect(() => Block.sign(unsignedBlock2, prefix, privateKey)).not.toThrow());
		it("Invalid version", () => expect(() => Block.sign({ block_id: 0, previous_block_hash: Buffer.alloc(32), processed_ts: 123, transactions: mergedTransactions, version: 2 }, prefix, privateKey)).toThrow());
		it("Invalid version", () => expect(() => Block.sign({ block_id: 0, previous_block_hash: Buffer.alloc(32), processed_ts: 123, transactions: mergedTransactions, version: 0 }, prefix, privateKey)).toThrow());
		it("Invalid version", () => expect(() => Block.sign({ block_id: 0, previous_block_hash: Buffer.alloc(32), processed_ts: 123, transactions: mergedTransactions, version: NaN }, prefix, privateKey)).toThrow());
		it("Invalid processed_ts", () => expect(() => Block.sign({ block_id: 0, previous_block_hash: Buffer.alloc(32), processed_ts: -1, transactions: mergedTransactions, version: 1 }, prefix, privateKey)).toThrow());
		it("Invalid id", () => expect(() => Block.sign({ block_id: -1, previous_block_hash: Buffer.alloc(32), processed_ts: 123, transactions: mergedTransactions, version: 1 }, prefix, privateKey)).toThrow());
		it("Invalid previous block hash", () => expect(() => Block.sign({ block_id: 0, previous_block_hash: Buffer.alloc(31), processed_ts: 123, transactions: Buffer.alloc(0), version: 1 }, prefix, privateKey)).toThrow());
	});

	const block1 = Block.sign({ block_id: 0, previous_block_hash: Buffer.alloc(32), processed_ts: 123, transactions: mergedTransactions, version: 1 }, prefix, privateKey);
	const block2 = Block.sign({ block_id: 1, previous_block_hash: block1.getHash(prefix), processed_ts: 1234, transactions: Buffer.alloc(0), version: 1 }, prefix, privateKey);
	const block3 = Block.sign({ block_id: 1, previous_block_hash: block1.getHash(prefix), processed_ts: 12, transactions: Buffer.alloc(0), version: 1 }, prefix, privateKey);
	describe("Block from signing", () => {
		const block4 = Block.sign({ block_id: 1, previous_block_hash: Buffer.alloc(32), processed_ts: 1234, transactions: Buffer.alloc(0), version: 1 }, prefix, privateKey);
		it("Version", () => expect(block1.version).toBe(1));
		it("Block id", () => expect(block1.id).toBe(0));
		it("Block processed ts", () => expect(block1.processedTs).toBe(123));
		it("Block length", () => expect(block1.totalLength).toBe(Block.emptyLength + block1.getTransactions().length));
		it("Block length", () => expect(block2.totalLength).toBe(Block.emptyLength));
		it("First block", () => expect(block1.verifyWithPreviousBlock(prefix, undefined)).toBe(true));
		it("Second block", () => expect(block2.verifyWithPreviousBlock(prefix, block1)).toBe(true));
		it("'Third' block", () => expect(block3.verifyWithPreviousBlock(prefix, block1)).toBe(false));
		it("'Fourth' block", () => expect(block4.verifyWithPreviousBlock(prefix, block1)).toBe(false));
		it("previous block", () => expect(() => block1.verifyWithPreviousBlock(prefix, block1)).toThrow());
		it("Previous block", () => expect(() => block2.verifyWithPreviousBlock(prefix, block2)).toThrow());
		it("Previous block", () => expect(() => block2.verifyWithPreviousBlock(prefix, undefined)).toThrow());
		it("Previous block hash", () => expect(block1.getPreviousBlockHash().equals(Buffer.alloc(32))).toBe(true));
		it("Previous block hash", () => expect(block2.getPreviousBlockHash().equals(block1.getHash(prefix))).toBe(true));
		it("Block signature length", () => expect(block1.getSignature().length).toBe(64));
		it("Block transactions", () => expect(block1.getTransactions().equals(mergedTransactions)).toBe(true));
		it("Block transactions", () => expect(block2.getTransactions().equals(Buffer.alloc(0))).toBe(true));
		it("Block transactions", () => expect(block1.transactionsAmount).toBe(3));
		it("Block transactions", () => expect(block2.transactionsAmount).toBe(0));
		it("Block signature", () => expect(block1.verifySignature(prefix, privateKey)).toBe(true));
		it("Block signature", () => expect(block1.verifySignature(123 as any, privateKey)).toBe(false));
		it("Block data", () => expect(block1.data.equals(Buffer.concat([
			Crypto.uInt32ToBinary(block1.totalLength), Crypto.uInt8ToBinary(block1.version), Crypto.uLongToBinary(block1.id),
			block1.getPreviousBlockHash(), Crypto.uLongToBinary(block1.processedTs), block1.getTransactions(), block1.getSignature()
		]))).toBe(true));
	});

	describe("Create block from buffer", () => {
		it("Block data", () => expect(() => new Block(block1.data)).not.toThrow());
		it("Block data", () => expect(() => new Block(block2.data)).not.toThrow());
	});

	describe("Created block from buffer", () => {
		const block5 = new Block(block1.data);
		const block6 = new Block(block2.data);
		it("Version", () => expect(block5.version).toBe(1));
		it("Block id", () => expect(block5.id).toBe(0));
		it("Block processed ts", () => expect(block5.processedTs).toBe(123));
		it("Block length", () => expect(block5.totalLength).toBe(Block.emptyLength + block5.getTransactions().length));
		it("Block length", () => expect(block6.totalLength).toBe(Block.emptyLength));
		it("Fifth block", () => expect(block5.verifyWithPreviousBlock(prefix, undefined)).toBe(true));
		it("Sixth block", () => expect(block6.verifyWithPreviousBlock(prefix, block5)).toBe(true));
		it("Previous block", () => expect(() => block5.verifyWithPreviousBlock(prefix, block5)).toThrow());
		it("Previous block", () => expect(() => block6.verifyWithPreviousBlock(prefix, block6)).toThrow());
		it("Previous block hash", () => expect(block5.getPreviousBlockHash().equals(Buffer.alloc(32))).toBe(true));
		it("Previous block hash", () => expect(block6.getPreviousBlockHash().equals(block5.getHash(prefix))).toBe(true));
		it("Block signature length", () => expect(block5.getSignature().length).toBe(64));
		it("Block transactions", () => expect(block5.getTransactions().equals(mergedTransactions)).toBe(true));
		it("Block transactions", () => expect(block6.getTransactions().equals(Buffer.alloc(0))).toBe(true));
		it("Block transactions", () => expect(block5.transactionsAmount).toBe(3));
		it("Block transactions", () => expect(block6.transactionsAmount).toBe(0));
		it("Block signature", () => expect(block5.verifySignature(prefix, privateKey)).toBe(true));
		it("Block signature", () => expect(block5.data.equals(Buffer.concat([
			Crypto.uInt32ToBinary(block5.totalLength), Crypto.uInt8ToBinary(block5.version), Crypto.uLongToBinary(block5.id),
			block5.getPreviousBlockHash(), Crypto.uLongToBinary(block5.processedTs), block5.getTransactions(), block5.getSignature()
		]))).toBe(true));
	});

	const validDBBlock: DBBlock = Object.assign({ transactions_amount: 2, signature: block1.getSignature() }, unsignedBlock);
	describe("Create block from db", () => {
		it("Valid", () => expect(() => new Block(validDBBlock)).not.toThrow());
		it("Valid", () => expect(() => new Block(Object.assign({ transactions_amount: 0, signature: block2.getSignature() }, unsignedBlock2))).not.toThrow());
		it("Invalid version", () => expect(() => new Block(Object.assign({}, validDBBlock, { version: 0 }))).toThrow());
		it("Invalid version", () => expect(() => new Block(Object.assign({}, validDBBlock, { version: 2 }))).toThrow());
		it("Invalid version", () => expect(() => new Block(Object.assign({}, validDBBlock, { version: NaN }))).toThrow());
		it("Invalid id", () => expect(() => new Block(Object.assign({}, validDBBlock, { block_id: 1.2 }))).toThrow());
		it("Invalid id", () => expect(() => new Block(Object.assign({}, validDBBlock, { block_id: NaN }))).toThrow());
		it("Invalid id", () => expect(() => new Block(Object.assign({}, validDBBlock, { block_id: -1 }))).toThrow());
		it("Invalid processed ts", () => expect(() => new Block(Object.assign({}, validDBBlock, { processed_ts: -1 }))).toThrow());
		it("Invalid processed ts", () => expect(() => new Block(Object.assign({}, validDBBlock, { processed_ts: 1.2 }))).toThrow());
		it("Invalid processed ts", () => expect(() => new Block(Object.assign({}, validDBBlock, { processed_ts: NaN }))).toThrow());
		it("Invalid data", () => expect(() => new Block(Object.assign({}, validDBBlock, { signature: Buffer.alloc(0), transactions: Buffer.alloc(0) }))).toThrow());
		it("Invalid data", () => expect(() => new Block(Object.assign({}, validDBBlock, { transactions: validDBBlock.transactions.slice(0, -1) }))).toThrow());
	});

	describe("", () => {
		const block7 = new Block(validDBBlock);
		const block8 = new Block(Object.assign({}, unsignedBlock2, { transactions_amount: 0, signature: block2.getSignature() }, { previous_block_hash: block7.getHash(prefix) }));
		it("Version", () => expect(block7.version).toBe(1));
		it("Block id", () => expect(block7.id).toBe(0));
		it("Block processed ts", () => expect(block7.processedTs).toBe(123));
		it("Block length", () => expect(block7.totalLength).toBe(Block.emptyLength + block7.getTransactions().length));
		it("Block length", () => expect(block8.totalLength).toBe(Block.emptyLength));
		it("Seventh block", () => expect(block7.verifyWithPreviousBlock(prefix, undefined)).toBe(true));
		it("Eigth block", () => expect(block8.verifyWithPreviousBlock(prefix, block7)).toBe(true));
		it("Previous block", () => expect(() => block7.verifyWithPreviousBlock(prefix, block7)).toThrow());
		it("Previous block", () => expect(() => block8.verifyWithPreviousBlock(prefix, block8)).toThrow());
		it("Previous block hash", () => expect(block7.getPreviousBlockHash().equals(Buffer.alloc(32))).toBe(true));
		it("Previous block hash", () => expect(block8.getPreviousBlockHash().equals(block7.getHash(prefix))).toBe(true));
		it("Block signature length", () => expect(block7.getSignature().length).toBe(64));
		it("Block transactions", () => expect(block7.getTransactions().equals(mergedTransactions)).toBe(true));
		it("Block transactions", () => expect(block8.getTransactions().equals(Buffer.alloc(0))).toBe(true));
		it("Block transactions", () => expect(block7.transactionsAmount).toBe(3));
		it("Block transactions", () => expect(block8.transactionsAmount).toBe(0));
		it("Block signature", () => expect(block7.verifySignature(prefix, privateKey)).toBe(true));
		it("Block signature", () => expect(block7.data.equals(Buffer.concat([
			Crypto.uInt32ToBinary(block7.totalLength), Crypto.uInt8ToBinary(block7.version), Crypto.uLongToBinary(block7.id),
			block7.getPreviousBlockHash(), Crypto.uLongToBinary(block7.processedTs), block7.getTransactions(), block7.getSignature()
		]))).toBe(true));
	});

	describe("(Un)merge", () => {
		it("Merge empty", () => expect(Block.merge([]).equals(Buffer.alloc(0))).toBe(true));
		it("Unmerge empty", () => expect(Block.unmerge(Buffer.alloc(0))).toEqual([]));
		it("Merge and unmerge empty", () => expect(Block.unmerge(Block.merge([]))).toEqual([]));
		it("Merge and unmerge single", () => expect(block1.data.equals(Block.unmerge(Block.merge([block1]))[0].data)).toEqual(true));
		const blocks = [block1, block2, block3];
		const mergedBlocks = Block.merge(blocks);
		const unmergedBlocks = Block.unmerge(mergedBlocks);
		it("Merge and unmerge multiple", () => expect(blocks.length).toEqual(Block.unmerge(Block.merge(blocks)).length));
		it("Data or order.", () => expect(blocks[0].data.equals(unmergedBlocks[0].data)).toBe(true));
		it("Data or order.", () => expect(blocks[1].data.equals(unmergedBlocks[1].data)).toBe(true));
		it("Data or order.", () => expect(blocks[2].data.equals(unmergedBlocks[2].data)).toBe(true));
		it("Unmerging uncomplete", () => expect(() => Block.unmerge(Buffer.alloc(1))).toThrow());
		it("Unmerging too short", () => expect(() => Block.unmerge(Crypto.uInt32ToBinary(9999))).toThrow());
	});
});