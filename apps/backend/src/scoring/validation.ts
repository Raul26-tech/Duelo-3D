import type { ScoringEvent } from './contracts.ts';

export function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function exact(value: Record<string, unknown>, keys: string[]): boolean {
    return (
        Object.keys(value).length === keys.length &&
        keys.every((key) => Object.hasOwn(value, key))
    );
}

/** Numeric IDs must be exact before conversion; unsafe numbers are never repaired. */
export function normalizeId(value: unknown): string | null {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
    }
    if (typeof value === 'bigint')
        return value >= 0n ? normalizeId(String(value)) : null;
    return typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 256 &&
        value.trim() === value &&
        !/[\u0000-\u001f\u007f]/u.test(value)
        ? value
        : null;
}

export function parseEvent(value: unknown): ScoringEvent | null {
    if (
        !record(value) ||
        (value.domain !== 'simulation' && value.domain !== 'observation')
    )
        return null;
    const common = ['origin', 'roomId', 'domain', 'eventId', 'type'];
    const origin = normalizeId(value.origin);
    const roomId = normalizeId(value.roomId);
    const eventId = normalizeId(value.eventId);
    if (!origin || !roomId || !eventId) return null;
    const identity = {
        origin,
        roomId,
        eventId,
        domain: value.domain as ScoringEvent['domain'],
    };
    if (value.type === 'comment') {
        if (
            !exact(value, [...common, 'text']) ||
            typeof value.text !== 'string' ||
            value.text.length > 4096
        )
            return null;
        return { ...identity, type: 'comment', text: value.text };
    }
    if (
        value.type !== 'gift' ||
        !exact(value, [...common, 'giftId', 'delivery'])
    )
        return null;
    const giftId = normalizeId(value.giftId);
    const delivery = value.delivery;
    if (!giftId || !record(delivery)) return null;
    if (
        delivery.kind === 'single' &&
        exact(delivery, ['kind', 'quantity']) &&
        delivery.quantity === 1
    ) {
        return {
            ...identity,
            type: 'gift',
            giftId,
            delivery: { kind: 'single', quantity: 1 },
        };
    }
    const sequenceId = normalizeId(delivery.sequenceId);
    if (
        delivery.kind !== 'combo' ||
        !exact(delivery, ['kind', 'sequenceId', 'quantity', 'final']) ||
        !sequenceId ||
        typeof delivery.quantity !== 'number' ||
        !Number.isSafeInteger(delivery.quantity) ||
        delivery.quantity < 1 ||
        typeof delivery.final !== 'boolean'
    )
        return null;
    return {
        ...identity,
        type: 'gift',
        giftId,
        delivery: {
            kind: 'combo',
            sequenceId,
            quantity: delivery.quantity,
            final: delivery.final,
        },
    };
}

export function eventIdentity(event: ScoringEvent): string {
    return JSON.stringify([
        event.origin,
        event.roomId,
        event.domain,
        event.type,
        event.eventId,
    ]);
}

/** Stable order independent of caller property order, including normalized IDs. */
export function fingerprint(event: ScoringEvent): string {
    return JSON.stringify(
        event.type === 'comment'
            ? [event.type, event.text]
            : [
                  event.type,
                  event.giftId,
                  event.delivery.kind,
                  event.delivery.quantity,
                  event.delivery.kind === 'combo'
                      ? event.delivery.sequenceId
                      : null,
                  event.delivery.kind === 'combo' ? event.delivery.final : null,
              ],
    );
}
