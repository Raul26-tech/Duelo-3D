import {
    ADMIN_ORIGIN,
    isAdminEvent,
    type AuditOperation,
    type AdminEvent,
    type SourceLink,
} from './administration.ts';
import { randomUUID } from 'node:crypto';
import type {
    Candidate,
    Decision,
    Domain,
    EngineCheckpoint,
    GiftEvent,
    Snapshot,
    RulesVersion,
} from './contracts.ts';
import { CURRENT_RULES_VERSION } from './contracts.ts';
import {
    createGiftCatalog,
    DEFAULT_GIFT_CATALOG,
    giftRuleKey,
    matchGift,
} from './catalog.ts';
import { interpretComment } from './comments.ts';
import {
    eventIdentity,
    fingerprint,
    normalizeId,
    parseEvent,
} from './validation.ts';

type Sequence = {
    actorId?: string;
    giftId: string;
    quantity: number;
    final: boolean;
    invalid: boolean;
};
export type EngineOptions = Readonly<{
    origin: string;
    roomId: string;
    domain: Domain;
    catalog?: unknown;
    capacity?: number;
    rulesVersion?: RulesVersion;
    /** Server-only opt-in. It is not parsed from an event. */
    enableRealScoring?: true;
    sourcePolicy?: string;
}>;

/** Single domain engine. Real ingress additionally requires explicit server opt-in. */
export function createScoringEngine(
    options: EngineOptions,
    sessionId: string = randomUUID(),
) {
    const origin = normalizeId(options.origin);
    const roomId = normalizeId(options.roomId);
    const domain = options.domain;
    const capacity = options.capacity ?? 10_000;
    const rulesVersion = options.rulesVersion ?? CURRENT_RULES_VERSION;
    if (
        typeof sessionId !== 'string' ||
        !normalizeId(sessionId) ||
        !origin ||
        !roomId ||
        (rulesVersion !== 'scoring-v1' && rulesVersion !== 'scoring-v2') ||
        (!['simulation', 'observation'].includes(domain) &&
            !(domain === 'real' && options.enableRealScoring === true)) ||
        (options.sourcePolicy !== undefined &&
            (typeof options.sourcePolicy !== 'string' ||
                options.sourcePolicy.length > 8192)) ||
        !Number.isSafeInteger(capacity) ||
        capacity < 1 ||
        capacity > 10_000
    )
        throw new Error(
            'Invalid scoring engine configuration; real scoring is disabled',
        );
    const catalog = createGiftCatalog(options.catalog ?? DEFAULT_GIFT_CATALOG);
    const hybridCatalog = [...catalog.values()].some(
        (rule) => rule.match !== undefined,
    );
    let version = 0;
    let scores = { lula: 0, flavio: 0 };
    const events = new Map<string, string>();
    const sequences = new Map<string, Sequence>();
    const operations = new Map<string, AuditOperation>();
    const claims = new Map<string, string>();
    const linkKeys = (link: SourceLink) => [
        JSON.stringify(['event', link.eventId]),
        ...(link.sequenceId
            ? [JSON.stringify(['sequence', link.actorId, link.sequenceId])]
            : []),
    ];
    function administer(
        event: AdminEvent,
        identity: string,
        content: string,
    ): Decision {
        if (event.sessionId !== sessionId)
            return result('rejected', 'SESSION_MISMATCH', identity);
        const prior = events.get(identity);
        if (prior !== undefined)
            return result(
                prior === content ? 'duplicate' : 'rejected',
                prior === content
                    ? 'EVENT_ALREADY_PROCESSED'
                    : 'IDENTITY_CONFLICT',
                identity,
            );
        if (events.size + sequences.size + 1 > capacity)
            return result('rejected', 'CAPACITY_REACHED', identity);
        let candidate: Candidate,
            points: number,
            ruleId: string,
            quantity: number,
            link: SourceLink | null,
            reference: string | null;
        if (event.type === 'admin.award') {
            const rule = catalog.get(event.ruleId);
            if (!rule || rule.candidate !== event.candidate)
                return result('rejected', 'UNAUTHORIZED_RULE', identity);
            const original = event.correctionOf
                ? operations.get(event.correctionOf)
                : undefined;
            if (
                event.correctionOf &&
                (!original ||
                    original.type !== 'admin.award' ||
                    original.state !== 'reversed' ||
                    [...operations.values()].some(
                        (op) =>
                            op.type === 'admin.award' &&
                            op.reference === event.correctionOf,
                    ))
            )
                return result('rejected', 'INVALID_CORRECTION', identity);
            if (event.link) {
                const sourceIdentity = JSON.stringify([
                    origin,
                    roomId,
                    domain,
                    'gift',
                    event.link.eventId,
                ]);
                const oldSequence = JSON.stringify([
                    origin,
                    roomId,
                    domain,
                    event.link.sequenceId,
                ]);
                const newSequence = JSON.stringify([
                    origin,
                    roomId,
                    domain,
                    event.link.sequenceId,
                    event.link.actorId,
                ]);
                if (
                    events.has(sourceIdentity) ||
                    (event.link.sequenceId &&
                        (sequences.has(oldSequence) ||
                            sequences.has(newSequence)))
                )
                    return result(
                        'rejected',
                        'SOURCE_ALREADY_RECORDED',
                        identity,
                    );
                if (
                    linkKeys(event.link).some(
                        (key) =>
                            claims.has(key) &&
                            claims.get(key) !== event.correctionOf,
                    )
                )
                    return result(
                        'rejected',
                        'SOURCE_ALREADY_CLAIMED',
                        identity,
                    );
            }
            candidate = rule.candidate;
            points = rule.points * event.quantity;
            ruleId = event.ruleId;
            quantity = event.quantity;
            link = event.link;
            reference = event.correctionOf;
        } else {
            const original = operations.get(event.targetOperationId);
            if (!original || original.type !== 'admin.award')
                return result('rejected', 'OPERATION_NOT_FOUND', identity);
            if (original.state === 'reversed')
                return result('rejected', 'ALREADY_REVERSED', identity);
            candidate = original.candidate;
            points = -original.points;
            ruleId = original.ruleId;
            quantity = original.quantity;
            link = original.link;
            reference = original.operationId;
        }
        if (
            !Number.isSafeInteger(points) ||
            !Number.isSafeInteger(scores[candidate] + points) ||
            scores[candidate] + points < 0 ||
            !Number.isSafeInteger(scores.lula + scores.flavio + points) ||
            !Number.isSafeInteger(version + 1)
        )
            return result('rejected', 'SCORE_LIMIT', identity);
        if (event.appliedPoints !== undefined && event.appliedPoints !== points)
            return result('rejected', 'INVALID_AUDIT_POINTS', identity);
        events.set(identity, content);
        scores = { ...scores, [candidate]: scores[candidate] + points };
        version++;
        if (event.type === 'admin.reversal')
            operations.set(
                reference!,
                Object.freeze({
                    ...operations.get(reference!)!,
                    state: 'reversed',
                }),
            );
        if (event.type === 'admin.award' && link)
            for (const key of linkKeys(link)) claims.set(key, event.eventId);
        operations.set(
            event.eventId,
            Object.freeze({
                operationId: event.eventId,
                operatorId: event.actorId!,
                at: event.at,
                type: event.type,
                candidate,
                ruleId,
                quantity,
                points,
                justification: event.justification,
                reference,
                link: link ? Object.freeze({ ...link }) : null,
                state: 'applied',
                version,
            }),
        );
        return result(
            'applied',
            event.type === 'admin.award' ? 'ADMIN_AWARDED' : 'ADMIN_REVERSED',
            identity,
            candidate,
            points,
        );
    }
    const snapshot = (): Snapshot =>
        Object.freeze({
            sessionId,
            domain,
            version,
            scores: Object.freeze({ ...scores }),
        });
    const result = (
        status: Decision['status'],
        reason: string,
        identity?: string,
        candidate?: Candidate,
        points = 0,
    ): Decision =>
        Object.freeze({
            status,
            reason,
            identity,
            candidate,
            points,
            state: snapshot(),
        });
    const sequenceKey = (event: GiftEvent) =>
        JSON.stringify([
            event.origin,
            event.roomId,
            event.domain,
            event.delivery.kind === 'combo' ? event.delivery.sequenceId : null,
            ...(event.giftPolicy && hybridCatalog
                ? [event.actorId ?? null]
                : []),
        ]);

    function process(value: unknown): Decision {
        const event = parseEvent(value);
        if (!event) return result('rejected', 'INVALID_EVENT');
        if (
            event.domain !== domain ||
            (isAdminEvent(event)
                ? event.origin !== ADMIN_ORIGIN || domain !== 'real'
                : event.origin !== origin) ||
            event.roomId !== roomId
        )
            return result('rejected', 'UNAUTHORIZED_CONTEXT');
        const identity = eventIdentity(event);
        const content = fingerprint(event);
        if (isAdminEvent(event)) return administer(event, identity, content);
        const previous = events.get(identity);
        if (previous !== undefined) {
            if (previous === content)
                return result('duplicate', 'EVENT_ALREADY_PROCESSED', identity);
            // Quarantine uncommitted sequences implicated by a contradictory notification.
            if (event.type === 'gift' && event.delivery.kind === 'combo') {
                const sequence = sequences.get(sequenceKey(event));
                if (sequence && !sequence.final) sequence.invalid = true;
            }
            // The original sequence can differ from the contradictory payload's sequence.
            const old = JSON.parse(previous) as unknown[];
            if (old[0] === 'gift' && old[2] === 'combo') {
                const sequence = sequences.get(
                    JSON.stringify([
                        origin,
                        roomId,
                        domain,
                        old[4],
                        ...(hybridCatalog && old[7] === 'hybrid-v1'
                            ? [old[6] ?? null]
                            : []),
                    ]),
                );
                if (sequence && !sequence.final) sequence.invalid = true;
            }
            return result('rejected', 'IDENTITY_CONFLICT', identity);
        }
        const key =
            event.type === 'gift' && event.delivery.kind === 'combo'
                ? sequenceKey(event)
                : null;
        const needsSequence = key !== null && !sequences.has(key);
        if (events.size + sequences.size + 1 + Number(needsSequence) > capacity)
            return result('rejected', 'CAPACITY_REACHED', identity);
        // Record even valid non-votes, so later contradictory replays cannot become votes.
        const remember = () => events.set(identity, content);
        if (event.domain === 'observation') {
            remember();
            return result('ignored', 'OBSERVATION_ONLY', identity);
        }
        if (event.type === 'gift') {
            const keys = linkKeys({
                eventId: event.eventId,
                actorId: event.actorId ?? '',
                sequenceId:
                    event.delivery.kind === 'combo'
                        ? event.delivery.sequenceId
                        : null,
            });
            if (keys.some((key) => claims.has(key))) {
                remember();
                return result(
                    'rejected',
                    'MANUAL_RECONCILIATION_REQUIRED',
                    identity,
                );
            }
        }
        let candidate: Candidate | null;
        let points: number;
        let nextSequence: Sequence | undefined;
        if (event.type === 'comment') {
            candidate = interpretComment(event.text, rulesVersion);
            points = 1;
            if (!candidate) {
                remember();
                return result('ignored', 'NO_UNIQUE_CANDIDATE', identity);
            }
        } else {
            const match = event.giftPolicy
                ? matchGift(
                      [...catalog.values()],
                      event.giftId,
                      event.giftName ?? null,
                  )
                : undefined;
            const resolvedKey = match?.rule
                ? giftRuleKey(match.rule)
                : event.giftId;
            const rule = event.giftPolicy
                ? match?.rule
                : catalog.get(event.giftId);
            if (
                event.giftPolicy &&
                event.giftRuleId !== (match?.rule ? resolvedKey : null)
            ) {
                remember();
                return result('rejected', 'GIFT_RULE_CONFLICT', identity);
            }
            const activeSequence =
                key === null ? undefined : sequences.get(key);
            if (
                activeSequence &&
                (activeSequence.giftId !== resolvedKey ||
                    activeSequence.actorId !== event.actorId)
            ) {
                if (!activeSequence.final) activeSequence.invalid = true;
                remember();
                return result('rejected', 'COMBO_CONFLICT', identity);
            }
            if (!rule) {
                if (event.giftPolicy && activeSequence && !activeSequence.final)
                    activeSequence.invalid = true;
                remember();
                return result(
                    'rejected',
                    event.giftPolicy ? match!.reason : 'UNKNOWN_GIFT',
                    identity,
                );
            }
            // Name rules cannot be addressed by a fabricated external gift ID or legacy event.
            if (rule.match !== undefined && !event.giftPolicy) {
                remember();
                return result('rejected', 'UNKNOWN_GIFT', identity);
            }
            candidate = rule.candidate;
            points = rule.points * event.delivery.quantity;
            if (event.delivery.kind === 'combo' && key !== null) {
                const previousSequence = sequences.get(key);
                if (previousSequence) {
                    if (
                        previousSequence.invalid ||
                        previousSequence.giftId !== resolvedKey ||
                        event.delivery.quantity < previousSequence.quantity ||
                        (previousSequence.final &&
                            (!event.delivery.final ||
                                event.delivery.quantity !==
                                    previousSequence.quantity))
                    ) {
                        if (!previousSequence.final)
                            previousSequence.invalid = true;
                        remember();
                        return result('rejected', 'COMBO_CONFLICT', identity);
                    }
                    if (previousSequence.final) {
                        remember();
                        return result(
                            'duplicate',
                            'COMBO_ALREADY_PROCESSED',
                            identity,
                        );
                    }
                }
                nextSequence = {
                    ...(event.actorId ? { actorId: event.actorId } : {}),
                    giftId: resolvedKey,
                    quantity: event.delivery.quantity,
                    final: event.delivery.final,
                    invalid: false,
                };
                if (!event.delivery.final) {
                    sequences.set(key, nextSequence);
                    remember();
                    return result('ignored', 'COMBO_PENDING', identity);
                }
            }
        }
        if (
            !Number.isSafeInteger(points) ||
            !Number.isSafeInteger(scores[candidate] + points) ||
            !Number.isSafeInteger(scores.lula + scores.flavio + points) ||
            !Number.isSafeInteger(version + 1)
        )
            return result('rejected', 'SCORE_LIMIT', identity);
        // Synchronous commit: dedup, sequence, score and version before returning for publication.
        remember();
        if (key !== null && nextSequence) sequences.set(key, nextSequence);
        scores = { ...scores, [candidate]: scores[candidate] + points };
        version += 1;
        return result('applied', 'SCORED', identity, candidate, points);
    }
    const configuration = Object.freeze({
        origin,
        roomId,
        domain,
        capacity,
        rulesVersion,
        ...(options.sourcePolicy !== undefined
            ? { sourcePolicy: options.sourcePolicy }
            : {}),
        catalog: Object.freeze(
            [...catalog.values()].sort((a, b) =>
                giftRuleKey(a) < giftRuleKey(b)
                    ? -1
                    : giftRuleKey(a) > giftRuleKey(b)
                      ? 1
                      : 0,
            ),
        ),
    });
    const checkpoint = (): EngineCheckpoint =>
        Object.freeze({
            configuration,
            state: snapshot(),
            events: Object.freeze(
                [...events]
                    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                    .map(([identity, fingerprint]) =>
                        Object.freeze({ identity, fingerprint }),
                    ),
            ),
            sequences: Object.freeze(
                [...sequences]
                    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                    .map(([identity, sequence]) =>
                        Object.freeze({ identity, ...sequence }),
                    ),
            ),
        });
    return Object.freeze({
        process,
        snapshot,
        checkpoint,
        auditHistory: () => Object.freeze([...operations.values()]),
    });
}
