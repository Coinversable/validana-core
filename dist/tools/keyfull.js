"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Encryption = require("crypto");
const crypto_1 = require("../tools/crypto");
class PublicKeyFull {
    constructor(publicKey) {
        if (!PublicKeyFull.isValidPublic(publicKey)) {
            throw new Error("Invalid public key format.");
        }
        if (PublicKeyFull.length === 33) {
            this.compressed = true;
            this.publicKeyCompressed = publicKey;
            if (PublicKeyFull.isNode10OrLater) {
                this.publicKeyUncompressed = Encryption.ECDH.convertKey(publicKey, "secp256k1", undefined, undefined, "uncompressed");
            }
            else {
                PublicKeyFull.secp256k1.setPublicKey(publicKey);
                this.publicKeyUncompressed = PublicKeyFull.secp256k1.getPublicKey(undefined, "uncompressed");
            }
        }
        else {
            this.compressed = false;
            this.publicKeyUncompressed = publicKey;
            this.publicKeyUncompressed[0] = 0x04;
            if (PublicKeyFull.isNode10OrLater) {
                this.publicKeyCompressed = Encryption.ECDH.convertKey(publicKey, "secp256k1", undefined, undefined, "compressed");
            }
            else {
                PublicKeyFull.secp256k1.setPublicKey(publicKey);
                this.publicKeyCompressed = PublicKeyFull.secp256k1.getPublicKey(undefined, "compressed");
            }
        }
    }
    static isValidPublic(publicKey, requiredFormat) {
        if (!(publicKey instanceof Buffer)) {
            return false;
        }
        if (PublicKeyFull.length === 33) {
            if ((publicKey[0] !== 0x02 && publicKey[0] !== 0x03) || (requiredFormat !== undefined && requiredFormat !== "compressed")) {
                return false;
            }
        }
        else if (PublicKeyFull.length === 65) {
            if (publicKey[0] === 0x04) {
                if (requiredFormat !== undefined && requiredFormat !== "uncompressed") {
                    return false;
                }
            }
            else if (publicKey[0] === 0x06 || publicKey[0] === 0x07) {
                if (requiredFormat !== undefined && requiredFormat !== "hybrid") {
                    return false;
                }
            }
            else {
                return false;
            }
        }
        else {
            return false;
        }
        if (PublicKeyFull.length === 65) {
            try {
                if (PublicKeyFull.isNode10OrLater) {
                    Encryption.ECDH.convertKey(publicKey, "secp256k1");
                }
                else {
                    Encryption.createECDH("secp256k1").setPublicKey(publicKey);
                }
            }
            catch (_a) {
                return false;
            }
        }
        return true;
    }
    static isValidAddress(address, requiredPrefix) {
        if (typeof address !== "string") {
            return false;
        }
        try {
            const decodedAddress = crypto_1.Crypto.base58ToBinary(address);
            if (requiredPrefix !== undefined && decodedAddress[0] !== requiredPrefix) {
                return false;
            }
            const checksum = decodedAddress.slice(-4);
            return crypto_1.Crypto.hash256(decodedAddress.slice(0, -4)).slice(0, 4).equals(checksum);
        }
        catch (_a) {
            return false;
        }
    }
    getAddress(compressed = this.compressed, addressPrefix = 0x00) {
        const hashedAddress = Buffer.concat([
            crypto_1.Crypto.uInt8ToBinary(addressPrefix),
            crypto_1.Crypto.hash160(compressed ? this.publicKeyCompressed : this.publicKeyUncompressed)
        ]);
        const checksum = crypto_1.Crypto.hash256(hashedAddress).slice(0, 4);
        return crypto_1.Crypto.binaryToBase58(Buffer.concat([hashedAddress, checksum]));
    }
    verify(data, signature) {
        if (signature.length !== 64) {
            throw new Error("Invalid signature format.");
        }
        if (this.publicKeyPem === undefined) {
            this.publicKeyPem = "-----BEGIN PUBLIC KEY-----\n"
                + Buffer.concat([PublicKeyFull.publicStart, this.publicKeyCompressed]).toString("base64")
                + "\n-----END PUBLIC KEY-----";
        }
        let r;
        if (signature[0] >= 128) {
            r = Buffer.concat([Buffer.alloc(1, 0), signature.slice(0, 32)]);
        }
        else {
            let i = 0;
            while (signature[i] === 0 && signature[i + 1] <= 127 && i < 30) {
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
            while (signature[i] === 0 && signature[i + 1] <= 127 && i < 62) {
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
PublicKeyFull.isNode10OrLater = Number.parseInt(process.versions.node.split(".")[0]) >= 10;
PublicKeyFull.secp256k1 = Encryption.createECDH("secp256k1");
PublicKeyFull.publicStart = crypto_1.Crypto.hexToBinary("3056301006072a8648ce3d020106052b8104000a032200");
exports.PublicKeyFull = PublicKeyFull;
class PrivateKeyFull extends PublicKeyFull {
    constructor(privateKey, publicKey, networkPrefix = 0x80, compressed = true) {
        if (publicKey === undefined) {
            PrivateKeyFull.secp256k1.setPrivateKey(privateKey);
            publicKey = PrivateKeyFull.secp256k1.getPublicKey(undefined, compressed ? "compressed" : "uncompressed");
        }
        super(publicKey);
        this.privateKey = privateKey;
        this.networkPrefix = networkPrefix;
    }
    static generate(networkPrefix = 0x80, compressed = true) {
        PrivateKeyFull.secp256k1.generateKeys();
        let privateKey = PrivateKeyFull.secp256k1.getPrivateKey();
        if (PrivateKeyFull.length < 32) {
            privateKey = Buffer.concat([Buffer.alloc(32 - PrivateKeyFull.length, 0), privateKey]);
        }
        return new PrivateKeyFull(privateKey, PrivateKeyFull.secp256k1.getPublicKey(undefined, compressed ? "compressed" : "uncompressed"), networkPrefix, compressed);
    }
    static isValidWIF(wif, requiredPrefix, requiredCompression) {
        if (typeof wif !== "string" || !crypto_1.Crypto.isBase58(wif)) {
            return false;
        }
        const decodedWif = crypto_1.Crypto.base58ToBinary(wif);
        if (decodedWif.length === 37) {
            if (requiredCompression === true) {
                return false;
            }
        }
        else if (decodedWif.length === 38) {
            if (decodedWif[33] !== 0x01 || requiredCompression === false) {
                return false;
            }
        }
        else {
            return false;
        }
        if (requiredPrefix !== undefined && decodedWif[0] !== requiredPrefix) {
            return false;
        }
        const checksum = decodedWif.slice(-4);
        if (!crypto_1.Crypto.hash256(decodedWif.slice(0, -4)).slice(0, 4).equals(checksum)) {
            return false;
        }
        return true;
    }
    toWIF(compressed = this.compressed, networkPrefix = this.networkPrefix) {
        let mainNetKey = Buffer.concat([crypto_1.Crypto.uInt8ToBinary(networkPrefix), this.privateKey]);
        if (compressed) {
            mainNetKey = Buffer.concat([mainNetKey, crypto_1.Crypto.uInt8ToBinary(0x01)]);
        }
        const checkSum = crypto_1.Crypto.hash256(mainNetKey).slice(0, 4);
        return crypto_1.Crypto.binaryToBase58(Buffer.concat([mainNetKey, checkSum]));
    }
    static fromWIF(wif, requiredPrefix, requiredCompression) {
        if (!PrivateKeyFull.isValidWIF(wif, requiredPrefix, requiredCompression)) {
            throw new Error("Invalid wif");
        }
        const decodedWif = crypto_1.Crypto.base58ToBinary(wif);
        const compressed = decodedWif.length === 38;
        const networkPrefix = decodedWif[0];
        return new PrivateKeyFull(decodedWif.slice(1, 33), undefined, networkPrefix, compressed);
    }
    sign(data) {
        if (this.privateKeyPem === undefined) {
            this.privateKeyPem = "-----BEGIN EC PRIVATE KEY-----\n"
                + Buffer.concat([PrivateKeyFull.privateStart, this.privateKey, PrivateKeyFull.privateEnd]).toString("base64")
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
PrivateKeyFull.privateStart = crypto_1.Crypto.hexToBinary("302e0201010420");
PrivateKeyFull.privateEnd = crypto_1.Crypto.hexToBinary("a00706052b8104000a");
exports.PrivateKeyFull = PrivateKeyFull;
//# sourceMappingURL=keyfull.js.map