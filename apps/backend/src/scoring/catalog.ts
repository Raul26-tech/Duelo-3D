import type { GiftRule } from './contracts.ts';
import { exact, normalizeId, record } from './validation.ts';

/** No guessed platform IDs or candidate assignments. Configured only by a trusted caller. */
export const DEFAULT_GIFT_CATALOG: readonly GiftRule[] = Object.freeze([]);

export function createGiftCatalog(
    input: unknown,
): ReadonlyMap<string, GiftRule> {
    if (!Array.isArray(input) || input.length > 10_000)
        throw new Error('Invalid gift catalog');
    const catalog = new Map<string, GiftRule>();
    for (const entry of input) {
        if (
            !record(entry) ||
            !exact(entry, ['giftId', 'name', 'candidate', 'points'])
        )
            throw new Error('Invalid gift rule fields');
        const giftId = normalizeId(entry.giftId);
        if (
            !giftId ||
            typeof entry.name !== 'string' ||
            entry.name.trim().length === 0 ||
            entry.name.length > 256 ||
            (entry.candidate !== 'lula' && entry.candidate !== 'flavio') ||
            typeof entry.points !== 'number' ||
            !Number.isSafeInteger(entry.points) ||
            entry.points <= 0 ||
            catalog.has(giftId)
        )
            throw new Error('Invalid or duplicate gift rule');
        catalog.set(
            giftId,
            Object.freeze({
                giftId,
                name: entry.name,
                candidate: entry.candidate,
                points: entry.points,
            }) as GiftRule,
        );
    }
    return catalog;
}
