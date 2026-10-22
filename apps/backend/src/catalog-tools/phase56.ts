import { giftRuleKey } from '../scoring/catalog.ts';
import { parseReviewedCatalog } from '../integration/gift-policy.ts';
import { prepareActive, type ReferenceGift } from './catalog.ts';

// Public operator report, not a grant of authority and never loaded by the runtime.
const reportedAuthorized = new Set(['5655', '5487', '8239', '14488']);
export function catalogStatus(
    reference: readonly ReferenceGift[],
    operational?: unknown,
) {
    const active =
        operational === undefined
            ? undefined
            : parseReviewedCatalog(operational);
    if (
        active?.some(
            (rule) =>
                !reference.some(
                    (gift) =>
                        giftRuleKey(rule) ===
                        (rule.match === 'exact-name'
                            ? gift.ruleId
                            : gift.giftId),
                ),
        )
    )
        throw new Error('Operational rule is outside the operator reference');
    return reference.map((gift) => {
        const rule = active?.find(
            (rule) =>
                giftRuleKey(rule) ===
                (rule.match === 'exact-name' ? gift.ruleId : gift.giftId),
        );
        if (
            rule &&
            (rule.name !== gift.name ||
                rule.candidate !== gift.candidate ||
                rule.points !== gift.points)
        )
            throw new Error(
                'Operational rule contradicts the operator reference',
            );
        return {
            referenceGiftId: gift.giftId,
            name: gift.name,
            candidate: gift.candidate,
            points: gift.points,
            proposedMatch: gift.match ?? 'id',
            ...(gift.ruleId ? { ruleId: gift.ruleId } : {}),
            idEvidence: gift.provenance,
            referenceIdRole:
                gift.match === 'exact-name'
                    ? 'historical-only'
                    : 'operator-reported-id',
            reportedAuthorization: reportedAuthorized.has(gift.giftId)
                ? 'operator-reported-authorized'
                : 'pending',
            configured:
                active === undefined
                    ? 'not-inspected'
                    : rule
                      ? 'present'
                      : 'absent',
            reviewedDelivery: rule?.delivery ?? null,
            authorizationGrantedByThisTool: false,
        };
    });
}

/** Full explicit reviews are required, including every previously authorized rule.
 * Preserve the exact operational contract as well as points/delivery: SQLite binds it.
 * Writes are performed only by the existing new-file-only CLI infrastructure. */
export function prepareExtension(
    reference: readonly ReferenceGift[],
    baseline: unknown,
    reviews: unknown,
) {
    const previous = parseReviewedCatalog(baseline);
    catalogStatus(reference, baseline);
    const next = prepareActive(reference, reviews);
    for (const rule of previous) {
        const found = next.find(
            (item) => giftRuleKey(item) === giftRuleKey(rule),
        );
        if (JSON.stringify(found) !== JSON.stringify(rule))
            throw new Error(
                'Extension must preserve every existing rule, match, points and delivery; full explicit reviews required',
            );
    }
    return next;
}
