/// <reference types="node" />
export declare class PublicKey {
    private static readonly publicStart;
    readonly publicKey: Buffer;
    private publicKeyPem;
    private address;
    constructor(publicKey: Buffer);
    static isValidPublic(publicKey: Buffer): boolean;
    static isValidAddress(address: string): boolean;
    getAddress(): string;
    verify(data: Buffer, signature: Buffer): boolean;
}
export declare class PrivateKey extends PublicKey {
    private static readonly secp256k1;
    private static readonly privateStart;
    private static readonly privateEnd;
    readonly privateKey: Buffer;
    private privateKeyPem;
    private constructor();
    static generate(): PrivateKey;
    static isValidWIF(wif: string): boolean;
    toWIF(): string;
    static fromWIF(wif: string): PrivateKey;
    sign(data: Buffer): Buffer;
}
