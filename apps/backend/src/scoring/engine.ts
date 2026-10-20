import { randomUUID } from 'node:crypto';
import type {
    Candidate,
    Decision,
    Domain,
    GiftEvent,
    Snapshot,
} from './contracts.ts';
import { createGiftCatalog, DEFAULT_GIFT_CATALOG } from './catalog.ts';
import { interpretComment } from './comments.ts';
import {
    eventIdentity,
    fingerprint,
    normalizeId,
    parseEvent,
} from './validation.ts';

type Sequence = {
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
}>;

/** In-memory, server-internal simulation/observation engine. No real scoring ingress. */
export function createScoringEngine(options: EngineOptions) {
    const origin = normalizeId(options.origin);
    const roomId = normalizeId(options.roomId);
    const domain = options.domain;
    const capacity = options.capacity ?? 10_000;
    if (
        !origin ||
        !roomId ||
        !['simulation', 'observation'].includes(domain) ||
        !Number.isSafeInteger(capacity) ||
        capacity < 1 ||
        capacity > 10_000
    )
        throw new Error(
            'Invalid scoring engine configuration; real scoring is disabled',
        );
    const catalog = createGiftCatalog(options.catalog ?? DEFAULT_GIFT_CATALOG);
    const sessionId = randomUUID();
    let version = 0;
    let scores = { lula: 0, flavio: 0 };
    const events = new Map<string, string>();
    const sequences = new Map<string, Sequence>();
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
        ]);

    function process(value: unknown): Decision {
        const event = parseEvent(value);
        if (!event) return result('rejected', 'INVALID_EVENT');
        if (
            event.domain !== domain ||
            event.origin !== origin ||
            event.roomId !== roomId
        )
            return result('rejected', 'UNAUTHORIZED_CONTEXT');
        const identity = eventIdentity(event);
        const content = fingerprint(event);
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
                    JSON.stringify([origin, roomId, domain, old[4]]),
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
        let candidate: Candidate | null;
        let points: number;
        let nextSequence: Sequence | undefined;
        if (event.type === 'comment') {
            candidate = interpretComment(event.text);
            points = 1;
            if (!candidate) {
                remember();
                return result('ignored', 'NO_UNIQUE_CANDIDATE', identity);
            }
        } else {
            const activeSequence =
                key === null ? undefined : sequences.get(key);
            if (activeSequence && activeSequence.giftId !== event.giftId) {
                if (!activeSequence.final) activeSequence.invalid = true;
                remember();
                return result('rejected', 'COMBO_CONFLICT', identity);
            }
            const rule = catalog.get(event.giftId);
            if (!rule) {
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
                        previousSequence.giftId !== event.giftId ||
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
                    giftId: event.giftId,
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
    return Object.freeze({ process, snapshot });
}
