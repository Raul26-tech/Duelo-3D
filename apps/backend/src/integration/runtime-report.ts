import type { Observation } from '../tiktok/contracts.ts';
import { reserveLocalJson } from '../local-json.ts';
import { createGiftReport } from '../tiktok/gift-report.ts';
import type { createEventObserver } from '../tiktok/diagnostics.ts';
import { normalizeProviderEvent } from '../tiktok/normalize.ts';
import type { RealConfig } from './config.ts';

/** Read-only sidecar of the SAME provider connection. No engine/SQL/SDK capability. */
export function createRuntimeReport(
    config: NonNullable<RealConfig['runtimeReport']>,
    mode: 'experimental' | 'validated',
    observer: ReturnType<typeof createEventObserver>,
    write: (line: string) => void,
    now = Date.now,
) {
    if (
        !Number.isInteger(config.durationMs) ||
        config.durationMs < 60000 ||
        config.durationMs > 35 * 60000
    )
        throw new Error('Runtime report duration must be 1–35 minutes');
    const output = reserveLocalJson(config.filename);
    const gifts = createGiftReport();
    const outcomes = new Map<
        string,
        {
            giftId: string | null;
            name: string | null;
            reason: string;
            status: string;
            notifications: number;
            matchMode: string | null;
            lastCommittedVersion: number | null;
        }
    >();
    const start = now();
    let active = true,
        samples = 0,
        dropped = 0,
        ended: string | null = null,
        saved = false;
    const snapshot = () => {
        const value = {
            schema: 'real-runtime-report-v1',
            purpose: mode,
            scoringEligible: false,
            authorizationGranted: false,
            durationLimitMs: config.durationMs,
            elapsedMs: Math.min(Math.max(0, now() - start), config.durationMs),
            ended,
            sampledOutcomes: samples,
            droppedOutcomes: dropped,
            observation: gifts.snapshot(),
            outcomes: [...outcomes.values()].map((row) => ({ ...row })),
            saved,
        };
        while (Buffer.byteLength(JSON.stringify(value, null, 4)) > 60000) {
            const outcome = value.outcomes.pop();
            if (outcome) value.droppedOutcomes += outcome.notifications;
            else {
                const row = value.observation.gifts.pop();
                if (!row) break;
                value.observation.dropped += row.notifications;
            }
        }
        return value;
    };
    function finish(reason: string) {
        if (!active) return;
        active = false;
        ended = reason;
        try {
            output.save({ ...snapshot(), saved: true });
            saved = true;
        } catch {
            try {
                write(
                    '{"category":"runtime_report_write_failed","scoringEligible":false}',
                );
            } catch {
                /* Never affect scoring. */
            }
        }
    }
    function tick() {
        if (active && now() - start >= config.durationMs)
            finish('duration_limit');
    }
    return {
        observer: {
            ...observer,
            observe(event: Observation) {
                const notes = observer.observe(event);
                tick();
                if (active) {
                    gifts.observe(event, notes);
                    if (samples >= 30000) finish('sample_limit');
                }
                return notes;
            },
        },
        record(
            kind: 'comment' | 'gift',
            raw: unknown,
            room: string,
            reason: string,
            status: string,
            version: number | null,
            matchMode?: string,
        ) {
            tick();
            if (!active || kind !== 'gift') return;
            if (samples >= 30000) {
                dropped++;
                return;
            }
            samples++;
            const c = normalizeProviderEvent(kind, raw, room).confirmed;
            const name =
                c.giftName &&
                c.giftName.length <= 128 &&
                !/[\u0000-\u001f\u007f]/u.test(c.giftName)
                    ? c.giftName
                    : null;
            const safeReason = /^[A-Z][A-Z0-9_]{0,63}$/u.test(reason)
                ? reason
                : 'UNKNOWN_REASON';
            const key = JSON.stringify([
                c.giftId,
                name,
                safeReason,
                status,
                matchMode ?? null,
            ]);
            const old = outcomes.get(key);
            if (old) {
                old.notifications++;
                old.lastCommittedVersion = version;
            } else if (outcomes.size < 64)
                outcomes.set(key, {
                    giftId: c.giftId,
                    name,
                    reason: safeReason,
                    status,
                    notifications: 1,
                    matchMode: matchMode ?? null,
                    lastCommittedVersion: version,
                });
            else dropped++;
        },
        tick,
        finish,
        snapshot,
    };
}
