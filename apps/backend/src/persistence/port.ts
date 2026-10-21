import type { EngineCheckpoint, ScoringEvent } from '../scoring/contracts.ts';

export class ScoringIntegrityError extends Error {
    constructor(message: string) {
        super(`Unsafe scoring recovery blocked: ${message}`);
        this.name = 'ScoringIntegrityError';
    }
}

export type StoredScoring = Readonly<{
    checkpoint: EngineCheckpoint;
    journal: readonly ScoringEvent[];
}>;

/** All methods on this handle run inside one synchronous writer transaction. */
export interface ScoringTransaction {
    load(): StoredScoring;
    initialize(checkpoint: EngineCheckpoint): void;
    append(event: ScoringEvent, checkpoint: EngineCheckpoint): void;
}

export interface ScoringStore {
    transaction<T>(work: (transaction: ScoringTransaction) => T): T;
    close(): void;
}
