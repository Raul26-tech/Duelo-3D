import { createScoringEngine, type EngineOptions } from '../scoring/engine.ts';
import { eventIdentity, parseEvent } from '../scoring/validation.ts';
import {
    ScoringIntegrityError,
    type ScoringStore,
    type ScoringTransaction,
} from './port.ts';

/** No live mutable engine survives a transaction. A thrown commit never publishes state. */
export function createScoringCoordinator(
    store: ScoringStore,
    options: EngineOptions,
    mode: 'create' | 'resume',
) {
    const configuration =
        createScoringEngine(options).checkpoint().configuration;
    // Copy and validate caller-owned configuration before opening any scoring operation.
    const settings: EngineOptions = {
        ...configuration,
        ...(options.enableRealScoring
            ? { enableRealScoring: true as const }
            : {}),
        catalog: configuration.catalog,
    };
    let closed = false;
    let blocked = false;
    function transact<T>(work: (tx: ScoringTransaction) => T): T {
        if (closed || blocked)
            throw new ScoringIntegrityError('coordinator closed or blocked');
        try {
            return store.transaction(work);
        } catch (error) {
            if (error instanceof ScoringIntegrityError) blocked = true;
            throw error;
        }
    }
    function recover(tx: ScoringTransaction) {
        const stored = tx.load();
        if (
            JSON.stringify(stored.checkpoint.configuration) !==
            JSON.stringify(configuration)
        )
            throw new ScoringIntegrityError(
                'configuration/context differs from the persisted dispute',
            );
        const engine = createScoringEngine(
            settings,
            stored.checkpoint.state.sessionId,
        );
        const seen = new Set<string>();
        for (const event of stored.journal) {
            const identity = eventIdentity(event);
            // A repeated ID may change quarantine only; most entries need no full checkpoint copy.
            const before = seen.has(identity)
                ? JSON.stringify(engine.checkpoint())
                : null;
            const decision = engine.process(event);
            if (
                [
                    'INVALID_EVENT',
                    'UNAUTHORIZED_CONTEXT',
                    'CAPACITY_REACHED',
                    'SCORE_LIMIT',
                    'EVENT_ALREADY_PROCESSED',
                ].includes(decision.reason) ||
                (before !== null &&
                    before === JSON.stringify(engine.checkpoint()))
            )
                throw new ScoringIntegrityError(
                    'journal contains a non-transition',
                );
            seen.add(identity);
        }
        if (
            JSON.stringify(engine.checkpoint()) !==
            JSON.stringify(stored.checkpoint)
        )
            throw new ScoringIntegrityError(
                'replay does not match stored score, identities or sequences',
            );
        return engine;
    }
    try {
        if (mode === 'create')
            transact((tx) =>
                tx.initialize(createScoringEngine(settings).checkpoint()),
            );
        else if (mode !== 'resume')
            throw new Error('Specify create or resume explicitly');
        transact(recover);
    } catch (error) {
        store.close();
        closed = true;
        throw error;
    }

    return Object.freeze({
        process(value: unknown) {
            return transact((tx) => {
                const candidate = recover(tx);
                const before = JSON.stringify(candidate.checkpoint());
                // Capture caller-owned input once; journal and rules must see identical data.
                const event = parseEvent(value);
                const decision = candidate.process(event);
                const after = candidate.checkpoint();
                if (JSON.stringify(after) !== before) {
                    if (!event)
                        throw new ScoringIntegrityError(
                            'transition has no normalized event',
                        );
                    tx.append(event, after);
                }
                return decision;
            }); // Adapter returns only after COMMIT. Publication belongs to the caller.
        },
        snapshot() {
            return transact((tx) => recover(tx).snapshot());
        },
        close() {
            if (!closed) {
                closed = true;
                store.close();
            }
        },
    });
}
