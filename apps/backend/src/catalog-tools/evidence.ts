import { exact, record } from '../scoring/validation.ts';
import { providerId } from '../tiktok/normalize.ts';
import type { ReferenceGift } from './catalog.ts';
import { catalogStatus } from './phase56.ts';

const count = (v: unknown, max = 30000): v is number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
const optionalCount = (v: unknown): v is number | null =>
    v === null || (count(v, Number.MAX_SAFE_INTEGER) && v > 0);
const publicName = (v: unknown): v is string =>
    typeof v === 'string' &&
    v.length > 0 &&
    v.length <= 128 &&
    !/[\u0000-\u001f\u007f]/u.test(v);
const noteNames = [
    'retransmission_candidate',
    'identity_conflict',
    'count_repeated',
    'count_increased',
    'out_of_order',
    'explicit_final',
    'sequence_context_conflict',
    'sequence_interrupted',
    'tracking_capacity',
    'sequence_unidentifiable',
    'started_above_one',
    'final_without_prior',
    'after_final',
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
    notes: Partial<Record<(typeof noteNames)[number], number>>;
    requiresOperatorReview: true;
    evidence?: {
        withOccurrenceId: number;
        withoutUserId: number;
        withoutMatchingRoom: number;
        missingName: number;
        namesDropped: number;
        samplesDropped: number;
        samples: {
            repeatCount: number | null;
            repeatEnd: 0 | 1 | null;
            hasGroupId: boolean;
        }[];
    };
};
/** Accept only the bounded public aggregate contract. Never copy arbitrary input fields. */
export function parseGiftEvidence(value: unknown) {
    if (
        !record(value) ||
        !exact(value, [
            'schema',
            'domain',
            'scoringEligible',
            'semanticsConfirmed',
            'provider',
            'missingGiftIds',
            'dropped',
            'sampledNotifications',
            'limits',
            'gifts',
            ...(Object.hasOwn(value, 'evidenceVersion')
                ? ['evidenceVersion']
                : []),
        ]) ||
        value.schema !== 1 ||
        value.domain !== 'observation' ||
        value.scoringEligible !== false ||
        value.semanticsConfirmed !== false ||
        value.provider !== 'tiktok-live-connector@2.5.0' ||
        (value.evidenceVersion !== undefined && value.evidenceVersion !== 1) ||
        !count(value.missingGiftIds) ||
        !count(value.dropped, Number.MAX_SAFE_INTEGER) ||
        !count(value.sampledNotifications) ||
        !Array.isArray(value.gifts) ||
        value.gifts.length > 32 ||
        !record(value.limits)
    )
        throw new Error('Invalid observation-only gift report');
    const limits = value.limits;
    if (
        !exact(limits, [
            'gifts',
            'samples',
            'namesPerGift',
            'nameLength',
            ...(value.evidenceVersion === 1 ? ['samplesPerGift'] : []),
        ]) ||
        !count(limits.gifts, 32) ||
        limits.gifts < 1 ||
        value.gifts.length > limits.gifts ||
        limits.samples !== 30000 ||
        limits.namesPerGift !== 2 ||
        limits.nameLength !== 128 ||
        (value.evidenceVersion === 1 && limits.samplesPerGift !== 8)
    )
        throw new Error('Invalid report limits');
    const ids = new Set<string>();
    let notifications = value.missingGiftIds;
    const gifts: Row[] = value.gifts.map((raw: unknown) => {
        if (
            !record(raw) ||
            !exact(raw, [
                'giftId',
                'names',
                'notifications',
                'invalid',
                'insufficient',
                'giftTypes',
                'comboFlags',
                'withGroupId',
                'withoutGroupId',
                'repeatCountMin',
                'repeatCountMax',
                'repeatEndPending',
                'repeatEndFinal',
                'repeatEndMissing',
                'notes',
                'requiresOperatorReview',
                ...(value.evidenceVersion === 1 ? ['evidence'] : []),
            ]) ||
            typeof raw.giftId !== 'string' ||
            !providerId(raw.giftId) ||
            ids.has(raw.giftId) ||
            !Array.isArray(raw.names) ||
            raw.names.length > 2 ||
            !raw.names.every(publicName) ||
            new Set(raw.names).size !== raw.names.length ||
            !Array.isArray(raw.giftTypes) ||
            raw.giftTypes.length > 8 ||
            !raw.giftTypes.every((v) => count(v, Number.MAX_SAFE_INTEGER)) ||
            !Array.isArray(raw.comboFlags) ||
            raw.comboFlags.length > 2 ||
            !raw.comboFlags.every((v) => typeof v === 'boolean') ||
            !record(raw.notes) ||
            Object.keys(raw.notes).some(
                (key) =>
                    !noteNames.includes(key as (typeof noteNames)[number]) ||
                    !count((raw.notes as Record<string, unknown>)[key]),
            ) ||
            raw.requiresOperatorReview !== true
        )
            throw new Error('Invalid gift evidence row');
        const n = raw.notifications;
        if (
            !count(n) ||
            n === 0 ||
            [
                'invalid',
                'insufficient',
                'withGroupId',
                'withoutGroupId',
                'repeatEndPending',
                'repeatEndFinal',
                'repeatEndMissing',
            ].some((key) => !count(raw[key]) || (raw[key] as number) > n) ||
            (raw.invalid as number) + (raw.insufficient as number) > n ||
            (raw.withGroupId as number) + (raw.withoutGroupId as number) !==
                n ||
            (raw.repeatEndPending as number) +
                (raw.repeatEndFinal as number) +
                (raw.repeatEndMissing as number) !==
                n ||
            !optionalCount(raw.repeatCountMin) ||
            !optionalCount(raw.repeatCountMax) ||
            (raw.repeatCountMin === null) !== (raw.repeatCountMax === null) ||
            (raw.repeatCountMin !== null &&
                raw.repeatCountMax !== null &&
                raw.repeatCountMin > raw.repeatCountMax) ||
            Object.values(raw.notes).some((note) => (note as number) > n)
        )
            throw new Error('Contradictory evidence counters');
        if (value.evidenceVersion === 1) {
            const e = raw.evidence;
            if (
                !record(e) ||
                !exact(e, [
                    'withOccurrenceId',
                    'withoutUserId',
                    'withoutMatchingRoom',
                    'missingName',
                    'namesDropped',
                    'samplesDropped',
                    'samples',
                ]) ||
                [
                    'withOccurrenceId',
                    'withoutUserId',
                    'withoutMatchingRoom',
                    'missingName',
                    'namesDropped',
                    'samplesDropped',
                ].some((key) => !count(e[key]) || (e[key] as number) > n) ||
                !Array.isArray(e.samples) ||
                e.samples.length > 8 ||
                e.samples.length + (e.samplesDropped as number) !== n ||
                !e.samples.every(
                    (sample) =>
                        record(sample) &&
                        exact(sample, [
                            'repeatCount',
                            'repeatEnd',
                            'hasGroupId',
                        ]) &&
                        optionalCount(sample.repeatCount) &&
                        [0, 1, null].includes(
                            sample.repeatEnd as number | null,
                        ) &&
                        typeof sample.hasGroupId === 'boolean',
                )
            )
                throw new Error(
                    'Invalid identity coverage or notification samples',
                );
        }
        ids.add(raw.giftId);
        notifications += n;
        // Parsing has admitted only the exact whitelist and bounded scalar values.
        return structuredClone(raw) as Row;
    });
    if (
        notifications > value.sampledNotifications ||
        value.sampledNotifications > notifications + value.dropped
    )
        throw new Error('Inconsistent report totals');
    return {
        gifts,
        missingGiftIds: value.missingGiftIds,
        dropped: value.dropped,
        sampledNotifications: value.sampledNotifications,
    };
}

/** Observations inform a human review only. This result is NOT a review or active catalog. */
export function assessGiftEvidence(
    reference: readonly ReferenceGift[],
    input: unknown,
) {
    const report = parseGiftEvidence(input);
    const candidates = catalogStatus(reference).map((item) => {
        const gift = reference.find((g) => g.giftId === item.referenceGiftId)!;
        const observations = report.gifts.filter(
            (row) =>
                row.giftId === gift.giftId || row.names.includes(gift.name),
        );
        const concerns = new Set<string>();
        if (!observations.length) concerns.add('not_observed');
        if (report.dropped) concerns.add('report_incomplete');
        for (const row of observations) {
            if (gift.match !== 'exact-name' && row.giftId !== gift.giftId)
                concerns.add('id_mismatch_no_name_fallback');
            if (
                gift.match !== 'exact-name' &&
                row.giftId === gift.giftId &&
                row.names.some((name) => name !== gift.name)
            )
                concerns.add('id_name_contradiction');
            if (
                gift.match === 'exact-name' &&
                row.giftId === gift.giftId &&
                !row.names.includes(gift.name)
            )
                concerns.add('historical_id_is_not_identity');
            if (
                gift.match === 'exact-name' &&
                reference.some(
                    (other) =>
                        other.match === 'id' &&
                        other.giftId === row.giftId &&
                        other.name !== gift.name,
                )
            )
                concerns.add('id_belongs_to_another_reference');
            if (
                row.giftTypes.some((type) => type !== 1) &&
                (row.repeatCountMin !== 1 ||
                    row.repeatCountMax !== 1 ||
                    row.repeatEndPending)
            )
                concerns.add('single_delivery_not_unit_final');
            if (!row.names.includes(gift.name))
                concerns.add('expected_literal_name_not_observed');
            if (row.names.length !== 1)
                concerns.add('name_missing_or_ambiguous');
            if (row.invalid || row.insufficient)
                concerns.add('invalid_or_insufficient_payloads');
            if (!row.evidence)
                concerns.add('identity_coverage_unavailable_in_legacy_report');
            else if (
                row.evidence.withOccurrenceId !== row.notifications ||
                row.evidence.withoutUserId ||
                row.evidence.withoutMatchingRoom ||
                row.evidence.missingName ||
                row.evidence.namesDropped
            )
                concerns.add('incomplete_identity_or_name_evidence');
            if (row.repeatEndMissing || !row.repeatEndFinal)
                concerns.add('explicit_finalization_not_demonstrated');
            if (row.giftTypes.includes(1) && row.withoutGroupId)
                concerns.add('combo_group_id_missing');
            if (
                row.giftTypes.length !== 1 ||
                row.comboFlags.length !== 1 ||
                (row.giftTypes[0] === 1
                    ? row.comboFlags[0] !== true
                    : row.comboFlags[0] !== false)
            )
                concerns.add('delivery_flags_inconsistent');
            for (const note of [
                'identity_conflict',
                'out_of_order',
                'sequence_context_conflict',
                'sequence_unidentifiable',
                'tracking_capacity',
                'after_final',
            ] as const)
                if (row.notes[note]) concerns.add(note);
        }
        return {
            ...item,
            observedGiftIds: observations.map((row) => row.giftId),
            concerns: [...concerns],
            identityConfirmedByThisTool: false,
            operatorReviewRequired: true,
            deliveryAuthorizedByThisTool: null,
        };
    });
    const assessment = {
        schema: 'gift-validation-phase56-v1',
        domain: 'observation',
        scoringEligible: false,
        authorizationGranted: false,
        provider: 'tiktok-live-connector@2.5.0',
        summary: {
            candidates: 14,
            operatorReportedAuthorized: 4,
            pending: 10,
            sampledNotifications: report.sampledNotifications,
            missingGiftIds: report.missingGiftIds,
            dropped: report.dropped,
        },
        candidates,
        observations: report.gifts,
        unrecognizedGiftIds: report.gifts
            .filter(
                (row) =>
                    !reference.some(
                        (gift) =>
                            row.giftId === gift.giftId ||
                            row.names.includes(gift.name),
                    ),
            )
            .map((row) => row.giftId),
        limitations: [
            'Aggregate notification samples may interleave different sequences.',
            'Provider fields and synthetic tests are not official platform guarantees.',
            'Observed evidence never confirms identity, delivery or operational authorization automatically.',
            'No database, environment, active catalog or dispute is modified.',
        ],
    };
    if (Buffer.byteLength(JSON.stringify(assessment, null, 4)) > 60000)
        throw new Error(
            'Assessment exceeds bounded output; collect shorter diagnostic runs',
        );
    return assessment;
}
