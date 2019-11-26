"use strict";
/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
const Encryption = require("crypto");
const crypto_1 = require("../tools/crypto");
class PublicKey {
    constructor(publicKey, alreadyVerified = false) {
        if (!alreadyVerified && !PublicKey.isValidPublic(publicKey)) {
            throw new Error("Invalid public key format.");
        }
        this.publicKey = publicKey;
    }
    static isValidPublic(publicKey) {
        if (!(publicKey instanceof Buffer) || publicKey.length !== 33 || (publicKey[0] !== 0x02 && publicKey[0] !== 0x03)) {
            return false;
        }
        try {
            if (Encryption.ECDH.convertKey !== undefined) {
                Encryption.ECDH.convertKey(publicKey, "secp256k1", undefined, undefined, "compressed");
            }
            else {
                PublicKey.secp256k1.setPublicKey(publicKey);
            }
            return true;
        }
        catch (error) {
            return false;
        }
    }
    static isValidAddress(address) {
        if (typeof address === "string") {
            try {
                const decodedAddress = crypto_1.Crypto.base58ToBinary(address);
                const checksum = decodedAddress.slice(-4);
                return decodedAddress.length === 25 && decodedAddress[0] === 0x00 && crypto_1.Crypto.hash256(decodedAddress.slice(0, -4)).slice(0, 4).equals(checksum);
            }
            catch (_a) {
                return false;
            }
        }
        else if (address instanceof Buffer) {
            return address.length === 20;
        }
        else {
            return false;
        }
    }
    getAddress() {
        if (this.address === undefined) {
            const hashedAddress = Buffer.concat([crypto_1.Crypto.uInt8ToBinary(0x00), crypto_1.Crypto.hash160(this.publicKey)]);
            const checksum = crypto_1.Crypto.hash256(hashedAddress).slice(0, 4);
            this.address = crypto_1.Crypto.binaryToBase58(Buffer.concat([hashedAddress, checksum]));
        }
        return this.address;
    }
    getAddressAsBuffer() {
        return crypto_1.Crypto.hash160(this.publicKey);
    }
    static addressAsBuffer(address) {
        if (!PublicKey.isValidAddress(address)) {
            throw new Error("Invalid address.");
        }
        if (typeof address === "string") {
            return crypto_1.Crypto.base58ToBinary(address).slice(1, -4);
        }
        else {
            return address;
        }
    }
    static addressAsString(address) {
        if (!PublicKey.isValidAddress(address)) {
            throw new Error("Invalid address.");
        }
        if (typeof address === "string") {
            return address;
        }
        else {
            const hashedAddress = Buffer.concat([crypto_1.Crypto.uInt8ToBinary(0x00), address]);
            const checksum = crypto_1.Crypto.hash256(hashedAddress).slice(0, 4);
            return crypto_1.Crypto.binaryToBase58(Buffer.concat([hashedAddress, checksum]));
        }
    }
    verify(data, signature) {
        if (!(data instanceof Buffer) || !(signature instanceof Buffer) || signature.length !== 64) {
            throw new Error("Invalid data or signature format.");
        }
        if (this.publicKeyPem === undefined) {
            this.publicKeyPem = "-----BEGIN PUBLIC KEY-----\n"
                + Buffer.concat([PublicKey.publicStart, this.publicKey]).toString("base64")
                + "\n-----END PUBLIC KEY-----";
        }
        let r;
        if (signature[0] >= 128) {
            r = Buffer.concat([Buffer.alloc(1, 0), signature.slice(0, 32)]);
        }
        else {
            let i = 0;
            while (signature[i] === 0 && signature[i + 1] <= 127 && i < 31) {
                i++;
            }
            r = signature.slice(i, 32);
        }
        let s;
        if (signature[32] >= 128) {
            s = Buffer.concat([Buffer.alloc(1, 0), signature.slice(32)]);
        }
        else {
            let i = 32;
            while (signature[i] === 0 && signature[i + 1] <= 127 && i < 63) {
                i++;
            }
            s = signature.slice(i);
        }
        const derSignature = Buffer.concat([
            Buffer.from([0x30, r.length + s.length + 4, 0x02, r.length]),
            r,
            Buffer.from([0x02, s.length]),
            s
        ]);
        return Encryption.createVerify("SHA256").update(crypto_1.Crypto.sha256(data)).verify(this.publicKeyPem, derSignature);
    }
}
exports.PublicKey = PublicKey;
PublicKey.secp256k1 = Encryption.createECDH("secp256k1");
PublicKey.publicStart = crypto_1.Crypto.hexToBinary("3036301006072a8648ce3d020106052b8104000a032200");
class PrivateKey extends PublicKey {
    constructor(privateKey, publicKey) {
        if (publicKey === undefined) {
            PrivateKey.secp256k1.setPrivateKey(privateKey);
            publicKey = PrivateKey.secp256k1.getPublicKey(undefined, "compressed");
        }
        super(publicKey, true);
        this.privateKey = privateKey;
    }
    static generate() {
        PrivateKey.secp256k1.generateKeys();
        let privateKey = PrivateKey.secp256k1.getPrivateKey();
        if (privateKey.length < 32) {
            privateKey = Buffer.concat([Buffer.alloc(32 - privateKey.length, 0), privateKey]);
        }
        return new PrivateKey(privateKey, PrivateKey.secp256k1.getPublicKey(undefined, "compressed"));
    }
    static generateNonRandom(data, salt) {
        let hashedData = crypto_1.Crypto.hash256(Buffer.concat([data, salt]));
        let success = false;
        while (!success) {
            try {
                PrivateKey.secp256k1.setPrivateKey(hashedData);
                success = true;
            }
            catch (error) {
                if (error.message !== "Private key is not valid for specified curve.") {
                    throw error;
                }
                hashedData = crypto_1.Crypto.hash256(Buffer.concat([hashedData, salt]));
            }
        }
        let privateKey = PrivateKey.secp256k1.getPrivateKey();
        if (privateKey.length < 32) {
            privateKey = Buffer.concat([Buffer.alloc(32 - privateKey.length, 0), privateKey]);
        }
        return new PrivateKey(privateKey, PrivateKey.secp256k1.getPublicKey(undefined, "compressed"));
    }
    static isValidWIF(wif) {
        if (typeof wif !== "string" || !crypto_1.Crypto.isBase58(wif)) {
            return false;
        }
        const decodedWif = crypto_1.Crypto.base58ToBinary(wif);
        if (decodedWif.length !== 38 || decodedWif[0] !== 0x80 || decodedWif[33] !== 0x01) {
            return false;
        }
        const checksum = decodedWif.slice(-4);
        if (!crypto_1.Crypto.hash256(decodedWif.slice(0, -4)).slice(0, 4).equals(checksum)) {
            return false;
        }
        try {
            PrivateKey.secp256k1.setPrivateKey(decodedWif.slice(1, 33));
            return true;
        }
        catch (error) {
            return false;
        }
    }
    toWIF() {
        const mainNetKey = Buffer.concat([crypto_1.Crypto.uInt8ToBinary(0x80), this.privateKey, crypto_1.Crypto.uInt8ToBinary(0x01)]);
        const checkSum = crypto_1.Crypto.hash256(mainNetKey).slice(0, 4);
        return crypto_1.Crypto.binaryToBase58(Buffer.concat([mainNetKey, checkSum]));
    }
    static fromWIF(wif) {
        if (!PrivateKey.isValidWIF(wif)) {
            throw new Error("Invalid wif");
        }
        return new PrivateKey(crypto_1.Crypto.base58ToBinary(wif).slice(1, 33));
    }
    sign(data) {
        if (!(data instanceof Buffer)) {
            throw new Error("Invalid data format");
        }
        if (this.privateKeyPem === undefined) {
            this.privateKeyPem = "-----BEGIN EC PRIVATE KEY-----\n"
                + Buffer.concat([PrivateKey.privateStart, this.privateKey, PrivateKey.privateEnd]).toString("base64")
                + "\n-----END EC PRIVATE KEY-----";
        }
        const derSignature = Encryption.createSign("SHA256").update(crypto_1.Crypto.sha256(data)).sign(this.privateKeyPem);
        let r = derSignature.slice(4, 4 + derSignature[3]);
        if (r.length > 32) {
            r = r.slice(-32);
        }
        if (r.length < 32) {
            r = Buffer.concat([Buffer.alloc(32 - r.length), r]);
        }
        let s = derSignature.slice(-derSignature[5 + derSignature[3]]);
        if (s.length > 32) {
            s = s.slice(-32);
        }
        if (s.length < 32) {
            s = Buffer.concat([Buffer.alloc(32 - s.length), s]);
        }
        return Buffer.concat([r, s]);
    }
}
exports.PrivateKey = PrivateKey;
PrivateKey.privateStart = crypto_1.Crypto.hexToBinary("302e0201010420");
PrivateKey.privateEnd = crypto_1.Crypto.hexToBinary("a00706052b8104000a");
//# sourceMappingURL=key.js.map