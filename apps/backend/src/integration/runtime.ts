import type { Server } from 'node:http';
import { openSqliteScoring } from '../persistence/sqlite.ts';
import type { Decision } from '../scoring/contracts.ts';
import { createDiagnosticClient } from '../tiktok/client.ts';
import {
    createDiagnosticLogger,
    createEventObserver,
} from '../tiktok/diagnostics.ts';
import type { ProviderClient, Scheduler } from '../tiktok/contracts.ts';
import type { RealConfig } from './config.ts';
import { TIKTOK_ORIGIN, validateRealOccurrence } from './ingress.ts';
import { acquireAuthority } from './authority.ts';
import { attachRealArena } from './arena.ts';

export function startRealRuntime(options: {
    server: Server;
    origin: string;
    config: RealConfig;
    factory: () => ProviderClient;
    schedule?: Scheduler;
    writeDiagnostic?: (line: string) => void;
    /** Injectable publication for transport-failure tests; never runs inside a SQL transaction. */
    afterCommit?: (decision: Decision) => void;
}) {
    const config = options.config;
    const lease = acquireAuthority(config.filename);
    const release = lease.release;
    let storage: ReturnType<typeof openSqliteScoring>;
    try {
        storage = openSqliteScoring({
            filename: config.filename,
            mode: config.action,
            engine: {
                origin: TIKTOK_ORIGIN,
                roomId: config.roomId,
                domain: 'real',
                enableRealScoring: true,
                sourcePolicy: config.sourcePolicy,
                catalog: config.gifts.map(
                    ({ delivery: _delivery, ...rule }) => rule,
                ),
            },
        });
    } catch (error) {
        release();
        throw error;
    }
    const snapshot = () => {
        lease.assertHeld();
        return storage.snapshot();
    };
    const arena = attachRealArena(options.server, options.origin, snapshot);
    const logger = createDiagnosticLogger(
        options.writeDiagnostic ?? (() => {}),
    );
    const observer = createEventObserver(logger);
    let blocked = false;
    let reportWindow = Date.now();
    let reports = 0;
    function report(reason: string, decision?: Decision) {
        if (Date.now() - reportWindow >= 1000) {
            reports = 0;
            reportWindow = Date.now();
        }
        if (++reports > 20) return;
        try {
            options.writeDiagnostic?.(
                JSON.stringify({
                    category: 'real_ingress',
                    domain: 'real',
                    reason,
                    status: decision?.status ?? 'rejected',
                    version: decision?.state.version ?? null,
                }),
            );
        } catch {
            /* Diagnostic output must not turn a committed event into a retry. */
        }
    }
    const client = createDiagnosticClient({
        enabled: true,
        factory: options.factory,
        logger,
        observer,
        schedule: options.schedule,
        ingress: {
            connected(roomId) {
                if (blocked || roomId !== config.roomId) {
                    blocked = true;
                    throw new Error('Unauthorized transmission');
                }
                snapshot(); // Re-prove recovery before accepting an epoch of provider callbacks.
            },
            receive(kind, payload, roomId) {
                if (blocked) throw new Error('Real processing blocked');
                lease.assertHeld();
                const result = validateRealOccurrence(
                    kind,
                    payload,
                    roomId,
                    config.roomId,
                    config.gifts,
                );
                if (!result.event) {
                    report(result.reason);
                    return;
                } // Observer still diagnoses rejected/unknown deliveries, never scores them.
                let decision: Decision;
                try {
                    decision = storage.process(result.event);
                } catch {
                    blocked = true;
                    report('PERSISTENCE_BLOCKED');
                    throw new Error(
                        'Persistence failure; real processing blocked',
                    );
                }
                report(decision.reason, decision);
                // Once committed a failed publication cannot roll back or re-apply the occurrence.
                // Close viewers so they reconcile by a fresh persisted snapshot.
                try {
                    options.afterCommit?.(decision);
                    arena.publish(decision);
                } catch {
                    report('PUBLICATION_FAILED');
                    arena.disconnectViewers();
                }
            },
        },
    });
    const tick = setInterval(() => observer.tick(), 1000);
    tick.unref();
    client.start();
    let closing: Promise<void> | undefined;
    return {
        snapshot,
        state: client.state,
        close() {
            if (!closing)
                closing = (async () => {
                    clearInterval(tick);
                    arena.close();
                    await client.stop();
                    storage.close();
                    release();
                })();
            return closing;
        },
    };
}
