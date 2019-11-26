import { Transaction, UnsignedTx, PrivateKey, Crypto, ContractVersion, DBTransaction } from "../../index";

// tslint:disable: max-line-length
// tslint:disable: no-null-keyword
describe("Transaction", () => {
	it("Transaction generate id", () => expect(Transaction.generateId().length).toBe(16));

	const prefix = Buffer.from("asdf");
	const privateKey = PrivateKey.fromWIF("KzKm6K2eShL2AhSzPFrR5WsWaMFnmWvw48g1JsQUeaRmZfThXQJT");
	const unsignedTxValid: UnsignedTx = { transaction_id: Buffer.alloc(16, 4), version: 1, contract_hash: Buffer.alloc(32, 8), valid_till: 123, payload: '{"key":"value"}' };
	describe("Sign", () => {
		const unsignedTxInvalid: UnsignedTx = { transaction_id: Transaction.generateId(), version: 1, contract_hash: Buffer.alloc(0), valid_till: 0, payload: "test" };
		const unsignedTxValidUndefinedPayload: UnsignedTx = { transaction_id: Buffer.alloc(16, 4), version: 1, contract_hash: Buffer.alloc(32, 8), valid_till: 123, payload: "asdfasdfasdf" };
		const unsignedTxValidUndefinedPayload2: UnsignedTx = { transaction_id: Buffer.alloc(16, 4), version: 1, contract_hash: Buffer.alloc(32, 8), valid_till: 123, payload: "true" };
		const unsignedTxValidUndefinedPayload3: UnsignedTx = { transaction_id: Buffer.alloc(16, 4), version: 1, contract_hash: Buffer.alloc(32, 8), valid_till: 123, payload: "null" };

		it("Invalid transaction", () => expect(() => Transaction.sign(unsignedTxInvalid, Buffer.from(""), privateKey)).toThrow());
		it("Invalid transaction", () => expect(() => Transaction.sign(unsignedTxInvalid, prefix, privateKey)).toThrow());
		it("Invalid transaction", () => expect(() => Transaction.sign({ transaction_id: Transaction.generateId(), version: 0, contract_hash: Buffer.alloc(32), valid_till: 0, payload: "{}" }, prefix, privateKey)).toThrow());
		it("Invalid transaction", () => expect(() => Transaction.sign({ transaction_id: Transaction.generateId(), version: 2, contract_hash: Buffer.alloc(32), valid_till: 0, payload: "{}" }, prefix, privateKey)).toThrow());
		it("Invalid transaction", () => expect(() => Transaction.sign({ transaction_id: Transaction.generateId(), version: NaN, contract_hash: Buffer.alloc(32), valid_till: 0, payload: "{}" }, prefix, privateKey)).toThrow());
		it("Transaction payload invalid", () => expect(Transaction.sign(unsignedTxValidUndefinedPayload, prefix, privateKey).getPayloadJson()).toBe(undefined));
		it("Transaction payload invalid", () => expect(Transaction.sign(unsignedTxValidUndefinedPayload2, prefix, privateKey).getPayloadJson()).toBe(undefined));
		it("Transaction payload invalid", () => expect(Transaction.sign(unsignedTxValidUndefinedPayload3, prefix, privateKey).getPayloadJson()).toBe(undefined));
		it("sign empty", () => expect(() => Transaction.sign(unsignedTxValid, Buffer.from(""), privateKey)).not.toThrow());
		it("sign random", () => expect(() => Transaction.sign(unsignedTxValid, prefix, privateKey)).not.toThrow());
	});

	const tx = Transaction.sign(unsignedTxValid, Buffer.from("test"), privateKey);
	describe("Created transaction by signing", () => {
		it("Transaction address", () => expect(tx.getAddress()).toBe(privateKey.getAddress()));
		it("Transaction public key", () => expect(tx.getPublicKeyBuffer().equals(privateKey.publicKey)).toBe(true));
		it("Transaction id", () => expect(tx.getId().toString("hex")).toBe("04040404040404040404040404040404"));
		it("Transaction signature length", () => expect(tx.getSignature().length).toBe(64));
		it("Transaction contract hash", () => expect(tx.getContractHash().toString("hex")).toBe("0808080808080808080808080808080808080808080808080808080808080808"));
		it("Transaction binary payload", () => expect(tx.getPayloadBinary().toString()).toBe('{"key":"value"}'));
		it("Transaction payload", () => expect(tx.getPayloadJson()).toEqual({ key: "value" }));
		it("Transaction payload second time", () => expect(tx.getPayloadJson()).toEqual({ key: "value" }));
		it("Transaction payload length", () => expect(tx.payloadLength).toBe(Buffer.from('{"key":"value"}').length));
		it("Transaction total length", () => expect(tx.totalLength).toBe(tx.payloadLength + Transaction.emptyLength));
		it("Transaction total length", () => expect(tx.totalLength).toBe(tx.data.length - 4));
		it("Transaction valid till ", () => expect(tx.validTill).toBe(123));
		it("Transaction version", () => expect(tx.version).toBe(1));
		//Data consists of 4 bytes totalLength, 1 version, 16 transactionId, 32 contractHash, 8 validtill, ? payload, 64 signature, 33 publickey
		it("Transaction data", () => expect(tx.data.equals(Buffer.concat([
			Crypto.uInt32ToBinary(tx.totalLength), Crypto.uInt8ToBinary(tx.version), tx.getId(), tx.getContractHash(),
			Crypto.uLongToBinary(tx.validTill), tx.getPayloadBinary(), tx.getSignature(), tx.getPublicKeyBuffer()
		]))).toBe(true));
		it("Transaction signature", () => expect(tx.verifySignature(Buffer.from("test"))).toBe(true));
		it("Transaction other prefix validation", () => expect(tx.verifySignature(1 as any)).toBe(false));
		it("Transaction template v1", () => expect(tx.verifyTemplate({ key: { type: "string" } }, 1)).toBe(undefined));
		it("Transaction template v2", () => expect(tx.verifyTemplate({ key: { type: "string" } }, 2)).toBe(undefined));
	});

	const dbTx: DBTransaction = {
		transaction_id: Buffer.alloc(16, 8), version: 1, contract_hash: Buffer.alloc(32, 16), valid_till: 0,
		payload: '{"keys":123}', signature: Buffer.alloc(64), public_key: privateKey.publicKey
	};
	describe("Create transaction from DB", () => {
		it("Creating valid", () => expect(() => new Transaction(dbTx)).not.toThrow());
		it("Max size", () => expect(() => new Transaction({
			transaction_id: Buffer.alloc(16, 4), version: 1, contract_hash: Buffer.alloc(32, 8), valid_till: 123,
			payload: Buffer.alloc(Transaction.maxPayloadLength).toString(), signature: tx.getSignature(), public_key: privateKey.publicKey
		})).not.toThrow());
		it("Max size + 1", () => expect(() => new Transaction({
			transaction_id: Buffer.alloc(16, 4), version: 1, contract_hash: Buffer.alloc(32, 8), valid_till: 123,
			payload: Buffer.alloc(Transaction.maxPayloadLength + 1).toString(), signature: tx.getSignature(), public_key: privateKey.publicKey
		})).toThrow());
		it("Invalid valid_till", () => expect(() => new Transaction({
			transaction_id: Buffer.alloc(16, 4), version: 1, contract_hash: Buffer.alloc(32, 8), valid_till: 1.2,
			payload: "{}", signature: tx.getSignature(), public_key: privateKey.publicKey
		})).toThrow());
		it("Invalid public key", () => expect(() => new Transaction({
			transaction_id: Buffer.alloc(16, 4), version: 1, contract_hash: Buffer.alloc(32, 8), valid_till: 0,
			payload: "{}", signature: tx.getSignature(), public_key: Buffer.from("001234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", "hex")
		})).toThrow());
		it("Invalid data", () => expect(() => new Transaction({
			transaction_id: Buffer.alloc(16, 4), version: 1, contract_hash: Buffer.alloc(0), valid_till: 0,
			payload: "{}", signature: tx.getSignature(), public_key: Buffer.from("001234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", "hex")
		})).toThrow());
	});

	const tx2 = new Transaction(dbTx);
	describe("Created transaction from db", () => {
		it("Transaction address", () => expect(tx2.getAddress()).toBe(privateKey.getAddress()));
		it("Transaction public key", () => expect(tx2.getPublicKeyBuffer().equals(privateKey.publicKey)).toBe(true));
		it("Transaction id", () => expect(tx2.getId().toString("hex")).toBe("08080808080808080808080808080808"));
		it("Transaction signature length", () => expect(tx2.getSignature().length).toBe(64));
		it("Transaction contract hash", () => expect(tx2.getContractHash().toString("hex")).toBe("1010101010101010101010101010101010101010101010101010101010101010"));
		it("Transaction binary payload", () => expect(tx2.getPayloadBinary().toString()).toBe('{"keys":123}'));
		it("Transaction payload", () => expect(tx2.getPayloadJson()).toEqual({ keys: 123 }));
		it("Transaction payload length", () => expect(tx2.payloadLength).toBe(Buffer.from('{"keys":123}').length));
		it("Transaction total length", () => expect(tx2.totalLength).toBe(tx2.payloadLength + Transaction.emptyLength));
		it("Transaction total length", () => expect(tx2.totalLength).toBe(tx2.data.length - 4));
		it("Transaction valid till ", () => expect(tx2.validTill).toBe(0));
		it("Transaction version", () => expect(tx2.version).toBe(1));
		//Data consists of 4 bytes totalLength, 1 version, 16 transactionId, 32 contractHash, 8 validtill, ? payload, 64 signature, 33 publickey
		it("Transaction data", () => expect(tx2.data.equals(Buffer.concat([
			Crypto.uInt32ToBinary(tx2.totalLength), Crypto.uInt8ToBinary(tx2.version), tx2.getId(), tx2.getContractHash(),
			Crypto.uLongToBinary(tx2.validTill), tx2.getPayloadBinary(), tx2.getSignature(), tx2.getPublicKeyBuffer()
		]))).toBe(true));
		it("Transaction invalid", () => expect(tx2.verifySignature(Buffer.from("test"))).toBe(false));
		it("Transaction template v1", () => expect(tx2.verifyTemplate({ keys: { type: "uint" } }, 1)).toBe(undefined));
		it("Transaction template v2", () => expect(tx2.verifyTemplate({ keys: { type: "uint" } }, 2)).toBe(undefined));
		it("Transaction signature", () => expect(new Transaction({
			transaction_id: Buffer.alloc(16, 4), version: 1, contract_hash: Buffer.alloc(32, 8), valid_till: 123,
			payload: '{"key":"value"}', signature: tx.getSignature(), public_key: privateKey.publicKey
		}).verifySignature(Buffer.from("test"))).toBe(true));
	});

	describe("Create transaction from buffer", () => {
		it("Creating a valid transaction from a buffer transaction throws.", () => expect(() => new Transaction(tx.data)).not.toThrow());
		it("Invalid buffer transaction is valid.", () => expect(() => new Transaction(Buffer.alloc(Transaction.emptyLength, 0))).toThrow());
	});

	const tx3 = new Transaction(tx.data);
	describe("Created transaction from buffer", () => {
		it("Transaction address", () => expect(tx3.getAddress()).toBe(privateKey.getAddress()));
		it("Transaction public key", () => expect(tx3.getPublicKeyBuffer().equals(privateKey.publicKey)).toBe(true));
		it("Transaction id", () => expect(tx3.getId().toString("hex")).toBe("04040404040404040404040404040404"));
		it("Transaction signature length", () => expect(tx3.getSignature().length).toBe(64));
		it("Transaction contract hash", () => expect(tx3.getContractHash().toString("hex")).toBe("0808080808080808080808080808080808080808080808080808080808080808"));
		it("Transaction binary payload", () => expect(tx3.getPayloadBinary().toString()).toBe('{"key":"value"}'));
		it("Transaction payload", () => expect(tx3.getPayloadJson()).toEqual({ key: "value" }));
		it("Transaction payload length", () => expect(tx3.payloadLength).toBe(Buffer.from('{"key":"value"}').length));
		it("Transaction total length", () => expect(tx3.totalLength).toBe(tx3.payloadLength + Transaction.emptyLength));
		it("Transaction total length", () => expect(tx3.totalLength).toBe(tx3.data.length - 4));
		it("Transaction valid till ", () => expect(tx3.validTill).toBe(123));
		it("Transaction version", () => expect(tx3.version).toBe(1));
		it("Transaction data", () => expect(tx3.data.equals(tx.data)).toBe(true));
		it("Transaction template v1", () => expect(tx.verifyTemplate({ key: { type: "string" } }, 1)).toBe(undefined));
		it("Transaction template v2", () => expect(tx.verifyTemplate({ key: { type: "string" } }, 2)).toBe(undefined));
	});

	describe("(Un)merging", () => {
		it("Unmerge empty", () => expect(Transaction.unmerge(Buffer.alloc(0))).toEqual([]));
		it("Merge empty", () => expect(Transaction.merge([]).equals(Buffer.alloc(0))).toBe(true));
		it("Merge and unmerge empty", () => expect(Transaction.unmerge(Transaction.merge([]))).toEqual([]));
		it("Merge and unmerge single", () => expect(tx.data.equals(Transaction.unmerge(Transaction.merge([tx]))[0].data)).toEqual(true));
		const transactions = [tx, tx2, tx3];
		const mergedTransactions = Transaction.merge(transactions);
		const unmergedTransaction = Transaction.unmerge(mergedTransactions);
		it("Merge and unmerge multiple", () => expect(Transaction.unmerge(Transaction.merge(transactions)).length).toEqual(transactions.length));
		it("Data and order", () => expect(transactions[0].data.equals(unmergedTransaction[0].data)).toBe(true));
		it("Data and order", () => expect(transactions[1].data.equals(unmergedTransaction[1].data)).toBe(true));
		it("Data and order", () => expect(transactions[2].data.equals(unmergedTransaction[2].data)).toBe(true));
		it("Unmerging uncomplete", () => expect(() => Transaction.unmerge(Buffer.alloc(1))).toThrow());
		it("Unmerging too short", () => expect(() => Transaction.unmerge(Crypto.uInt32ToBinary(9999))).toThrow());
	});

	describe("Transaction template validation", () => {
		const transactionBase = { valid_till: 0, version: 1, signature: Buffer.alloc(64), transaction_id: Buffer.alloc(16), contract_hash: Buffer.alloc(32), public_key: PrivateKey.generate().publicKey };
		const template1 = {
			a: { type: "bool" }, b: { type: "int" }, c: { type: "uint" }, d: { type: "float" }, e: { type: "addr" },
			g: { type: "str" }, h: { type: "hex" }, i: { type: "base64" }, j: { type: "hash" }, l: { type: "ajw+!&^%!334f" }
		};
		const payload1a = JSON.stringify({ a: true, b: 0, c: 0, d: 0, e: "18unpv2yLe3Vsif2MSfY1v7sNXEiWKGbJw", g: "asdf", h: "123456", i: "asdf", j: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", l: "a28yf98hsdf" });
		const payload1b = JSON.stringify({ a: false, b: -10, c: 10, d: -9e99, e: "1PFyEGGsbf3yTF1kgYjxgGSwQa7jcBm5zj", g: "asdf", h: "abcdefABCDEF", i: "", j: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", l: "" });
		const payload1c = JSON.stringify({ a: true, b: 10, c: 0, d: 9e-99, e: "1PFyEGGsbf3yTF1kgYjxgGSwQa7jcBm5zj", g: "", h: "", i: "asdfas==", j: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", l: "as" });
		const template2 = {
			a: { type: "boolArray" }, b: { type: "intArray" }, c: { type: "uintArray" }, d: { type: "floatArray" }, e: { type: "addrArray" }, g: { type: "strArray" },
			h: { type: "hexArray" }, i: { type: "base64Array" }, j: { type: "hashArray" }, l: { type: "ajw+!&^%!334fArray" }, m: { type: "ajw+!&^%!334farray" }, n: { type: "strArrayArray" }
		};
		const payload2a = JSON.stringify({
			a: [true, false], b: [0, -10, 10, 10], c: [0], d: [0], e: [], g: ["asdf", ""],
			h: ["123456"], i: [], j: ["1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"], l: ["a28yf98hsdf"], m: "asdf", n: ["asdf"]
		});
		const payload2b = JSON.stringify({
			a: [false], b: [], c: [10, 0], d: [-9e99, 9e-99], e: ["18unpv2yLe3Vsif2MSfY1v7sNXEiWKGbJw", "1PFyEGGsbf3yTF1kgYjxgGSwQa7jcBm5zj"], g: ["asdf"],
			h: ["abcdefABCDEF", ""], i: ["", "asdfas=="], j: ["1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"], l: [], m: "asdf", n: ["asdf"]
		});
		const payload2c = JSON.stringify({
			a: [], b: [10], c: [], d: [], e: ["1PFyEGGsbf3yTF1kgYjxgGSwQa7jcBm5zj"], g: [],
			h: [], i: ["", "", "", "", "", "", "", "", ""], j: [], l: ["as", ""], m: "asdf", n: ["asdf"]
		});
		const template3 = {
			a: { type: "bool?" }, b: { type: "int?" }, c: { type: "uint?" }, d: { type: "float?" }, e: { type: "addr?" }, f: { type: "json?" },
			g: { type: "str?" }, h: { type: "hex?" }, i: { type: "base64?" }, j: { type: "hash?" }, k: { type: "id?" }, l: { type: "ajw+!&^%!33F4f?" }
		};
		const payload3a = JSON.stringify({ a: true, b: 0, c: 0, d: 0, e: "18unpv2yLe3Vsif2MSfY1v7sNXEiWKGbJw", f: {}, g: "asdf", h: "123456", i: "asdf", j: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", k: "1234567890abcdef1234567890abcdef", l: "a28yf98hsdf" });
		const payload3b = JSON.stringify({ a: true, c: 0, e: "18unpv2yLe3Vsif2MSfY1v7sNXEiWKGbJw", h: "123456", f: {}, j: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" });
		const payload3c = JSON.stringify({});

		//For all template where the version should produce the same
		for (const version of [1, 2] as ContractVersion[]) {
			it(`Invalid transaction payload1a for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: payload1a }, transactionBase)).verifyTemplate(template1, version)).toBe(undefined));
			it(`Invalid transaction payload1b for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: payload1b }, transactionBase)).verifyTemplate(template1, version)).toBe(undefined));
			it(`Invalid transaction payload1c for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: payload1c }, transactionBase)).verifyTemplate(template1, version)).toBe(undefined));
			it(`Invalid transaction payload2a for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: payload2a }, transactionBase)).verifyTemplate(template2, version)).toBe(undefined));
			it(`Invalid transaction payload2b for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: payload2b }, transactionBase)).verifyTemplate(template2, version)).toBe(undefined));
			it(`Invalid transaction payload2c for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: payload2c }, transactionBase)).verifyTemplate(template2, version)).toBe(undefined));
			it(`Invalid empty transaction for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: "{}" }, transactionBase)).verifyTemplate({}, version)).toBe(undefined));

			it(`Invalid transaction payload considered valid: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: "123" }, transactionBase)).verifyTemplate({}, version)).toBe("string"));
			it(`Invalid transaction payload considered valid: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: "null" }, transactionBase)).verifyTemplate({}, version)).toBe("string"));
			it(`Invalid transaction payload considered valid: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: "[]" }, transactionBase)).verifyTemplate({}, version)).toBe("string"));
			it(`Invalid transaction payload considered valid: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: "a09fja892" }, transactionBase)).verifyTemplate({}, version)).toBe("string"));
			it(`Invalid extra key transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: true, b: true }) }, transactionBase)).verifyTemplate({ a: { type: "bool" } }, version)).toBe("string"));
			it(`Invalid objectAsArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: {} }) }, transactionBase)).verifyTemplate({ a: { type: "boolArray" } }, version)).toBe("string"));
			it(`Invalid nullArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: null }) }, transactionBase)).verifyTemplate({ a: { type: "boolArray" } }, version)).toBe("string"));

			it(`Invalid bool transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: 1 }) }, transactionBase)).verifyTemplate({ a: { type: "bool" } }, version)).toBe("string"));
			it(`Invalid bool transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "true" }) }, transactionBase)).verifyTemplate({ a: { type: "bool" } }, version)).toBe("string"));
			it(`Invalid bool transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [] }) }, transactionBase)).verifyTemplate({ a: { type: "bool" } }, version)).toBe("string"));
			it(`Invalid int transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "1" }) }, transactionBase)).verifyTemplate({ a: { type: "int" } }, version)).toBe("string"));
			it(`Invalid int transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: 1.2 }) }, transactionBase)).verifyTemplate({ a: { type: "int" } }, version)).toBe("string"));
			it(`Invalid int transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: Infinity }) }, transactionBase)).verifyTemplate({ a: { type: "int" } }, version)).toBe("string"));
			it(`Invalid int transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: NaN }) }, transactionBase)).verifyTemplate({ a: { type: "int" } }, version)).toBe("string"));
			it(`Invalid uint transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: -1 }) }, transactionBase)).verifyTemplate({ a: { type: "uint" } }, version)).toBe("string"));
			it(`Invalid uint transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: 1.2 }) }, transactionBase)).verifyTemplate({ a: { type: "uint" } }, version)).toBe("string"));
			it(`Invalid uint transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "1" }) }, transactionBase)).verifyTemplate({ a: { type: "uint" } }, version)).toBe("string"));
			it(`Invalid uint transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: Infinity }) }, transactionBase)).verifyTemplate({ a: { type: "uint" } }, version)).toBe("string"));
			it(`Invalid float transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: NaN }) }, transactionBase)).verifyTemplate({ a: { type: "uint" } }, version)).toBe("string"));
			it(`Invalid float transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "1" }) }, transactionBase)).verifyTemplate({ a: { type: "float" } }, version)).toBe("string"));
			it(`Invalid float transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: Infinity }) }, transactionBase)).verifyTemplate({ a: { type: "float" } }, version)).toBe("string"));
			it(`Invalid float transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: NaN }) }, transactionBase)).verifyTemplate({ a: { type: "float" } }, version)).toBe("string"));
			it(`Invalid addr transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "" }) }, transactionBase)).verifyTemplate({ a: { type: "addr" } }, version)).toBe("string"));
			it(`Invalid addr transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "1PFyEGGsbf3yTF1kgYjxgGSwQa7jcBm5za" }) }, transactionBase)).verifyTemplate({ a: { type: "addr" } }, version)).toBe("string"));
			it(`Invalid str transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: 1 }) }, transactionBase)).verifyTemplate({ a: { type: "str" } }, version)).toBe("string"));
			it(`Invalid str transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [] }) }, transactionBase)).verifyTemplate({ a: { type: "str" } }, version)).toBe("string"));
			it(`Invalid hex transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "a" }) }, transactionBase)).verifyTemplate({ a: { type: "hex" } }, version)).toBe("string"));
			it(`Invalid hex transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "agrt" }) }, transactionBase)).verifyTemplate({ a: { type: "hex" } }, version)).toBe("string"));
			it(`Invalid hex transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: Buffer.alloc(0) }) }, transactionBase)).verifyTemplate({ a: { type: "hex" } }, version)).toBe("string"));
			it(`Invalid base64 transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "as" }) }, transactionBase)).verifyTemplate({ a: { type: "base64" } }, version)).toBe("string"));
			it(`Invalid base64 transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: Buffer.alloc(0) }) }, transactionBase)).verifyTemplate({ a: { type: "base64" } }, version)).toBe("string"));
			it(`Invalid hash transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "" }) }, transactionBase)).verifyTemplate({ a: { type: "hash" } }, version)).toBe("string"));
			it(`Invalid hash transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "1234567890" }) }, transactionBase)).verifyTemplate({ a: { type: "hash" } }, version)).toBe("string"));

			it(`Invalid boolArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [1] }) }, transactionBase)).verifyTemplate({ a: { type: "boolArray" } }, version)).toBe("string"));
			it(`Invalid boolArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: ["true"] }) }, transactionBase)).verifyTemplate({ a: { type: "boolArray" } }, version)).toBe("string"));
			it(`Invalid boolArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [[]] }) }, transactionBase)).verifyTemplate({ a: { type: "boolArray" } }, version)).toBe("string"));
			it(`Invalid intArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: ["1"] }) }, transactionBase)).verifyTemplate({ a: { type: "intArray" } }, version)).toBe("string"));
			it(`Invalid intArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [1.2] }) }, transactionBase)).verifyTemplate({ a: { type: "intArray" } }, version)).toBe("string"));
			it(`Invalid intArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [Infinity] }) }, transactionBase)).verifyTemplate({ a: { type: "intArray" } }, version)).toBe("string"));
			it(`Invalid intArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [NaN] }) }, transactionBase)).verifyTemplate({ a: { type: "intArray" } }, version)).toBe("string"));
			it(`Invalid uintArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [-1] }) }, transactionBase)).verifyTemplate({ a: { type: "uintArray" } }, version)).toBe("string"));
			it(`Invalid uintArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [1.2] }) }, transactionBase)).verifyTemplate({ a: { type: "uintArray" } }, version)).toBe("string"));
			it(`Invalid uintArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: ["1"] }) }, transactionBase)).verifyTemplate({ a: { type: "uintArray" } }, version)).toBe("string"));
			it(`Invalid uintArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [Infinity] }) }, transactionBase)).verifyTemplate({ a: { type: "uintArray" } }, version)).toBe("string"));
			it(`Invalid uintArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [NaN] }) }, transactionBase)).verifyTemplate({ a: { type: "uintArray" } }, version)).toBe("string"));
			it(`Invalid transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: ["1"] }) }, transactionBase)).verifyTemplate({ a: { type: "floatArray" } }, version)).toBe("string"));
			it(`Invalid floatArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [Infinity] }) }, transactionBase)).verifyTemplate({ a: { type: "floatArray" } }, version)).toBe("string"));
			it(`Invalid floatArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [NaN] }) }, transactionBase)).verifyTemplate({ a: { type: "floatArray" } }, version)).toBe("string"));
			it(`Invalid addrArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [""] }) }, transactionBase)).verifyTemplate({ a: { type: "addrArray" } }, version)).toBe("string"));
			it(`Invalid addrArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: ["1PFyEGGsbf3yTF1kgYjxgGSwQa7jcBm5za"] }) }, transactionBase)).verifyTemplate({ a: { type: "addrArray" } }, version)).toBe("string"));
			it(`Invalid strArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [1] }) }, transactionBase)).verifyTemplate({ a: { type: "strArray" } }, version)).toBe("string"));
			it(`Invalid strArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [[]] }) }, transactionBase)).verifyTemplate({ a: { type: "strArray" } }, version)).toBe("string"));
			it(`Invalid hexArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: ["a"] }) }, transactionBase)).verifyTemplate({ a: { type: "hexArray" } }, version)).toBe("string"));
			it(`Invalid hexArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: ["agrt"] }) }, transactionBase)).verifyTemplate({ a: { type: "hexArray" } }, version)).toBe("string"));
			it(`Invalid hexArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [Buffer.alloc(0)] }) }, transactionBase)).verifyTemplate({ a: { type: "hexArray" } }, version)).toBe("string"));
			it(`Invalid base64Array transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: ["as"] }) }, transactionBase)).verifyTemplate({ a: { type: "base64Array" } }, version)).toBe("string"));
			it(`Invalid base64Array transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [Buffer.alloc(0)] }) }, transactionBase)).verifyTemplate({ a: { type: "base64Array" } }, version)).toBe("string"));
			it(`Invalid hashArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [""] }) }, transactionBase)).verifyTemplate({ a: { type: "hashArray" } }, version)).toBe("string"));
			it(`Invalid hashArray transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: ["1234567890"] }) }, transactionBase)).verifyTemplate({ a: { type: "hashArray" } }, version)).toBe("string"));

			it(`Invalid Array transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: true }) }, transactionBase)).verifyTemplate({ a: { type: "boolArray" } }, version)).toBe("string"));
			it(`Invalid Array transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: 2 }) }, transactionBase)).verifyTemplate({ a: { type: "intArray" } }, version)).toBe("string"));
			it(`Invalid Array transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: 2 }) }, transactionBase)).verifyTemplate({ a: { type: "uintArray" } }, version)).toBe("string"));
			it(`Invalid Array transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: 2 }) }, transactionBase)).verifyTemplate({ a: { type: "floatArray" } }, version)).toBe("string"));
			it(`Invalid Array transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "1PFyEGGsbf3yTF1kgYjxgGSwQa7jcBm5zj" }) }, transactionBase)).verifyTemplate({ a: { type: "addrArray" } }, version)).toBe("string"));
			it(`Invalid Array transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "1234567890" }) }, transactionBase)).verifyTemplate({ a: { type: "strArray" } }, version)).toBe("string"));
			it(`Invalid Array transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "1234567890" }) }, transactionBase)).verifyTemplate({ a: { type: "hexArray" } }, version)).toBe("string"));
			it(`Invalid Array transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "1234567890" }) }, transactionBase)).verifyTemplate({ a: { type: "base64Array" } }, version)).toBe("string"));
			it(`Invalid Array transaction considered valid for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" }) }, transactionBase)).verifyTemplate({ a: { type: "hashArray" } }, version)).toBe("string"));

			//Templates that behave differently on older versions
			if (version === 1) {
				it(`Invalid json transaction for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: JSON.stringify({ a: '{ "a": 123, "b": [], "c":9e99999 }' }) }, transactionBase)).verifyTemplate({ a: { type: "json" } }, version)).toBe(undefined));
				it(`Invalid id transaction for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: JSON.stringify({ a: "asdf" }) }, transactionBase)).verifyTemplate({ a: { type: "id" } }, version)).toBe(undefined));
				it(`Invalid jsonArray transaction for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: JSON.stringify({ a: ['{ "a": 123, "b": [], "c":9e99999 }', "{}"] }) }, transactionBase)).verifyTemplate({ a: { type: "jsonArray" } }, version)).toBe(undefined));
				it(`Invalid idArray transaction for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: JSON.stringify({ a: ["asdf", "wer"] }) }, transactionBase)).verifyTemplate({ a: { type: "idArray" } }, version)).toBe(undefined));
				it(`Invalid json transaction for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: { a: 123, b: [], c: 9e99999 } }) }, transactionBase)).verifyTemplate({ a: { type: "json" } }, version)).toBe("string"));
				it(`Invalid jsonArray transaction for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: [{ a: 123, b: [], c: 9e99999 }, {}] }) }, transactionBase)).verifyTemplate({ a: { type: "jsonArray" } }, version)).toBe("string"));
				it(`Invalid json transaction for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: '{ assda "b": [], "c":9e99999 }' }) }, transactionBase)).verifyTemplate({ a: { type: "json" } }, version)).toBe("string"));
				it(`Invalid jsonArray transaction for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: ['{asdfasd "b": [], "c":9e99999 }', "{}"] }) }, transactionBase)).verifyTemplate({ a: { type: "jsonArray" } }, version)).toBe("string"));
			} else {
				it(`Invalid json transaction for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: '{ "a": { "a": { "a": 123, "b": [], "c": 9e99999 } } }' }, transactionBase)).verifyTemplate({ a: { type: "json" } }, version)).toBe(undefined));
				it(`Invalid id transaction for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: JSON.stringify({ a: "1234567890abcdef1234567890abcdef" }) }, transactionBase)).verifyTemplate({ a: { type: "id" } }, version)).toBe(undefined));
				it(`Invalid jsonArray transaction for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: '{ "a": [{ "a": { "a": 123, "b": [], "c": 9e99999 } }, {}] }' }, transactionBase)).verifyTemplate({ a: { type: "jsonArray" } }, version)).toBe(undefined));
				it(`Invalid idArray transaction for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: JSON.stringify({ a: ["1234567890abcdef1234567890abcdef", "1234567890abcdef1234567890abcdef"] }) }, transactionBase)).verifyTemplate({ a: { type: "idArray" } }, version)).toBe(undefined));
				it(`Invalid id transaction for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "asdf" }) }, transactionBase)).verifyTemplate({ a: { type: "id" } }, version)).toBe("string"));
				it(`Invalid idArray transaction for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: ["asdf", "wer"] }) }, transactionBase)).verifyTemplate({ a: { type: "idArray" } }, version)).toBe("string"));

				it(`Invalid transaction payload3a for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: payload3a }, transactionBase)).verifyTemplate(template3, version)).toBe(undefined));
				it(`Invalid transaction payload3b for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: payload3b }, transactionBase)).verifyTemplate(template3, version)).toBe(undefined));
				it(`Invalid transaction payload3c for version: ${version}`, () => expect(new Transaction(Object.assign({ payload: payload3c }, transactionBase)).verifyTemplate(template3, version)).toBe(undefined));
				it(`Invalid transaction payload3 for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ q: "asdf" }) }, transactionBase)).verifyTemplate(template3, version)).toBe("string"));
				it(`Invalid transaction payload3 for version: ${version}`, () => expect(typeof new Transaction(Object.assign({ payload: JSON.stringify({ a: "asdf" }) }, transactionBase)).verifyTemplate(template3, version)).toBe("string"));
			}
		}
	});
});