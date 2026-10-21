import type { Observation } from './contracts.ts';
import type { ComboNote, createEventObserver } from './diagnostics.ts';

const trackedNotes = [
    'retransmission_candidate',
    'identity_conflict',
    'count_repeated',
    'count_increased',
    'out_of_order',
    'explicit_final',
    'sequence_context_conflict',
    'sequence_interrupted',
    'tracking_capacity',
] as const;
type Row = {
    giftId: string;
    names: string[];
    notifications: number;
    invalid: number;
    insufficient: number;
    giftTypes: number[];
    comboFlags: boolean[];
    withGroupId: number;
    withoutGroupId: number;
    repeatCountMin: number | null;
    repeatCountMax: number | null;
    repeatEndPending: number;
    repeatEndFinal: number;
    repeatEndMissing: number;
    notes: Partial<Record<(typeof trackedNotes)[number], number>>;
};
/** Aggregates only public gift metadata and counters. No user/room/event/group IDs or chat text leave memory. */
export function createGiftReport(giftLimit = 32) {
    if (!Number.isInteger(giftLimit) || giftLimit < 1 || giftLimit > 32)
        throw new Error('Invalid gift report capacity');
    const rows = new Map<string, Row>();
    let missingGiftIds = 0;
    let dropped = 0;
    let samples = 0;
    return {
        observe(event: Observation, notes: readonly ComboNote[]) {
            if (event.kind !== 'gift') return;
            if (++samples > 30000) {
                dropped++;
                return;
            }
            const c = event.confirmed;
            if (!c.giftId) {
                missingGiftIds++;
                return;
            }
            let row = rows.get(c.giftId);
            if (!row) {
                if (rows.size >= giftLimit) {
                    dropped++;
                    return;
                }
                row = {
                    giftId: c.giftId,
                    names: [],
                    notifications: 0,
                    invalid: 0,
                    insufficient: 0,
                    giftTypes: [],
                    comboFlags: [],
                    withGroupId: 0,
                    withoutGroupId: 0,
                    repeatCountMin: null,
                    repeatCountMax: null,
                    repeatEndPending: 0,
                    repeatEndFinal: 0,
                    repeatEndMissing: 0,
                    notes: {},
                };
                rows.set(c.giftId, row);
            }
            row.notifications++;
            if (event.status === 'invalid') row.invalid++;
            if (event.status === 'insufficient') row.insufficient++;
            if (
                c.giftName &&
                c.giftName.length <= 128 &&
                !/[\u0000-\u001f\u007f]/u.test(c.giftName) &&
                !row.names.includes(c.giftName) &&
                row.names.length < 2
            )
                row.names.push(c.giftName);
            if (
                c.giftType !== null &&
                !row.giftTypes.includes(c.giftType) &&
                row.giftTypes.length < 8
            )
                row.giftTypes.push(c.giftType);
            if (c.combo !== null && !row.comboFlags.includes(c.combo))
                row.comboFlags.push(c.combo);
            if (c.sequenceId) row.withGroupId++;
            else row.withoutGroupId++;
            if (c.repeatCount !== null) {
                row.repeatCountMin = Math.min(
                    row.repeatCountMin ?? c.repeatCount,
                    c.repeatCount,
                );
                row.repeatCountMax = Math.max(
                    row.repeatCountMax ?? c.repeatCount,
                    c.repeatCount,
                );
            }
            if (c.repeatEnd === 1) row.repeatEndFinal++;
            else if (c.repeatEnd === 0) row.repeatEndPending++;
            else row.repeatEndMissing++;
            for (const note of trackedNotes)
                if (notes.includes(note))
                    row.notes[note] = (row.notes[note] ?? 0) + 1;
        },
        snapshot() {
            const result = {
                schema: 1,
                domain: 'observation',
                scoringEligible: false,
                semanticsConfirmed: false,
                provider: 'tiktok-live-connector@2.5.0',
                missingGiftIds,
                dropped,
                sampledNotifications: Math.min(samples, 30000),
                limits: {
                    gifts: giftLimit,
                    samples: 30000,
                    namesPerGift: 2,
                    nameLength: 128,
                },
                gifts: [...rows.values()].map((row) => ({
                    ...row,
                    names: [...row.names],
                    giftTypes: [...row.giftTypes],
                    comboFlags: [...row.comboFlags],
                    notes: { ...row.notes },
                    requiresOperatorReview: true,
                })),
            };
            // Bound the serialized report as well as memory. Dropped rows remain explicitly unreviewed.
            while (
                Buffer.byteLength(JSON.stringify(result, null, 4)) > 60000 &&
                result.gifts.length
            ) {
                result.dropped += result.gifts.pop()!.notifications;
            }
            return result;
        },
    };
}
export function withGiftReport(
    observer: ReturnType<typeof createEventObserver>,
    report: ReturnType<typeof createGiftReport>,
): ReturnType<typeof createEventObserver> {
    return {
        ...observer,
        observe(event) {
            const notes = observer.observe(event);
            report.observe(event, notes);
            return notes;
        },
    };
}
