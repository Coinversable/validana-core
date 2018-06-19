/// <reference types="node" />
export declare class Crypto {
    private static readonly base58chars;
    private static readonly base58map;
    static hash160(buffer: Buffer): Buffer;
    static hash256(buffer: Buffer): Buffer;
    static ripemd160(buffer: Buffer): Buffer;
    static sha1(buffer: Buffer): Buffer;
    static sha256(buffer: Buffer): Buffer;
    static sha512(buffer: Buffer): Buffer;
    static md5(buffer: Buffer): Buffer;
    static isHex(text: string): boolean;
    static hexToBinary(hex: string): Buffer;
    static binaryToHex(binary: Buffer): string;
    static isBase58(text: string): boolean;
    static base58ToBinary(base58: string): Buffer;
    static binaryToBase58(binary: Buffer): string;
    static isBase64(text: string): boolean;
    static base64ToBinary(base64: string): Buffer;
    static binaryToBase64(binary: Buffer): string;
    static isUtf8Postgres(text: string): boolean;
    static makeUtf8Postgres(text: string): string;
    static utf8ToBinary(text: string): Buffer;
    static binaryToUtf8(binary: Buffer): string;
    static uInt8ToBinary(unsignedInt: number): Buffer;
    static binaryToUInt8(buffer: Buffer): number;
    static uInt16ToBinary(unsignedInt: number): Buffer;
    static binaryToUInt16(buffer: Buffer): number;
    static uInt32ToBinary(unsignedInt: number): Buffer;
    static binaryToUInt32(buffer: Buffer): number;
    static uLongToBinary(ulong: number): Buffer;
    static binaryToULong(binary: Buffer): number;
}
