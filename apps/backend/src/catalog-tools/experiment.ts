import { createHash } from 'node:crypto';
import {
    parseReviewedCatalog,
    type ReviewedGift,
} from '../integration/gift-policy.ts';
import { exact, record } from '../scoring/validation.ts';
import { giftRuleKey } from '../scoring/catalog.ts';
import { loadReference } from './catalog.ts';
import { catalogStatus } from './phase56.ts';

const priorIds = ['5655', '5487', '8239', '14488'];
export type ExperimentPlan = {
    schema: 'gift-experiment-plan-v1';
    purpose: 'experimental-homologation';
    operator: string;
    acceptExperimentalRisks: boolean;
    baseline: readonly ReviewedGift[];
    baselineDigest: string;
    hypotheses: {
        referenceGiftId: string;
        delivery: 'single' | 'cumulative-final' | null;
        acceptsAssumption: boolean;
        rationale: string;
    }[];
};
function baselineRules(value: unknown) {
    const rules = parseReviewedCatalog(value);
    catalogStatus(loadReference(), rules);
    if (
        rules.length !== 4 ||
        rules.some(
            (rule) =>
                rule.match === 'exact-name' ||
                !priorIds.includes(giftRuleKey(rule)),
        )
    )
        throw new Error(
            'Select the four existing authorized ID rules explicitly; their delivery policies cannot be invented',
        );
    return rules;
}
const baselineDigest = (rules: readonly ReviewedGift[]) =>
    createHash('sha256').update(JSON.stringify(rules)).digest('hex');
export function experimentTemplate(baseline: unknown): ExperimentPlan {
    return {
        schema: 'gift-experiment-plan-v1',
        purpose: 'experimental-homologation',
        operator: '',
        acceptExperimentalRisks: false,
        baseline: baselineRules(baseline),
        baselineDigest: baselineDigest(baselineRules(baseline)),
        hypotheses: loadReference()
            .filter((gift) => !priorIds.includes(gift.giftId))
            .map((gift) => ({
                referenceGiftId: gift.giftId,
                delivery: null,
                acceptsAssumption: false,
                rationale: '',
            })),
    };
}
export function parseExperimentPlan(value: unknown): ExperimentPlan {
    if (
        !record(value) ||
        !exact(value, [
            'schema',
            'purpose',
            'operator',
            'acceptExperimentalRisks',
            'baseline',
            'baselineDigest',
            'hypotheses',
        ]) ||
        value.schema !== 'gift-experiment-plan-v1' ||
        value.purpose !== 'experimental-homologation' ||
        typeof value.operator !== 'string' ||
        (value.operator !== '' &&
            !/^[a-zA-Z0-9_.-]{3,64}$/u.test(value.operator)) ||
        typeof value.acceptExperimentalRisks !== 'boolean' ||
        !Array.isArray(value.hypotheses) ||
        value.hypotheses.length !== 10
    )
        throw new Error('Invalid experimental plan');
    if (
        typeof value.baselineDigest !== 'string' ||
        value.baselineDigest !== baselineDigest(baselineRules(value.baseline))
    )
        throw new Error('Baseline copy changed since template creation');
    const expected = new Set(
        loadReference()
            .filter((gift) => !priorIds.includes(gift.giftId))
            .map((gift) => gift.giftId),
    );
    for (const h of value.hypotheses) {
        if (
            !record(h) ||
            !exact(h, [
                'referenceGiftId',
                'delivery',
                'acceptsAssumption',
                'rationale',
            ]) ||
            typeof h.referenceGiftId !== 'string' ||
            !expected.delete(h.referenceGiftId) ||
            ![null, 'single', 'cumulative-final'].includes(
                h.delivery as string | null,
            ) ||
            typeof h.acceptsAssumption !== 'boolean' ||
            typeof h.rationale !== 'string' ||
            h.rationale.length > 512 ||
            /[\u0000-\u001f\u007f]/u.test(h.rationale)
        )
            throw new Error('Invalid or duplicate experimental hypothesis');
    }
    return {
        schema: 'gift-experiment-plan-v1',
        purpose: 'experimental-homologation',
        operator: value.operator,
        acceptExperimentalRisks: value.acceptExperimentalRisks,
        baseline: baselineRules(value.baseline),
        baselineDigest: value.baselineDigest,
        hypotheses: structuredClone(value.hypotheses),
    } as ExperimentPlan;
}
export function experimentStatus(input: unknown) {
    const plan = parseExperimentPlan(input);
    return loadReference().map((gift) => {
        const old = plan.baseline.find(
            (rule) => giftRuleKey(rule) === gift.giftId,
        );
        const h = plan.hypotheses.find(
            (item) => item.referenceGiftId === gift.giftId,
        );
        const pending: string[] = [];
        if (!old) {
            if (!plan.operator || !plan.acceptExperimentalRisks)
                pending.push('operator_risk_acceptance');
            if (!h?.delivery) pending.push('delivery_hypothesis');
            if (!h?.acceptsAssumption)
                pending.push('explicit_assumption_acceptance');
            if (!h || h.rationale.trim().length < 16)
                pending.push('assumption_rationale');
        }
        return {
            name: gift.name,
            candidate: gift.candidate,
            points: gift.points,
            referenceGiftId: gift.giftId,
            match: old?.match ?? gift.match ?? 'id',
            delivery: old?.delivery ?? h?.delivery ?? null,
            evidence: old
                ? 'existing-operator-authorized'
                : 'unverified-experimental-assumption',
            operationallyValidatedByThisTool: false,
            pending,
        };
    });
}
export function prepareExperiment(input: unknown, originalBaseline?: unknown) {
    const plan = parseExperimentPlan(input);
    if (
        originalBaseline !== undefined &&
        baselineDigest(baselineRules(originalBaseline)) !== plan.baselineDigest
    )
        throw new Error(
            'Selected baseline differs from the original authorized four rules',
        );
    const pending = experimentStatus(plan).filter(
        (item) => item.pending.length,
    );
    if (pending.length)
        throw new Error(
            'Experimental rules pending: ' +
                pending
                    .map((item) => `${item.name}: ${item.pending.join(',')}`)
                    .join('; '),
        );
    const additional = plan.hypotheses.map((h) => {
        const gift = loadReference().find(
            (gift) => gift.giftId === h.referenceGiftId,
        )!;
        return {
            ...(gift.match === 'exact-name'
                ? { match: 'exact-name', ruleId: gift.ruleId }
                : { match: 'id', giftId: gift.giftId }),
            name: gift.name,
            candidate: gift.candidate,
            points: gift.points,
            delivery: h.delivery,
        };
    });
    const rules = parseReviewedCatalog([...plan.baseline, ...additional]);
    return {
        schema: 'gift-experiment-v1' as const,
        purpose: 'experimental-homologation' as const,
        productionValidated: false as const,
        plan,
        rules,
    };
}
export function parseExperimentManifest(input: unknown) {
    if (
        !record(input) ||
        !exact(input, [
            'schema',
            'purpose',
            'productionValidated',
            'plan',
            'rules',
        ]) ||
        input.schema !== 'gift-experiment-v1' ||
        input.purpose !== 'experimental-homologation' ||
        input.productionValidated !== false
    )
        throw new Error(
            'Invalid experimental manifest; not a validated operational catalog',
        );
    const manifest = prepareExperiment(input.plan);
    if (
        JSON.stringify(parseReviewedCatalog(input.rules)) !==
        JSON.stringify(manifest.rules)
    )
        throw new Error('Experimental rules contradict the explicit plan');
    return {
        manifest,
        digest: createHash('sha256')
            .update(JSON.stringify(manifest))
            .digest('hex'),
    };
}
