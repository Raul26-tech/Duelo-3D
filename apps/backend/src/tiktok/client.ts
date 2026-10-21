import type {
    LifecycleReason,
    LifecycleState,
    ProviderClient,
    ProviderEvent,
    Scheduler,
} from './contracts.ts';
import { normalizeProviderEvent, providerId } from './normalize.ts';
import type {
    createDiagnosticLogger,
    createEventObserver,
} from './diagnostics.ts';

const scheduleDefault: Scheduler = (task, delay) => {
    const timer = setTimeout(task, delay);
    return () => clearTimeout(timer);
};

/** Lifecycle only. It has no scoring, persistence or simulation capability. */
export function createDiagnosticClient(options: {
    enabled: boolean;
    factory: () => ProviderClient;
    logger: ReturnType<typeof createDiagnosticLogger>;
    observer: ReturnType<typeof createEventObserver>;
    schedule?: Scheduler;
    now?: () => number;
}) {
    const schedule = options.schedule ?? scheduleDefault;
    const now = options.now ?? Date.now;
    let state: LifecycleState = options.enabled ? 'idle' : 'disabled';
    let terminalReason: LifecycleReason | null = null;
    let generation = 0;
    let retries = 0;
    let roomId: string | null = null;
    let active: ProviderClient | null = null;
    let detach = () => {};
    let cancelDeadline = () => {};
    let cancelRetry = () => {};
    let windowStart = now();
    let received = 0;
    let stopping: Promise<void> | null = null;
    const report = (reason: LifecycleReason) =>
        options.logger.lifecycle(reason, retries, roomId);
    async function release(client: ProviderClient | null): Promise<boolean> {
        if (!client) return true;
        let cancel = () => {};
        const deadline = new Promise<boolean>((resolve) => {
            cancel = schedule(() => resolve(false), 2500);
        });
        try {
            return await Promise.race([
                Promise.resolve()
                    .then(() => client.disconnect())
                    .then(
                        () => true,
                        () => false,
                    ),
                deadline,
            ]);
        } finally {
            cancel();
        }
    }
    async function stop(reason: LifecycleReason = 'operator_stop') {
        if (stopping) return stopping;
        if (state === 'stopped') return;
        terminalReason = reason;
        state = 'stopping';
        generation += 1;
        cancelDeadline();
        cancelRetry();
        detach();
        const client = active;
        active = null;
        report(reason);
        options.observer.interrupt();
        stopping = (async () => {
            if (!(await release(client))) {
                terminalReason = 'cleanup_timeout';
                report('cleanup_timeout');
            }
            state = 'stopped';
            options.observer.close();
        })();
        return stopping;
    }
    async function retry(epoch: number, reason: LifecycleReason) {
        if (epoch !== generation || state === 'stopping' || state === 'stopped')
            return;
        generation += 1;
        cancelDeadline();
        detach();
        const client = active;
        active = null;
        state = 'reconnecting';
        report(reason);
        options.observer.interrupt();
        const token = generation;
        if (!(await release(client))) {
            if (token === generation) await stop('cleanup_timeout');
            return;
        }
        if (token !== generation) return;
        if (retries >= 5) {
            await stop('retry_exhausted');
            return;
        }
        const delay = Math.min(1000 * 2 ** retries, 30_000);
        retries += 1;
        cancelRetry = schedule(() => {
            if (token === generation) launch();
        }, delay);
    }
    function launch() {
        if (state === 'stopped' || state === 'stopping') return;
        const epoch = ++generation;
        state = retries ? 'reconnecting' : 'connecting';
        report('connecting');
        let client: ProviderClient;
        try {
            client = options.factory();
        } catch {
            void retry(epoch, 'provider_failure');
            return;
        }
        active = client;
        const bindings: [ProviderEvent, (value: unknown) => void][] = [];
        const bind = (
            event: ProviderEvent,
            handler: (value: unknown) => void,
        ) => {
            const guarded = (value: unknown) => {
                if (epoch === generation) handler(value);
            };
            bindings.push([event, guarded]);
            client.on(event, guarded);
        };
        detach = () => {
            for (const [name, handler] of bindings) client.off(name, handler);
        };
        for (const [name, kind] of [
            ['chat', 'comment'],
            ['gift', 'gift'],
        ] as const)
            bind(name, (value) => {
                if (state !== 'connected') return;
                if (now() - windowStart >= 1000) {
                    windowStart = now();
                    received = 0;
                }
                received += 1;
                if (received > 100) {
                    if (received === 101) report('event_rate_limited');
                    return;
                }
                try {
                    options.observer.observe(
                        normalizeProviderEvent(kind, value, roomId),
                    );
                } catch {
                    report('provider_error');
                }
            });
        bind('error', () => {
            report('provider_error');
            if (state === 'connected') void retry(epoch, 'provider_failure');
        });
        bind('disconnected', () => {
            if (state === 'connected') void retry(epoch, 'disconnected');
            else void stop('provider_failure'); // Never overlap an unresolved connect attempt.
        });
        bind('streamEnd', () => {
            void stop('stream_ended');
        });
        // A timed-out connect has uncertain cleanup: stop instead of opening a parallel attempt.
        cancelDeadline = schedule(() => {
            if (epoch === generation) void stop('connect_timeout');
        }, 15_000);
        Promise.resolve()
            .then(() => {
                if (epoch !== generation) throw new Error('cancelled');
                return client.connect();
            })
            .then(
                (result) => {
                    if (epoch !== generation) {
                        void release(client);
                        return;
                    }
                    cancelDeadline();
                    const connectedRoom =
                        result &&
                        typeof result === 'object' &&
                        'roomId' in result
                            ? providerId(result.roomId)
                            : null;
                    if (!connectedRoom) {
                        void retry(epoch, 'provider_failure');
                        return;
                    }
                    if (roomId && roomId !== connectedRoom) {
                        options.observer.interrupt();
                        report('room_changed');
                    }
                    roomId = connectedRoom;
                    state = 'connected';
                    report('connected');
                },
                () => {
                    if (epoch === generation)
                        void retry(epoch, 'provider_failure');
                },
            );
    }
    return Object.freeze({
        start() {
            if (state === 'disabled') {
                report('disabled');
                return;
            }
            if (state === 'idle') launch();
        },
        stop,
        state: () => state,
        reason: () => terminalReason,
    });
}
