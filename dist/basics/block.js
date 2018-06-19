"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("../tools/crypto");
class Block {
    constructor(block) {
        if (block instanceof Buffer) {
            this.data = block;
            this.totalLength = crypto_1.Crypto.binaryToUInt32(block.slice(0, 4));
            this.version = crypto_1.Crypto.binaryToUInt8(block.slice(4, 5));
            this.id = crypto_1.Crypto.binaryToULong(block.slice(5, 13));
            this.processedTs = crypto_1.Crypto.binaryToULong(block.slice(45, 53));
        }
        else {
            this.id = block.block_id;
            this.processedTs = block.processed_ts;
            this.version = block.version;
            this.data = Buffer.concat([
                crypto_1.Crypto.uInt32ToBinary(block.transactions.length + Block.emptyLength),
                crypto_1.Crypto.uInt8ToBinary(1),
                crypto_1.Crypto.uLongToBinary(this.id),
                block.previous_block_hash,
                crypto_1.Crypto.uLongToBinary(this.processedTs),
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
        while (location + 4 < this.data.length - 64) {
            location += crypto_1.Crypto.binaryToUInt32(this.data.slice(location, location + 4)) + 4;
            this.transactionsAmount++;
        }
        if (location !== this.data.length - 64) {
            throw new Error("Invalid format for transactions inside block.");
        }
    }
    static merge(blocks) {
        const data = [];
        for (const block of blocks) {
            data.push(block.data);
        }
        return Buffer.concat(data);
    }
    static unmerge(blocks) {
        const result = [];
        let location = 0;
        while (location < blocks.length - 4) {
            const totalTransactionLength = crypto_1.Crypto.binaryToUInt32(blocks.slice(location, location + 4));
            if (location + 4 + totalTransactionLength > blocks.length) {
                throw new Error("Length of next block exceeds total length of data.");
            }
            result.push(new Block(blocks.slice(location, location + 4 + totalTransactionLength)));
            location += 4 + totalTransactionLength;
        }
        if (location !== blocks.length) {
            throw new Error("Length of remaining data does not match a full block.");
        }
        return result;
    }
    static sign(block, signPrefix, privKey) {
        if (block.version !== 1) {
            throw new Error("Unsupported version.");
        }
        const data = Buffer.concat([
            crypto_1.Crypto.uInt8ToBinary(block.version),
            crypto_1.Crypto.uLongToBinary(block.block_id),
            block.previous_block_hash,
            crypto_1.Crypto.uLongToBinary(block.processed_ts),
            block.transactions
        ]);
        const signature = privKey.sign(Buffer.concat([signPrefix, data]));
        return new Block(Buffer.concat([
            crypto_1.Crypto.uInt32ToBinary(data.length + signature.length),
            data,
            signature
        ]));
    }
    getPreviousBlockHash() {
        return this.data.slice(13, 45);
    }
    getTransactions() {
        return this.data.slice(53, -64);
    }
    getSignature() {
        return this.data.slice(-64);
    }
    getHash(signPrefix) {
        return crypto_1.Crypto.hash256(Buffer.concat([
            signPrefix,
            this.data.slice(4, -64)
        ]));
    }
    verifySignature(signPrefix, pubKey) {
        try {
            return pubKey.verify(Buffer.concat([signPrefix, this.data.slice(4, -64)]), this.getSignature());
        }
        catch (error) {
            return false;
        }
    }
    verifyWithPreviousBlock(signPrefix, previousBlock) {
        if (previousBlock !== undefined) {
            if (this.id === previousBlock.id + 1) {
                return this.getPreviousBlockHash().equals(previousBlock.getHash(signPrefix)) &&
                    this.processedTs > previousBlock.processedTs;
            }
            else {
                throw new Error("Given previous block is not the previous block.");
            }
        }
        else {
            if (this.id === 0) {
                return this.getPreviousBlockHash().equals(Buffer.alloc(32, 0));
            }
            else {
                throw new Error("Given previous block is not the previous block.");
            }
        }
    }
}
Block.emptyLength = 113;
exports.Block = Block;
//# sourceMappingURL=block.js.map