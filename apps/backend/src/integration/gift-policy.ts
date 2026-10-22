import { createGiftCatalog, giftRuleKey } from '../scoring/catalog.ts';
import type { CatalogGiftRule } from '../scoring/contracts.ts';
import { record } from '../scoring/validation.ts';
import { providerId } from '../tiktok/normalize.ts';

export type ReviewedGift = CatalogGiftRule &
    Readonly<{ delivery: 'single' | 'cumulative-final' }>;
export function parseReviewedCatalog(value: unknown): readonly ReviewedGift[] {
    if (!Array.isArray(value) || value.length > 1000)
        throw new Error('Invalid reviewed gift catalog');
    const stripped = value.map((entry: unknown) => {
        if (
            !record(entry) ||
            (entry.delivery !== 'single' &&
                entry.delivery !== 'cumulative-final')
        )
            throw new Error('Each gift needs reviewed delivery');
        const { delivery: _delivery, ...rule } = entry;
        if (
            rule.match !== 'exact-name' &&
            (typeof rule.giftId !== 'string' || !providerId(rule.giftId))
        )
            throw new Error('Each ID gift needs a real decimal ID');
        return rule;
    });
    if (new Set(stripped.map((rule) => rule.name)).size !== stripped.length)
        throw new Error('Ambiguous duplicate gift names');
    const catalog = createGiftCatalog(stripped);
    return Object.freeze(
        value
            .map(
                (entry, index) =>
                    Object.freeze({
                        ...catalog.get(
                            giftRuleKey(stripped[index] as CatalogGiftRule),
                        )!,
                        delivery: entry.delivery,
                    }) as ReviewedGift,
            )
            .sort((a, b) =>
                giftRuleKey(a) < giftRuleKey(b)
                    ? -1
                    : giftRuleKey(a) > giftRuleKey(b)
                      ? 1
                      : 0,
            ),
    );
}
