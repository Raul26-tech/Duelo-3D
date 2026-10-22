import { createRuntimeReport } from './runtime-report.ts';
import { createAdministrationService } from '../admin/service.ts';
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
    const safeWrite = (line: string) => {
        try {
            options.writeDiagnostic?.(line);
        } catch {
            /* Observability never changes scoring. */
        }
    };
    const logger = createDiagnosticLogger(safeWrite);
    const baseObserver = createEventObserver(logger);
    const diagnostic = config.runtimeReport
        ? createRuntimeReport(
              config.runtimeReport,
              config.experiment ? 'experimental' : 'validated',
              baseObserver,
              safeWrite,
          )
        : undefined;
    let lease: ReturnType<typeof acquireAuthority>;
    try {
        lease = acquireAuthority(config.filename);
    } catch (error) {
        diagnostic?.finish('startup_failed');
        throw error;
    }
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
        diagnostic?.finish('startup_failed');
        throw error;
    }
    const snapshot = () => {
        lease.assertHeld();
        return storage.snapshot();
    };
    const arena = attachRealArena(options.server, options.origin, snapshot);
    const observer = diagnostic?.observer ?? baseObserver;
    let blocked = false;
    let reportWindow = Date.now();
    let reports = 0;
    const suppressed = new Map<string, number>();
    function flushSuppressed() {
        if (suppressed.size) {
            try {
                options.writeDiagnostic?.(
                    JSON.stringify({
                        category: 'real_ingress_suppressed',
                        domain: 'real',
                        counts: Object.fromEntries(suppressed),
                    }),
                );
            } catch {
                /* Diagnostics never affect committed state. */
            }
            suppressed.clear();
        }
    }
    function report(
        reason: string,
        decision?: Decision,
        matchMode?: 'id' | 'exact-name',
    ) {
        if (Date.now() - reportWindow >= 1000) {
            flushSuppressed();
            reports = 0;
            reportWindow = Date.now();
        }
        if (++reports > 20) {
            if (suppressed.has(reason) || suppressed.size < 32)
                suppressed.set(
                    reason,
                    Math.min(
                        Number.MAX_SAFE_INTEGER,
                        (suppressed.get(reason) ?? 0) + 1,
                    ),
                );
            return;
        }
        try {
            options.writeDiagnostic?.(
                JSON.stringify({
                    category: 'real_ingress',
                    domain: 'real',
                    reason,
                    ...(matchMode ? { matchMode } : {}),
                    status: decision?.status ?? 'rejected',
                    version: decision?.state.version ?? null,
                }),
            );
        } catch {
            /* Diagnostic output must not turn a committed event into a retry. */
        }
    }
    const administration = createAdministrationService(storage, {
        roomId: config.roomId,
        assertAuthority() {
            if (blocked) throw new Error('Real processing blocked');
            lease.assertHeld();
        },
        publish(decision) {
            try {
                options.afterCommit?.(decision);
                arena.publish(decision);
            } catch {
                report('PUBLICATION_FAILED');
                arena.disconnectViewers();
            }
        },
    });
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
                    diagnostic?.record(
                        kind,
                        payload,
                        roomId,
                        result.reason,
                        'rejected',
                        null,
                        result.matchMode,
                    );
                    report(result.reason, undefined, result.matchMode);
                    return;
                } // Observer still diagnoses rejected/unknown deliveries, never scores them.
                let decision: Decision;
                try {
                    decision = storage.process(result.event);
                } catch {
                    blocked = true;
                    diagnostic?.record(
                        kind,
                        payload,
                        roomId,
                        'PERSISTENCE_BLOCKED',
                        'rejected',
                        null,
                        result.matchMode,
                    );
                    report('PERSISTENCE_BLOCKED');
                    throw new Error(
                        'Persistence failure; real processing blocked',
                    );
                }
                diagnostic?.record(
                    kind,
                    payload,
                    roomId,
                    decision.reason,
                    decision.status,
                    decision.state.version,
                    result.matchMode,
                );
                report(decision.reason, decision, result.matchMode);
                if (
                    result.matchReason &&
                    (decision.status === 'applied' ||
                        !result.matchReason.startsWith('MATCH_')) &&
                    result.matchReason !== decision.reason
                )
                    report(result.matchReason, decision, result.matchMode);
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
    const tick = setInterval(() => {
        flushSuppressed();
        observer.tick();
        diagnostic?.tick();
    }, 1000);
    tick.unref();
    client.start();
    let closing: Promise<void> | undefined;
    return {
        snapshot,
        diagnosticReport: () => diagnostic?.snapshot(),
        administration,
        state: client.state,
        close() {
            if (!closing)
                closing = (async () => {
                    clearInterval(tick);
                    flushSuppressed();
                    arena.close();
                    await client.stop();
                    diagnostic?.finish('operator_stop');
                    storage.close();
                    release();
                })();
            return closing;
        },
    };
}
