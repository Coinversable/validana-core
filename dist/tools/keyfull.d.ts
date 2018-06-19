/// <reference types="node" />
import * as Encryption from "crypto";
export declare class PublicKeyFull {
    private static readonly isNode10OrLater;
    protected static readonly secp256k1: Encryption.ECDH;
    private static readonly publicStart;
    readonly compressed: boolean;
    readonly publicKeyUncompressed: Buffer;
    readonly publicKeyCompressed: Buffer;
    private publicKeyPem;
    constructor(publicKey: Buffer);
    static isValidPublic(publicKey: Buffer, requiredFormat?: "compressed" | "uncompressed" | "hybrid"): boolean;
    static isValidAddress(address: string, requiredPrefix?: number): boolean;
    getAddress(compressed?: boolean, addressPrefix?: number): string;
    verify(data: Buffer, signature: Buffer): boolean;
}
export declare class PrivateKeyFull extends PublicKeyFull {
    private static readonly privateStart;
    private static readonly privateEnd;
    readonly privateKey: Buffer;
    private privateKeyPem;
    readonly networkPrefix: number;
    private constructor();
    static generate(networkPrefix?: number, compressed?: boolean): PrivateKeyFull;
    static isValidWIF(wif: string, requiredPrefix?: number, requiredCompression?: boolean): boolean;
    toWIF(compressed?: boolean, networkPrefix?: number): string;
    static fromWIF(wif: string, requiredPrefix?: number, requiredCompression?: boolean): PrivateKeyFull;
    sign(data: Buffer): Buffer;
}
