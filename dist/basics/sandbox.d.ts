/*!
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */
/**
 * A sandbox that enforces determinism as much as possible and provides security to the system.
 * It is on best effort basis meant to prevent mistakes; smart contracts should be written by a trusted party.
 * Used when executing smart contracts.
 */
export declare class Sandbox {
    private static sandboxed;
    private static isSetup;
    private static readonly processStandin;
    static readonly makeUndefined: {
        [index: string]: unknown;
    };
    static readonly special: {
        [index: string]: any;
    };
    private static readonly deterministicDate;
    /**
     * Enter a sandbox environment. It is safe to call this even if you are currently sandboxed.
     * Make sure you leave it again after critical code is executed. Note that:
     * * All global objects are permanently frozen, even after leaving the sandbox.
     * * Various async functions, the process and require are unavailable in the sandbox.
     * * It will try to make it deterministed by removing things like Math.random(), Date.now() and setTimeout().
     * * It will change JSON.parse to return undefined instead of throwing an error.
     */
    static sandbox(): void;
    /** Leave the sandboxed environment again. It is safe to call this even if you are not currently sandboxed. */
    static unSandbox(): void;
    static isSandboxed(): boolean;
}
