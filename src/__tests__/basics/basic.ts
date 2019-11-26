import { Basic, ProcessTxResult, DatabaseClient, CreatePayload, TxStatus, Contract } from "../../basics/basic";
import { DBTransaction, Transaction } from "../../basics/transaction";
import { Crypto } from "../../tools/crypto";
import { QueryResult, Client, types } from "pg";
import { PrivateKey } from "../../basics/key";
import { Log } from "../../tools/log";
import { readFileSync } from "fs";

//Only do integration tests if set
if (process.env.integration === "true" || process.env.INTEGRATION === "true") {
	//Settings used for setting up a test database
	types.setTypeParser(20, (val: string) => Number.parseInt(val, 10));
	types.setTypeParser(1016, (val: string) => val.length === 2 ? [] : val.slice(1, -1).split(",").map((v) => Number.parseInt(v, 10)));
	const testdbName = "validana_automatictest_core";
	const testUser = "validana_automatictest";
	const testPassword = "validana_automatictest";
	const postgresPassword = "postgres";

	//Helper class for executing tests
	class BasicTest extends Basic {
		constructor(dbClient?: DatabaseClient, prefix?: Buffer) {
			super(dbClient !== undefined ? dbClient : {
				user: testUser,
				database: testdbName,
				password: testPassword,
				port: 5432,
				host: "localhost"
			}, prefix);
		}

		public connect(): Promise<boolean> {
			return super.connect();
		}

		public loadSmartContracts(): Promise<void> {
			return super.loadSmartContracts();
		}

		public query(query: string, params: any[], name?: string): Promise<QueryResult> {
			return super.query(query, params, name);
		}

		public processTx(unvalidatedTx: DBTransaction | Buffer | Transaction, currentBlockId: number = 10,
			currentBlockTs: number = 12345678, processorAddress: string = "1FKhYFQ5jaG2DabjDYLCoY1eviWWNkBN8M",
			previousBlockTs: number = 12340678, previousBlockHash: Buffer = Buffer.alloc(32),
			verifySignature: boolean = false): Promise<ProcessTxResult> {
			return super.processTx(unvalidatedTx, currentBlockId, currentBlockTs, processorAddress, previousBlockTs, previousBlockHash, verifySignature);
		}

		public getContractMap(): Map<string, Contract> {
			return this.contractMap;
		}
	}

	// tslint:disable: no-null-keyword
	describe("Basic", () => {
		const basic = new BasicTest(undefined, Buffer.from("bla"));

		//Defaults for tests
		const payload: CreatePayload = {
			type: "bla",
			version: "1.0",
			description: "Does nothing",
			template: {},
			init: "",
			code: Buffer.from("//").toString("base64"),
			validanaVersion: 2
		};
		const tx = {
			version: 1,
			transaction_id: Transaction.generateId(),
			contract_hash: Buffer.alloc(32),
			valid_till: 0,
			payload: JSON.stringify(payload),
			signature: Buffer.alloc(64),
			public_key: Buffer.from("038c97eff5b4b4c719d3259cc7f9a9045af8ce0ed359a7343874fcd26527c4f817", "hex")
		};

		beforeAll(async (done) => {
			try {
				//We do not want to spam console in tests later, but these will be frozen afer sandboxing.
				// tslint:disable: no-console
				console.debug = () => { };
				console.log = () => { };
				console.info = () => { };
				console.warn = () => { };
				console.error = () => { };

				//Make sure it does not try to report errors all the time
				Log.setReportErrors(undefined);

				//Needed for the test, but not available in the sandbox.
				//@ts-ignore
				Sandbox.processStandin.stdout = process.stdout;
				//@ts-ignore
				Sandbox.processStandin.listeners = process.listeners;
			} catch (error) {
				//Already set in the Sandbox test suite
			}

			try {
				//(Re)create the database
				let setupClient = new Client({ user: "postgres", password: postgresPassword, database: "postgres", port: 5432, host: "localhost" });
				await setupClient.connect();
				if ((await setupClient.query(`SELECT 1 FROM pg_database WHERE datname = '${testdbName}'`)).rows.length === 0) {
					await setupClient.query(`CREATE DATABASE ${testdbName} WITH ENCODING = 'UTF8';`);
				}
				await setupClient.end();
				//Setup the test database
				setupClient = new Client({ user: "postgres", password: postgresPassword, database: testdbName, port: 5432, host: "localhost" });
				await setupClient.connect();
				let setupScript = readFileSync("SetupDB.sql").toString();
				setupScript = setupScript.replace(/(\/\/).*|(\/\*[^]*?\*\/)/g, "");
				await setupClient.query(setupScript);
				//Setup the test user
				const setupUserScript =
					`DO $$ BEGIN ` +
					`	IF NOT EXISTS (SELECT * FROM pg_catalog.pg_user WHERE usename = '${testUser}') THEN ` +
					`		CREATE ROLE ${testUser} WITH LOGIN PASSWORD '${testPassword}'; ` +
					`	END IF; ` +
					`	GRANT smartcontract TO ${testUser}; ` +
					`	GRANT smartcontractmanager TO ${testUser}; ` +
					`	GRANT CONNECT ON DATABASE ${testdbName} TO ${testUser}; ` +
					`	ALTER ROLE ${testUser} CONNECTION LIMIT -1; ` +
					`END $$;` +
					`DELETE FROM basics.contracts;`;
				await setupClient.query(setupUserScript);
				const rows = (await setupClient.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';", [])).rows;
				for (const row of rows) {
					await setupClient.query(`DROP TABLE IF EXISTS ${row.table_name} CASCADE;`, []);
				}
				await setupClient.end();
			} catch (error) {
				//In case database is created manually (for security reasons) do not fail here.
			}

			await basic.connect();
			done();
		});
		//Make sure tests do not affect each other
		beforeEach(async (done) => {
			await basic.query("BEGIN; SET LOCAL ROLE smartcontract;", []);
			done();
		});
		afterEach(async (done) => {
			await basic.query("ROLLBACK;", []);
			await basic.loadSmartContracts();
			done();
		});

		it("Connect twice", () => expectAsync(basic.connect()).toBeResolved());

		describe("Invalid general transactions", () => {
			it("version", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					version: 0
				})))).toEqual({ status: TxStatus.Invalid, message: "Unsupported version." });
				done();
			});
			it("expired", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					valid_till: 1
				})))).toEqual({ status: TxStatus.Invalid, message: "Transaction valid till expired." });
				done();
			});
			it("payload array", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify([])
				})))).toEqual({ status: TxStatus.Invalid, message: "Payload is invalid json." });
				done();
			});
			it("too many keys", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify({ extrakey: "" })
				})))).toEqual({ status: TxStatus.Invalid, message: "Payload has extra key." });
				done();
			});
			it("signature", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
				}), undefined, undefined, undefined, undefined, undefined, true)))
					.toEqual({ status: TxStatus.Invalid, message: "Invalid signature." });
				done();
			});
			it("no sign prefix", async (done) => {
				expect((await new BasicTest().processTx(Object.assign({}, tx, {
				}), undefined, undefined, undefined, undefined, undefined, true)))
					.toEqual({ status: "retry", message: "" });
				done();
			});
			it("payload null", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(null)
				})))).toEqual({ status: TxStatus.Invalid, message: "Payload is invalid json." });
				done();
			});
		});
		describe("Invalid create contract transactions", () => {
			it("not processor", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					public_key: Buffer.from("0311df99130e18affa7d1c3b2bebf1750edc7a960c93ef772e2201b790879654ca", "hex")
				})))).toEqual({ status: TxStatus.Invalid, message: "User is not allowed to create a contract." });
				done();
			});
			it("type too long", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						type: "a".repeat(65)
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Trying to create an invalid contract: type too long" });
				done();
			});
			it("version too long", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						version: "a".repeat(33)
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Trying to create an invalid contract: version too long" });
				done();
			});
			it("description too long", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						description: "a".repeat(257)
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Trying to create an invalid contract: description too long" });
				done();
			});
			it("validana version", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						validanaVersion: 0
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Unsupported contract version" });
				done();
			});
			it("validana version", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						validanaVersion: 3
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Unsupported contract version" });
				done();
			});
			it("null template", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						template: null
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Trying to create an invalid contract: template is not an object." });
				done();
			});
			it("array template", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						template: []
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Trying to create an invalid contract: template is not an object." });
				done();
			});
			it("template too long key", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						template: { aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: { type: "string", desc: "asdf", name: "asdf" } }
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Trying to create an invalid contract: template has invalid values: " + "a".repeat(65) });
				done();
			});
			it("template too long type", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						template: { asdf: { type: "a".repeat(65), desc: "asdf", name: "asdf" } }
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Trying to create an invalid contract: template has invalid values: asdf" });
				done();
			});
			it("template too long desc", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						template: { asdf: { type: "a", desc: "a".repeat(257), name: "asdf" } }
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Trying to create an invalid contract: template has invalid values: asdf" });
				done();
			});
			it("template too long name", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						template: { asdf: { type: "a", desc: "a", name: "a".repeat(65) } }
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Trying to create an invalid contract: template has invalid values: asdf" });
				done();
			});
			it("template misspelled something", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						template: { asdf: { type: "a", desc: "a", naem: "strasdf" } }
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Trying to create an invalid contract: template has invalid values: asdf" });
				done();
			});
			it("no code and init", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: ""
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Trying to create an invalid contract: init and/or code has to be defined" });
				done();
			});
			it("syntax error code", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(")(").toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("try catch code", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from("try { const a=1; } catch (e) {};").toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("no await code", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from("query('SELECT 1;', []);").toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("syntax error init", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(")(").toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("throw exception init", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from("Buffer.from(0)").toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("try catch init", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from("try { const a=1; } catch (e) {};").toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("no await init", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from("query('SELECT 1;', []);").toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("already exists", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from("//already exists test").toString("base64")
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from("//already exists test").toString("base64")
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Trying to create an invalid contract: contract already exists" });
				done();
			});
		});

		describe("Valid create contract", () => {
			it("json template", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						template: {}
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("string template", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						template: "{}"
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("validana version undefined", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						validanaVersion: undefined
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("validana version 1", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						validanaVersion: 1
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("validana version 2", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						validanaVersion: 2
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("template long key", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						template: { aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: { type: "string", desc: "asdf", name: "asdf" } }
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("template long type", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						template: { asdf: { type: "a".repeat(64), desc: "asdf", name: "asdf" } }
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("template long desc", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						template: { asdf: { type: "a", desc: "a".repeat(256), name: "asdf" } }
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("template long name", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						template: { asdf: { type: "a", desc: "a", name: "a".repeat(64) } }
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("empty code, but has init", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: "",
						init: Buffer.from("//").toString("base64")
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("init and code", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from("//").toString("base64")
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("Signed transaction", async (done) => {
				expect((await basic.processTx(Transaction.sign(
					Object.assign({}, tx), Buffer.from("bla"), PrivateKey.fromWIF("KxLJSyM1111111111111111111111111111111111111119cskYz")
				), undefined, undefined, undefined, undefined, undefined, true)).status).toBe("accepted");
				done();
			});
			it("Buffer transaction", async (done) => {
				expect((await basic.processTx(Transaction.sign(
					Object.assign({}, tx), Buffer.from("bla"), PrivateKey.fromWIF("KxLJSyM1111111111111111111111111111111111111119cskYz")
				).data, undefined, undefined, undefined, undefined, undefined, true)).status).toBe("accepted");
				done();
			});
		});

		describe("Call contract", () => {
			it("string return v1", async (done) => {
				const contractCode = "return 'adsf';";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(contractCode).toString("base64"),
						validanaVersion: 1
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Crypto.hash256(contractCode),
					payload: JSON.stringify({})
				})))).toEqual({ status: "v1Rejected", message: "adsf" });
				done();
			});
			it("string return v2", async (done) => {
				const contractCode = "return 'adsf';";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(contractCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Crypto.hash256('"use strict";' + contractCode),
					payload: JSON.stringify({})
				})))).toEqual({ status: TxStatus.Accepted, message: "adsf" });
				done();
			});
			it("non-string return v1", async (done) => {
				const contractCode = "return 123;";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(contractCode).toString("base64"),
						validanaVersion: 1
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Crypto.hash256(contractCode),
					payload: JSON.stringify({})
				})))).toEqual({ status: "v1Rejected", message: "Unknown result type" });
				done();
			});
			it("non-string return v2", async (done) => {
				const contractCode = "return 123;";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(contractCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Crypto.hash256('"use strict";' + contractCode),
					payload: JSON.stringify({})
				})))).toEqual({ status: TxStatus.Accepted, message: "Unknown result type" });
				done();
			});
			it("ok return v1", async (done) => {
				const contractCode = "return 'OK';";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(contractCode).toString("base64"),
						validanaVersion: 1
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Crypto.hash256(contractCode),
					payload: JSON.stringify({})
				})))).toEqual({ status: TxStatus.Accepted, message: "OK" });
				done();
			});
			it("ok return v2", async (done) => {
				const contractCode = "return 'OK';";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(contractCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Crypto.hash256('"use strict";' + contractCode),
					payload: JSON.stringify({})
				})))).toEqual({ status: TxStatus.Accepted, message: "OK" });
				done();
			});
			it("reject string", async (done) => {
				const contractCode = "reject(123);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(contractCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Crypto.hash256('"use strict";' + contractCode),
					payload: JSON.stringify({})
				})))).toEqual({ status: TxStatus.Rejected, message: "Unknown reject reason" });
				done();
			});
			it("reject string", async (done) => {
				const contractCode = "reject('asdf');";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(contractCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Crypto.hash256('"use strict";' + contractCode),
					payload: JSON.stringify({})
				})))).toEqual({ status: TxStatus.Rejected, message: "asdf" });
				done();
			});
			it("throw error", async (done) => {
				const contractCode = "throw new Error('asdf');";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(contractCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Crypto.hash256('"use strict";' + contractCode),
					payload: JSON.stringify({})
				})))).toEqual({ status: TxStatus.Invalid, message: "Error during contract execution" });
				done();
			});
			it("throw non-error", async (done) => {
				const contractCode = "throw 123;";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(contractCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Crypto.hash256('"use strict";' + contractCode),
					payload: JSON.stringify({})
				})))).toEqual({ status: TxStatus.Invalid, message: "Error during contract execution" });
				done();
			});
			it("throw null", async (done) => {
				const contractCode = "throw null;";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(contractCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Crypto.hash256('"use strict";' + contractCode),
					payload: JSON.stringify({})
				})))).toEqual({ status: TxStatus.Invalid, message: "Error during contract execution" });
				done();
			});
			it("reject twice", async (done) => {
				const contractCode = "reject('1'); reject('2');";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(contractCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Crypto.hash256('"use strict";' + contractCode),
					payload: JSON.stringify({})
				})))).toEqual({ status: TxStatus.Rejected, message: "1" });
				done();
			});
			it("contract does not exist", async (done) => {
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Buffer.alloc(32, 1)
				})))).toEqual({ status: TxStatus.Rejected, message: "Contract does not exist." });
				done();
			});
			it("full", async (done) => {
				const initCode = "await query('CREATE TABLE test (addr VARCHAR(35) PRIMARY KEY, called BIGINT NOT NULL);', []);";
				const contractCode = "const called = (await query('SELECT called FROM test WHERE addr = $1;', [from])).rows[0];" +
					"const result = called === undefined ? 0 : called.called;" +
					"await query('INSERT INTO test (addr, called) VALUES ($1, $2) ON CONFLICT ON CONSTRAINT test_pkey DO UPDATE SET called = $2;', [from, result+payload.amount]);" +
					"return String(result);";
				const contractHash = Crypto.hash256('"use strict";' + contractCode);
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						template: { amount: { type: "uint", name: "amount", desc: "The amount to increase it with." } },
						init: Buffer.from(initCode).toString("base64"),
						code: Buffer.from(contractCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: contractHash,
					payload: JSON.stringify({ amount: 3 })
				})))).toEqual({ status: TxStatus.Accepted, message: "0" });
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: contractHash,
					payload: JSON.stringify({ amount: 2 })
				})))).toEqual({ status: TxStatus.Accepted, message: "3" });
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: contractHash,
					payload: JSON.stringify({ amount: 0 })
				})))).toEqual({ status: TxStatus.Accepted, message: "5" });
				done();
			});
			it("special values test", async (done) => {
				const initCode = "if (from !== processor || block !== 10 || currentBlockTimestamp !== 12345678 || " +
					"previousBlockTimestamp !== 12340678 || transactionId.length !== 32 || previousBlockHash !== Buffer.alloc(32).toString('hex')) " +
					"throw new Error();";
				const contractCode = "if (typeof payload !== 'object' || from !== processor || block !== 10 || currentBlockTimestamp !== 12345678 || " +
					"previousBlockTimestamp !== 12340678 || transactionId.length !== 32 || previousBlockHash !== Buffer.alloc(32).toString('hex')) " +
					"throw new Error();";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64"),
						code: Buffer.from(contractCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Crypto.hash256('"use strict";' + contractCode),
					payload: JSON.stringify({})
				}))).status).toBe("accepted");
				done();
			});
		});

		describe("Delete contract", () => {
			it("succesful", async (done) => {
				const contractCode = "return 'asdf';";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(contractCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Buffer.alloc(32, 255),
					payload: JSON.stringify({ hash: Crypto.hash256('"use strict";' + contractCode).toString("hex") })
				}))).status).toBe("accepted");
				done();
			});
			it("non existing", async (done) => {
				const hash = Crypto.hash256('"use strict"; return "asdf";').toString("hex");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Buffer.alloc(32, 255),
					payload: JSON.stringify({ hash })
				})))).toEqual({ status: TxStatus.Invalid, message: `Not creator of contract or contract: ${hash} does not exist.` });
				done();
			});
			it("wrong user", async (done) => {
				const contractCode = "return 'asdf';";
				const hash = Crypto.hash256('"use strict";' + contractCode).toString("hex");
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						code: Buffer.from(contractCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				expect((await basic.processTx(Object.assign({}, tx, {
					contract_hash: Buffer.alloc(32, 255),
					payload: JSON.stringify({ hash: Crypto.hash256('"use strict";' + contractCode).toString("hex") }),
					public_key: Buffer.from("0311df99130e18affa7d1c3b2bebf1750edc7a960c93ef772e2201b790879654ca", "hex")
				})))).toEqual({ status: TxStatus.Invalid, message: `Not creator of contract or contract: ${hash} does not exist.` });
				done();
			});
		});

		describe("querySC new format", () => {
			it("succesful", async (done) => {
				const initCode = "await query('CREATE TABLE test (bla BIGINT);', []);" +
					"await query('INSERT INTO test (bla) VALUES ($1);', [123456]);" +
					"if ((await query('SELECT bla FROM test;', [])).rows[0].bla !== 123456) reject('not the same');";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("forgotten ;", async (done) => {
				const initCode = "await query('SELECT 1', []);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("whitespace", async (done) => {
				const initCode = "await query('   SELECT 1;   ', []);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("mixed case", async (done) => {
				const initCode = "await query('SeLeCt 1;', []);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("security", async (done) => {
				const initCode = "await query('SELECT 1; SELECT 2;', []);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("security", async (done) => {
				const initCode = "await query('CREATE TABLE test (bla BIGINT);', []);" +
					"const attack = `' OR true; DROP TABLE test; --`" +
					"await query('SELECT * FROM test WHERE bla = ${attack}', []);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("determinism", async (done) => {
				const initCode = "await query('SELECT localtime;', []);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("determinism", async (done) => {
				const initCode = "await query('SELECT current_date;', []);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("determinism", async (done) => {
				const initCode = "await query('SELECT current_time;', []);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("non-allowed query", async (done) => {
				const initCode = "await query('CREATE SEQUENCE bla;', []);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("queryFast", async (done) => {
				const initCode = "queryFast('CREATE TABLE test5 (bla BIGINT);', []);" +
					"queryFast('INSERT INTO test5 (bla) VALUES ($1);', [123456]);" +
					"if ((await query('SELECT bla FROM test5;', [])).rows[0].bla !== 123456) reject('not the same');";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				done();
			});
		});

		describe("querySC old format", () => {
			it("succesful", async (done) => {
				const initCode = "await query('CREATE', 'test2','(bla BIGINT);', []);" +
					"await query('INSERT','test2','(bla) VALUES ($1);', [123456]);" +
					"await query('UPDATE', 'test2', 'SET bla = $2 WHERE bla = $1;', [123456, 123457]);" +
					"if ((await query('SELECT', 'test2', ';', [])).rows[0].bla !== 123457) reject('not the same');" +
					"await query('ALTER', 'test2', 'RENAME bla TO bla2;', []);" +
					"if ((await query('SELECT', 'test2', ';', [])).rows[0].bla2 !== 123457) reject('not altered');" +
					"await query('DELETE', 'test2', 'WHERE bla2 = $1;', [123457]);" +
					"if ((await query('SELECT', 'test2', ';', [])).rows.length !== 0) reject('not deleted');" +
					"await query('INDEX', 'test2', '(bla2);', ['ind']);" +
					"await query('UNIQUE INDEX', 'test2', '(bla2);', ['uniq_ind']);" +
					"await query('DROP INDEX', '', 'ind;', []);" +
					"await query('DROP INDEX', '', 'uniq_ind;', []);" +
					"await query('DROP', 'test2', ';', []);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("succesful private", async (done) => {
				const initCode = "await query('CREATE', 'test2','(bla BIGINT);', [], true);" +
					"await query('INSERT','test2','(bla) VALUES ($1);', [123456], true);" +
					"await query('UPDATE', 'test2', 'SET bla = $2 WHERE bla = $1;', [123456, 123457], true);" +
					"if ((await query('SELECT', 'test2', ';', [], true)).rows[0].bla !== 123457) reject('not the same');" +
					"await query('ALTER', 'test2', 'RENAME bla TO bla2;', [], true);" +
					"if ((await query('SELECT', 'test2', ';', [], true)).rows[0].bla2 !== 123457) reject('not altered');" +
					"await query('DELETE', 'test2', 'WHERE bla2 = $1;', [123457], true);" +
					"if ((await query('SELECT', 'test2', ';', [], true)).rows.length !== 0) reject('not deleted');" +
					"await query('INDEX', 'test2', '(bla2);', ['ind'], true);" +
					"await query('UNIQUE INDEX', 'test2', '(bla2);', ['uniq_ind'], true);" +
					"await query('DROP INDEX', '', 'ind;', [], true);" +
					"await query('DROP INDEX', '', 'uniq_ind;', [], true);" +
					"await query('DROP', 'test2', ';', [], true);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("accepted");
				done();
			});
			it("invalid action", async (done) => {
				const initCode = "await query('SEQUENCE', 'test2',';', [], true);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				})))).toEqual({ status: TxStatus.Invalid, message: "Invalid query: Invalid action" });
				done();
			});
			it("no params", async (done) => {
				const initCode = "await query('SELECT 1;');";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
		});

		describe("db errors", () => {
			it("user rights", async (done) => {
				const initCode = "await query('SELECT * FROM basics.transactions;', []);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("syntax", async (done) => {
				const initCode = "await query('SELECT * asdf asd flasd fa;', []);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("divide by zero", async (done) => {
				const initCode = "await query('SELECT 1/0;', []);";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
			it("group by", async (done) => {
				const initCode = "SELECT 1 GROUP BY bla;";
				expect((await basic.processTx(Object.assign({}, tx, {
					payload: JSON.stringify(Object.assign({}, payload, {
						init: Buffer.from(initCode).toString("base64")
					}))
				}))).status).toBe("invalid");
				done();
			});
		});

		it("Load contract", async (done) => {
			const contractCode = "return 'asdf';";
			const contractCode2 = "return 'asdf';";
			expect((await basic.processTx(Object.assign({}, tx, {
				payload: JSON.stringify(Object.assign({}, payload, {
					code: Buffer.from(contractCode).toString("base64")
				}))
			}))).status).toBe("accepted");
			expect((await basic.processTx(Object.assign({}, tx, {
				payload: JSON.stringify(Object.assign({}, payload, {
					type: "bla bla",
					version: "1.5",
					description: "Something",
					template: {},
					init: Buffer.from("return 'asdf';").toString("base64"),
					code: Buffer.from(contractCode2).toString("base64"),
					validanaVersion: 1
				}))
			}))).status).toBe("accepted");
			const mapCopy = new Map(basic.getContractMap());
			await basic.query("RESET ROLE;", []);
			await basic.loadSmartContracts();
			expect(mapCopy.toString()).toBe(basic.getContractMap().toString());
			done();
		});
	});
}