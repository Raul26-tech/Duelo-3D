import type { ScoringEvent } from '../scoring/contracts.ts';
import { normalizeProviderEvent } from '../tiktok/normalize.ts';
import type { ReviewedGift } from './config.ts';

export const TIKTOK_ORIGIN = 'tiktok-live-connector@2.5.0';
export type IngressResult =
    { event: ScoringEvent; reason?: never } | { event?: never; reason: string };

/** Called ONLY with raw callbacks from our active, connected provider. Not a network API.
 * Observation envelopes cannot be promoted by changing their domain.
 * The room is confirmed by connect(), and the policy is supplied by the operator, not payloads.
 */
export function validateRealOccurrence(
    kind: 'comment' | 'gift',
    raw: unknown,
    connectedRoom: string,
    expectedRoom: string,
    gifts: readonly ReviewedGift[],
): IngressResult {
    if (connectedRoom !== expectedRoom)
        return { reason: 'SOURCE_ROOM_MISMATCH' };
    if (
        !raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        ['domain', 'origin', 'scoringEligible', 'schema'].some((key) =>
            Object.hasOwn(raw, key),
        )
    )
        return { reason: 'NOT_RAW_PROVIDER_PAYLOAD' };
    const checked = normalizeProviderEvent(kind, raw, connectedRoom);
    const c = checked.confirmed;
    if (
        checked.status !== 'candidate-unverified' ||
        !c.roomId ||
        !c.eventId ||
        !c.userId
    )
        return { reason: 'UNPROVEN_OR_CONTRADICTORY_IDENTITY' };
    const identity = {
        origin: TIKTOK_ORIGIN,
        roomId: connectedRoom,
        domain: 'real' as const,
        eventId: c.eventId,
        actorId: c.userId,
    };
    if (kind === 'comment')
        return { event: { ...identity, type: 'comment', text: c.text! } };
    const rule = gifts.find((entry) => entry.giftId === c.giftId);
    // A complete unknown gift is submitted only for the engine's durable UNKNOWN_GIFT
    // rejection, so a contradictory later payload cannot reuse its admitted identity.
    // No catalog entry means no possible points, regardless of this structural delivery.
    const delivery =
        rule?.delivery ?? (c.giftType === 1 ? 'cumulative-final' : 'single');
    if (delivery === 'single') {
        if (
            c.giftType === null ||
            c.giftType === 1 ||
            c.combo !== false ||
            c.repeatCount !== 1 ||
            c.repeatEnd !== 1
        )
            return { reason: 'UNPROVEN_SINGLE_DELIVERY' };
        return {
            event: {
                ...identity,
                type: 'gift',
                giftId: c.giftId!,
                delivery: { kind: 'single', quantity: 1 },
            },
        };
    }
    if (
        c.giftType !== 1 ||
        c.combo !== true ||
        !c.sequenceId ||
        c.repeatCount === null ||
        c.repeatEnd === null
    )
        return { reason: 'UNPROVEN_COMBO_LIFECYCLE' };
    return {
        event: {
            ...identity,
            type: 'gift',
            giftId: c.giftId!,
            delivery: {
                kind: 'combo',
                sequenceId: c.sequenceId,
                quantity: c.repeatCount,
                final: c.repeatEnd === 1,
            },
        },
    };
}
