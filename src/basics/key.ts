/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import * as Encryption from "crypto";
import { Crypto } from "../tools/crypto";

/** A public key. We use and accept compressed keys only. */
export class PublicKey {
	//Der format for secp256k1 public key.
	private static readonly publicStart = Crypto.hexToBinary("3036301006072a8648ce3d020106052b8104000a032200");

	/** The public key and address in different formats. */
	public readonly publicKey: Buffer;
	private publicKeyPem: string | undefined;
	private address: string | undefined;

	/** Create a new public key from a buffer. Will throw an error if the buffer is not a valid public key. */
	constructor(publicKey: Buffer) {
		if (!PublicKey.isValidPublic(publicKey)) {
			throw new Error("Invalid public key format.");
		}
		this.publicKey = publicKey;
	}

	/** Check if a public key is valid or not. We accept only compressed public keys. */
	public static isValidPublic(publicKey: Buffer): boolean {
		if (!(publicKey instanceof Buffer) || publicKey.length !== 33 || (publicKey[0] !== 0x02 && publicKey[0] !== 0x03)) {
			return false;
		}
		return true;
	}

	/** Check if an address is valid or not. Only prefix 0 is accepted. */
	public static isValidAddress(address: string): boolean {
		if (typeof address !== "string") {
			return false;
		}
		try {
			const decodedAddress = Crypto.base58ToBinary(address);
			const checksum = decodedAddress.slice(-4);
			return decodedAddress[0] === 0x00 && Crypto.hash256(decodedAddress.slice(0, -4)).slice(0, 4).equals(checksum);
		} catch {
			return false;
		}
	}

	/** Get the address of this public key. We use the address of the compressed key with prefix 0. */
	public getAddress(): string {
		if (this.address === undefined) {
			const hashedAddress = Buffer.concat([Crypto.uInt8ToBinary(0x00), Crypto.hash160(this.publicKey)]);
			const checksum = Crypto.hash256(hashedAddress).slice(0, 4);
			this.address = Crypto.binaryToBase58(Buffer.concat([hashedAddress, checksum]));
		}
		return this.address;
	}

	/** Verify a message and its signature against a public key. Signature should exist of 32 bytes r followed by 32 bytes s. */
	public verify(data: Buffer, signature: Buffer): boolean {
		if (signature.length !== 64) {
			throw new Error("Invalid signature format.");
		}
		if (this.publicKeyPem === undefined) {
			this.publicKeyPem = "-----BEGIN PUBLIC KEY-----\n"
				+ Buffer.concat([PublicKey.publicStart, this.publicKey]).toString("base64")
				+ "\n-----END PUBLIC KEY-----";
		}
		let r;
		if (signature[0] >= 128) {
			//in case its >=128 prepend with 0 so its not negative
			r = Buffer.concat([Buffer.alloc(1, 0), signature.slice(0, 32)]);
		} else {
			//Remove starting 0s, unless that would make it negative
			let i = 0;
			while (signature[i] === 0 && signature[i + 1] <= 127 && i < 30) {
				i++;
			}
			r = signature.slice(i, 32);
		}
		let s;
		if (signature[32] >= 128) {
			//in case its >=128 prepend with 0 so its not negative
			s = Buffer.concat([Buffer.alloc(1, 0), signature.slice(32)]);
		} else {
			//Remove starting 0s, unless that would make it negative
			let i = 32;
			while (signature[i] === 0 && signature[i + 1] <= 127 && i < 62) {
				i++;
			}
			s = signature.slice(i);
		}
		//Der format for public key
		const derSignature = Buffer.concat([
			Buffer.from([0x30, r.length + s.length + 4, 0x02, r.length]),
			r,
			Buffer.from([0x02, s.length]),
			s
		]);

		return Encryption.createVerify("SHA256").update(Crypto.sha256(data)).verify(this.publicKeyPem, derSignature);
	}
}

/**
 * A private key.
 * Technical info: Only the secp256k1 curve is supported, We use compressed
 * wif prefix 0x80 (same as bitcoin) by default, but accept all others.
 */
export class PrivateKey extends PublicKey {
	//The curve we use
	private static readonly secp256k1 = Encryption.createECDH("secp256k1");

	//Der format for secp256k1 private key.
	private static readonly privateStart = Crypto.hexToBinary("302e0201010420");
	private static readonly privateEnd = Crypto.hexToBinary("a00706052b8104000a");
	/** The private key WITHOUT network or compression info. */
	public readonly privateKey: Buffer;
	//Private key in pem format as required by openssl
	private privateKeyPem: string | undefined;

	//Compressed is only used if public key is not given
	private constructor(privateKey: Buffer, publicKey?: Buffer) {
		if (publicKey === undefined) {
			PrivateKey.secp256k1.setPrivateKey(privateKey);
			//Typecast as types are incorrect
			publicKey = PrivateKey.secp256k1.getPublicKey(undefined as any, "compressed") as any as Buffer;
		}
		super(publicKey);
		this.privateKey = privateKey;
	}

	/** Generate a new random private key. An error will be thrown if no suitable random source is available. */
	public static generate(): PrivateKey {
		PrivateKey.secp256k1.generateKeys();
		let privateKey = PrivateKey.secp256k1.getPrivateKey();
		//Add leading zeros (openssl removes them, but for wif format they are required)
		if (privateKey.length < 32) {
			privateKey = Buffer.concat([Buffer.alloc(32 - privateKey.length, 0), privateKey]);
		}
		return new PrivateKey(privateKey, PrivateKey.secp256k1.getPublicKey(undefined as any, "compressed") as any);
	}

	/** Check if a WIF is valid or not. Only compressed wifs with prefix 0x80 are accepted. */
	public static isValidWIF(wif: string): boolean {
		if (typeof wif !== "string" || !Crypto.isBase58(wif)) {
			//Not a string or not base58
			return false;
		}
		const decodedWif = Crypto.base58ToBinary(wif);
		if (decodedWif.length !== 38 || decodedWif[0] !== 0x80 || decodedWif[33] !== 0x01) {
			//Invalid format, we only want compressed wifs with prefix 0x80.
			return false;
		}
		const checksum = decodedWif.slice(-4);
		if (!Crypto.hash256(decodedWif.slice(0, -4)).slice(0, 4).equals(checksum)) {
			//Checksum is invalid
			return false;
		}
		return true;
	}

	/**
	 * Get the wif of this private key.
	 * By default it will use the same format it was imported in.
	 * If it was generated by generate() this will be compressed with network prefix 0x80
	 */
	public toWIF(): string {
		const mainNetKey = Buffer.concat([Crypto.uInt8ToBinary(0x80), this.privateKey, Crypto.uInt8ToBinary(0x01)]);
		const checkSum = Crypto.hash256(mainNetKey).slice(0, 4);
		return Crypto.binaryToBase58(Buffer.concat([mainNetKey, checkSum]));
	}

	/** Turn a WIF into a private key. Throws an error if wif is not a valid private key. */
	public static fromWIF(wif: string): PrivateKey {
		if (!PrivateKey.isValidWIF(wif)) {
			throw new Error("Invalid wif");
		}

		return new PrivateKey(Crypto.base58ToBinary(wif).slice(1, 33));
	}

	/** Sign data with this private key. Returns the signature as 32 bytes r followed by 32 bytes s. */
	public sign(data: Buffer): Buffer {
		//We use open ssl for signing, which requires PEM formatted key.
		if (this.privateKeyPem === undefined) {
			this.privateKeyPem = "-----BEGIN EC PRIVATE KEY-----\n"
				+ Buffer.concat([PrivateKey.privateStart, this.privateKey, PrivateKey.privateEnd]).toString("base64")
				+ "\n-----END EC PRIVATE KEY-----";
		}
		//And open ssl returns a der formatted signature.
		const derSignature = Encryption.createSign("SHA256").update(Crypto.sha256(data)).sign(this.privateKeyPem);
		//Extract r and s components, remove/pad with zeros till length is 32.
		let r = derSignature.slice(4, 4 + derSignature[3]);
		if (r.length > 32) { r = r.slice(-32); } //Remove leading zero if needed
		if (r.length < 32) { r = Buffer.concat([Buffer.alloc(32 - r.length), r]); } //pad with 0s
		let s = derSignature.slice(-derSignature[5 + derSignature[3]]);
		if (s.length > 32) { s = s.slice(-32); } //Remove leading zero if needed
		if (s.length < 32) { s = Buffer.concat([Buffer.alloc(32 - s.length), s]); } //pad with 0s
		return Buffer.concat([r, s]);
	}
}