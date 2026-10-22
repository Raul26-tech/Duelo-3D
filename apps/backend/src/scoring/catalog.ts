import type { CatalogGiftRule } from './contracts.ts';
import { exact, normalizeId, record } from './validation.ts';
export const DEFAULT_GIFT_CATALOG: readonly CatalogGiftRule[] = Object.freeze(
    [],
);
export const giftRuleKey = (rule: CatalogGiftRule): string =>
    rule.match === 'exact-name' ? rule.ruleId : rule.giftId;

/** Literal comparison: no case, whitespace, translation or substring normalization. */
export function createGiftCatalog(
    input: unknown,
): ReadonlyMap<string, CatalogGiftRule> {
    if (!Array.isArray(input) || input.length > 10_000)
        throw new Error('Invalid gift catalog');
    const catalog = new Map<string, CatalogGiftRule>();
    const names = new Set<string>();
    const hybrid = input.some(
        (entry) => record(entry) && Object.hasOwn(entry, 'match'),
    );
    for (const entry of input) {
        if (!record(entry)) throw new Error('Invalid gift rule fields');
        const byName = entry.match === 'exact-name';
        const modern = Object.hasOwn(entry, 'match');
        if (
            !exact(entry, [
                byName ? 'ruleId' : 'giftId',
                'name',
                'candidate',
                'points',
                ...(modern ? ['match'] : []),
            ]) ||
            (modern && entry.match !== 'id' && !byName)
        )
            throw new Error('Invalid gift rule fields');
        const key = normalizeId(byName ? entry.ruleId : entry.giftId);
        if (
            !key ||
            (byName && !/^name:[a-z][a-z0-9-]{0,63}$/u.test(key)) ||
            (modern && !byName && key.startsWith('name:')) ||
            typeof entry.name !== 'string' ||
            entry.name.trim().length === 0 ||
            entry.name.length > 256 ||
            (modern && /[\u0000-\u001f\u007f]/u.test(entry.name)) ||
            (entry.candidate !== 'lula' && entry.candidate !== 'flavio') ||
            typeof entry.points !== 'number' ||
            !Number.isSafeInteger(entry.points) ||
            entry.points <= 0 ||
            catalog.has(key) ||
            (hybrid && names.has(entry.name))
        )
            throw new Error('Invalid, ambiguous or duplicate gift rule');
        names.add(entry.name);
        catalog.set(
            key,
            Object.freeze({
                ...(byName
                    ? { match: 'exact-name', ruleId: key }
                    : { giftId: key, ...(modern ? { match: 'id' } : {}) }),
                name: entry.name,
                candidate: entry.candidate,
                points: entry.points,
            }) as CatalogGiftRule,
        );
    }
    return catalog;
}
export type GiftMatch = {
    rule?: CatalogGiftRule;
    reason:
        | 'MATCH_BY_ID'
        | 'MATCH_BY_EXACT_NAME'
        | 'NAME_NOT_AUTHORIZED'
        | 'ID_NAME_CONFLICT'
        | 'AMBIGUOUS_GIFT';
};
export function matchGift(
    rules: readonly CatalogGiftRule[],
    giftId: string,
    name: string | null,
): GiftMatch {
    const idRule = rules.find(
        (rule) => rule.match !== 'exact-name' && rule.giftId === giftId,
    );
    // A confirmed ID/name contradiction takes precedence; never fall back to a name rule.
    if (idRule && name !== null && name !== idRule.name)
        return { reason: 'ID_NAME_CONFLICT' };
    const matches = rules.filter((rule) =>
        rule.match === 'exact-name'
            ? name === rule.name
            : rule.giftId === giftId,
    );
    if (matches.length > 1) return { reason: 'AMBIGUOUS_GIFT' };
    const rule = matches[0];
    return rule
        ? {
              rule,
              reason:
                  rule.match === 'exact-name'
                      ? 'MATCH_BY_EXACT_NAME'
                      : 'MATCH_BY_ID',
          }
        : { reason: 'NAME_NOT_AUTHORIZED' };
}
