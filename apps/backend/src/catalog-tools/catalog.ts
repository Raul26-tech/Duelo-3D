import { fileURLToPath } from 'node:url';
import { createGiftCatalog } from '../scoring/catalog.ts';
import type { GiftRule } from '../scoring/contracts.ts';
import { exact, record } from '../scoring/validation.ts';
import { providerId } from '../tiktok/normalize.ts';
import {
    parseReviewedCatalog,
    type ReviewedGift,
} from '../integration/config.ts';
import { readLocalJson } from '../local-json.ts';

export type ReferenceGift = GiftRule &
    Readonly<{
        provenance: 'operator-reported-live' | 'external-unconfirmed';
        deliveryStatus: 'unreviewed';
        match?: 'id' | 'exact-name';
        ruleId?: string;
    }>;
export type GiftReview = Readonly<{
    giftId: string;
    match?: 'id' | 'exact-name';
    idConfirmed: boolean;
    observedName: string | null;
    nameConfirmed: boolean;
    connectorVersion: 'tiktok-live-connector@2.5.0';
    connectorFieldsReviewed: boolean;
    delivery: 'single' | 'cumulative-final' | null;
    repeatCount: 'unit' | 'cumulative' | null;
    repeatEnd: 'explicit-final' | null;
    groupId: 'not-required' | 'sequence' | null;
    operatorApproved: boolean;
}>;
export function parseReference(value: unknown): readonly ReferenceGift[] {
    if (!Array.isArray(value) || value.length !== 14)
        throw new Error('Reference must contain exactly 14 gifts');
    const rules = value.map((entry: unknown) => {
        if (
            !record(entry) ||
            !exact(entry, [
                'giftId',
                'name',
                'candidate',
                'points',
                'provenance',
                'deliveryStatus',
                ...(Object.hasOwn(entry, 'match')
                    ? [
                          'match',
                          ...(entry.match === 'exact-name' ? ['ruleId'] : []),
                      ]
                    : []),
            ]) ||
            typeof entry.giftId !== 'string' ||
            !providerId(entry.giftId) ||
            (entry.provenance !== 'operator-reported-live' &&
                entry.provenance !== 'external-unconfirmed') ||
            entry.deliveryStatus !== 'unreviewed' ||
            (Object.hasOwn(entry, 'match') &&
                entry.match !== 'id' &&
                entry.match !== 'exact-name') ||
            (entry.match === 'exact-name' &&
                (typeof entry.ruleId !== 'string' ||
                    !/^name:[a-z][a-z0-9-]{0,63}$/u.test(entry.ruleId)))
        )
            throw new Error('Invalid reference fields or provenance');
        return {
            giftId: entry.giftId,
            name: entry.name,
            candidate: entry.candidate,
            points: entry.points,
        };
    });
    const catalog = createGiftCatalog(rules);
    const ruleIds = value
        .filter((entry) => entry.match === 'exact-name')
        .map((entry) => entry.ruleId);
    if (
        new Set(ruleIds).size !== ruleIds.length ||
        new Set(value.map((entry) => entry.name)).size !== value.length
    )
        throw new Error('Ambiguous reference rules');
    return Object.freeze(
        value.map((entry) =>
            Object.freeze({
                ...(catalog.get(entry.giftId)! as GiftRule),
                provenance: entry.provenance,
                deliveryStatus: 'unreviewed' as const,
                ...(entry.match ? { match: entry.match } : {}),
                ...(entry.ruleId ? { ruleId: entry.ruleId } : {}),
            }),
        ),
    );
}
export function loadReference(): readonly ReferenceGift[] {
    return parseReference(
        readLocalJson(
            fileURLToPath(
                new URL(
                    '../../../../config/gift-catalog.reference.json',
                    import.meta.url,
                ),
            ),
        ),
    );
}
export function reviewTemplate(
    reference: readonly ReferenceGift[],
): readonly GiftReview[] {
    return Object.freeze(
        reference.map((entry) =>
            Object.freeze({
                giftId: entry.giftId,
                ...(entry.match ? { match: entry.match } : {}),
                idConfirmed: entry.provenance === 'operator-reported-live',
                observedName: null,
                nameConfirmed: false,
                connectorVersion: 'tiktok-live-connector@2.5.0' as const,
                connectorFieldsReviewed: false,
                delivery: null,
                repeatCount: null,
                repeatEnd: null,
                groupId: null,
                operatorApproved: false,
            }),
        ),
    );
}
export function parseReviews(
    value: unknown,
    reference: readonly ReferenceGift[],
): readonly GiftReview[] {
    if (!Array.isArray(value) || value.length > reference.length)
        throw new Error('Invalid gift review list');
    const seen = new Set<string>();
    const result = value.map((entry: unknown) => {
        if (
            !record(entry) ||
            !exact(entry, [
                'giftId',
                'idConfirmed',
                'observedName',
                'nameConfirmed',
                'connectorVersion',
                'connectorFieldsReviewed',
                'delivery',
                'repeatCount',
                'repeatEnd',
                'groupId',
                'operatorApproved',
                ...(Object.hasOwn(entry, 'match') ? ['match'] : []),
            ]) ||
            (Object.hasOwn(entry, 'match') &&
                entry.match !==
                    reference.find((gift) => gift.giftId === entry.giftId)
                        ?.match) ||
            typeof entry.giftId !== 'string' ||
            !reference.some((gift) => gift.giftId === entry.giftId) ||
            seen.has(entry.giftId) ||
            [
                'idConfirmed',
                'nameConfirmed',
                'connectorFieldsReviewed',
                'operatorApproved',
            ].some((key) => typeof entry[key] !== 'boolean') ||
            !(
                entry.observedName === null ||
                (typeof entry.observedName === 'string' &&
                    entry.observedName.length > 0 &&
                    entry.observedName.length <= 256 &&
                    !/[\u0000-\u001f\u007f]/u.test(entry.observedName))
            ) ||
            entry.connectorVersion !== 'tiktok-live-connector@2.5.0' ||
            !(
                entry.delivery === null ||
                entry.delivery === 'single' ||
                entry.delivery === 'cumulative-final'
            ) ||
            !(
                entry.repeatCount === null ||
                entry.repeatCount === 'unit' ||
                entry.repeatCount === 'cumulative'
            ) ||
            !(
                entry.repeatEnd === null || entry.repeatEnd === 'explicit-final'
            ) ||
            !(
                entry.groupId === null ||
                entry.groupId === 'not-required' ||
                entry.groupId === 'sequence'
            )
        )
            throw new Error('Invalid, unknown or duplicate gift review');
        seen.add(entry.giftId);
        return Object.freeze({ ...entry }) as GiftReview;
    });
    return Object.freeze(result);
}
export function pendingReview(
    gift: ReferenceGift,
    review?: GiftReview,
): readonly string[] {
    if (!review) return ['review_missing'];
    const missing: string[] = [];
    if (review.match !== 'exact-name' && !review.idConfirmed)
        missing.push('id_confirmation');
    if (!review.nameConfirmed || review.observedName !== gift.name)
        missing.push('exact_name_confirmation');
    if (!review.connectorFieldsReviewed) missing.push('connector_fields');
    if (!review.delivery) missing.push('delivery');
    if (
        review.repeatCount !==
        (review.delivery === 'single' ? 'unit' : 'cumulative')
    )
        missing.push('repeatCount_semantics');
    if (review.repeatEnd !== 'explicit-final')
        missing.push('repeatEnd_semantics');
    if (
        review.groupId !==
        (review.delivery === 'single' ? 'not-required' : 'sequence')
    )
        missing.push('groupId_semantics');
    if (!review.operatorApproved) missing.push('operator_approval');
    return Object.freeze(missing);
}
export function prepareActive(
    reference: readonly ReferenceGift[],
    input: unknown,
): readonly ReviewedGift[] {
    const reviews = parseReviews(input, reference);
    const active: ReviewedGift[] = [];
    for (const review of reviews) {
        if (!review.operatorApproved) continue;
        const gift = reference.find((entry) => entry.giftId === review.giftId)!;
        const missing = pendingReview(gift, review);
        if (missing.length)
            throw new Error(
                `Gift ${gift.giftId} not eligible: ${missing.join(', ')}`,
            );
        active.push({
            ...(review.match === 'exact-name'
                ? { match: 'exact-name' as const, ruleId: gift.ruleId! }
                : {
                      giftId: gift.giftId,
                      ...(review.match ? { match: 'id' as const } : {}),
                  }),
            name: gift.name,
            candidate: gift.candidate,
            points: gift.points,
            delivery: review.delivery!,
        });
    }
    return parseReviewedCatalog(active);
}
export function verifyActive(
    reference: readonly ReferenceGift[],
    reviews: unknown,
    operational: unknown,
) {
    const expected = prepareActive(reference, reviews);
    const actual = parseReviewedCatalog(operational);
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(
            'Operational catalog differs from explicit authorized reviews',
        );
    return actual;
}
