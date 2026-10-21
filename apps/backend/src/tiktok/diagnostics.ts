import { createHmac, randomBytes } from 'node:crypto';
import type { LifecycleReason, Observation } from './contracts.ts';

export type ComboNote =
    | 'retransmission_candidate'
    | 'identity_conflict'
    | 'count_repeated'
    | 'count_increased'
    | 'out_of_order'
    | 'explicit_final'
    | 'sequence_started'
    | 'started_above_one'
    | 'final_without_prior'
    | 'after_final'
    | 'sequence_context_conflict'
    | 'sequence_unidentifiable'
    | 'sequence_interrupted'
    | 'tracking_capacity'
    | 'individual_candidate';

/** Never receives raw provider payloads or Error objects. Only whitelist projections leave memory. */
export function createDiagnosticLogger(
    write: (line: string) => void,
    now = Date.now,
) {
    const salt = randomBytes(32);
    const pseudonym = (value: string | null) =>
        value === null
            ? null
            : createHmac('sha256', salt)
                  .update(value)
                  .digest('hex')
                  .slice(0, 20);
    let windowStart = now();
    let emitted = 0;
    let dropped = 0;
    const output = (record: object) => {
        const time = now();
        if (time - windowStart >= 1000) {
            if (dropped)
                write(
                    JSON.stringify({
                        category: 'diagnostic_limit',
                        dropped,
                        domain: 'observation',
                        scoringEligible: false,
                    }),
                );
            windowStart = time;
            emitted = 0;
            dropped = 0;
        }
        if (emitted >= 20) {
            dropped += 1;
            return;
        }
        const line = JSON.stringify({
            at: new Date(time).toISOString(),
            ...record,
        });
        if (Buffer.byteLength(line) > 2048) {
            dropped += 1;
            return;
        }
        emitted += 1;
        write(line);
    };
    return Object.freeze({
        lifecycle(
            reason: LifecycleReason,
            attempt: number,
            roomId: string | null = null,
        ) {
            output({
                category: 'connection',
                reason,
                attempt,
                room: pseudonym(roomId),
                domain: 'observation',
                scoringEligible: false,
            });
        },
        observation(event: Observation, notes: readonly ComboNote[]) {
            const c = event.confirmed;
            output({
                category: event.kind,
                status: event.status,
                reasons: event.reasons.slice(0, 16),
                notes: notes.slice(0, 12),
                room: pseudonym(c.roomId),
                connectionRoom: pseudonym(event.connectionRoomId),
                occurrence: pseudonym(c.eventId),
                user: pseudonym(c.userId),
                gift: pseudonym(c.giftId),
                sequence: pseudonym(c.sequenceId),
                textLength: c.text?.length ?? null,
                textFingerprint: pseudonym(c.text),
                giftNameLength: c.giftName?.length ?? null,
                repeatCount: c.repeatCount,
                repeatEnd: c.repeatEnd,
                giftType: c.giftType,
                comboFlag: c.combo,
                inferred: event.inferred,
                domain: 'observation',
                scoringEligible: false,
            });
        },
        interrupted(count: number) {
            if (count)
                output({
                    category: 'combo',
                    reason: 'sequence_interrupted',
                    count,
                    domain: 'observation',
                    scoringEligible: false,
                });
        },
        finish() {
            if (dropped) {
                write(
                    JSON.stringify({
                        category: 'diagnostic_limit',
                        dropped,
                        domain: 'observation',
                        scoringEligible: false,
                    }),
                );
                dropped = 0;
            }
        },
    });
}

type Sequence = {
    userId: string;
    giftId: string;
    count: number;
    final: boolean;
    seen: number;
};
export function createEventObserver(
    logger: ReturnType<typeof createDiagnosticLogger>,
    now = Date.now,
) {
    const sequences = new Map<string, Sequence>();
    const identities = new Map<string, { fingerprint: string; seen: number }>();
    function tick() {
        let interrupted = 0;
        for (const [key, value] of sequences)
            if (now() - value.seen >= 30_000) {
                if (!value.final) interrupted += 1;
                sequences.delete(key);
            }
        for (const [key, value] of identities)
            if (now() - value.seen >= 60_000) identities.delete(key);
        logger.interrupted(interrupted);
    }
    return Object.freeze({
        observe(event: Observation): readonly ComboNote[] {
            tick();
            const notes: ComboNote[] = [];
            const c = event.confirmed;
            if (event.status !== 'invalid' && c.roomId && c.eventId) {
                const key = JSON.stringify([c.roomId, event.kind, c.eventId]);
                const fingerprint = createHmac(
                    'sha256',
                    'diagnostic-local-fingerprint',
                )
                    .update(JSON.stringify(c))
                    .digest('hex');
                const old = identities.get(key);
                if (old)
                    notes.push(
                        old.fingerprint === fingerprint
                            ? 'retransmission_candidate'
                            : 'identity_conflict',
                    );
                else if (identities.size < 1024)
                    identities.set(key, { fingerprint, seen: now() });
                else notes.push('tracking_capacity');
            }
            if (event.kind === 'gift' && event.status !== 'invalid') {
                if (event.inferred.delivery === 'individual-candidate')
                    notes.push('individual_candidate');
                else if (
                    event.inferred.delivery !== 'combo-candidate' ||
                    !c.roomId ||
                    !c.sequenceId ||
                    !c.userId ||
                    !c.giftId ||
                    c.repeatCount === null
                )
                    notes.push('sequence_unidentifiable');
                else {
                    const key = JSON.stringify([c.roomId, c.sequenceId]);
                    const old = sequences.get(key);
                    if (old) {
                        if (old.userId !== c.userId || old.giftId !== c.giftId)
                            notes.push('sequence_context_conflict');
                        else if (old.final) notes.push('after_final');
                        else if (c.repeatCount < old.count)
                            notes.push('out_of_order');
                        else
                            notes.push(
                                c.repeatCount === old.count
                                    ? 'count_repeated'
                                    : 'count_increased',
                            );
                    } else if (sequences.size < 256) {
                        notes.push('sequence_started');
                        if (c.repeatCount > 1) notes.push('started_above_one');
                        if (c.repeatEnd === 1)
                            notes.push('final_without_prior');
                    } else notes.push('tracking_capacity');
                    if (
                        (!old && sequences.size < 256) ||
                        (old &&
                            old.userId === c.userId &&
                            old.giftId === c.giftId)
                    )
                        sequences.set(key, {
                            userId: c.userId,
                            giftId: c.giftId,
                            count: Math.max(old?.count ?? 0, c.repeatCount),
                            final: old?.final === true || c.repeatEnd === 1,
                            seen: now(),
                        });
                    if (c.repeatEnd === 1) notes.push('explicit_final');
                }
            }
            logger.observation(event, notes);
            return Object.freeze(notes);
        },
        tick,
        interrupt() {
            logger.interrupted(
                [...sequences.values()].filter((value) => !value.final).length,
            );
            sequences.clear();
        },
        close() {
            this.interrupt();
            identities.clear();
            logger.finish();
        },
    });
}
