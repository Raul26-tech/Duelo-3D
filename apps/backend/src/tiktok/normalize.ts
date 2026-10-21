import type { Observation } from './contracts.ts';

const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

/** Pinned v3 protobuf fields are decimal uint64 strings; zero is a decoded placeholder. */
export function providerId(value: unknown): string | null {
    if (typeof value === 'bigint')
        return value > 0n ? providerId(String(value)) : null;
    if (typeof value === 'number')
        return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    return typeof value === 'string' && /^[1-9][0-9]{0,127}$/.test(value)
        ? value
        : null;
}

export function normalizeProviderEvent(
    kind: 'comment' | 'gift',
    payload: unknown,
    room: unknown,
): Observation {
    const reasons: string[] = [
        'DIAGNOSTIC_ONLY',
        'PROVIDER_SEMANTICS_UNVERIFIED',
    ];
    let invalid = false;
    const data = object(payload);
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
        invalid = true;
        reasons.push('MALFORMED_PAYLOAD');
    }
    const common = object(data.common);
    const user = object(data.user);
    const gift = object(data.gift);
    const connectionRoomId = providerId(room);
    const id = (value: unknown, field: string, required = true) => {
        const result = providerId(value);
        if (!result && required) reasons.push(`MISSING_OR_INVALID_${field}`);
        if (
            value !== undefined &&
            value !== null &&
            value !== '' &&
            value !== '0' &&
            value !== 0 &&
            !result
        ) {
            reasons.push(`INVALID_${field}`);
            invalid = true;
        }
        return result;
    };
    const roomId = id(common.roomId, 'ROOM_ID');
    const eventId = id(common.msgId, 'EVENT_ID');
    const userId = id(user.id, 'USER_ID');
    if (!connectionRoomId) reasons.push('MISSING_CONNECTION_ROOM');
    if (roomId && connectionRoomId && roomId !== connectionRoomId) {
        reasons.push('ROOM_CONFLICT');
        invalid = true;
    }
    const text = (
        value: unknown,
        maximum: number,
        field: string,
        required: boolean,
    ) => {
        if (typeof value === 'string' && value.length <= maximum) return value;
        if (required || value !== undefined) reasons.push(`INVALID_${field}`);
        if (value !== undefined || required) invalid = true;
        return null;
    };
    const content =
        kind === 'comment' ? text(data.content, 4096, 'CONTENT', true) : null;
    const giftId = kind === 'gift' ? id(data.giftId, 'GIFT_ID') : null;
    const nestedGiftId =
        kind === 'gift' ? id(gift.id, 'NESTED_GIFT_ID', false) : null;
    if (nestedGiftId && giftId && nestedGiftId !== giftId) {
        invalid = true;
        reasons.push('GIFT_ID_CONFLICT');
    }
    const giftName =
        kind === 'gift' ? text(gift.name, 256, 'GIFT_NAME', false) : null;
    const sequenceId =
        kind === 'gift' ? id(data.groupId, 'SEQUENCE_ID', false) : null;
    const repeatCount =
        kind === 'gift' &&
        typeof data.repeatCount === 'number' &&
        Number.isSafeInteger(data.repeatCount) &&
        data.repeatCount > 0
            ? data.repeatCount
            : null;
    const repeatEnd =
        kind === 'gift' && (data.repeatEnd === 0 || data.repeatEnd === 1)
            ? data.repeatEnd
            : null;
    const giftType =
        kind === 'gift' &&
        typeof gift.type === 'number' &&
        Number.isSafeInteger(gift.type) &&
        gift.type >= 0
            ? gift.type
            : null;
    const combo =
        kind === 'gift' && typeof gift.combo === 'boolean' ? gift.combo : null;
    if (kind === 'gift') {
        if (repeatCount === null) {
            reasons.push('INVALID_REPEAT_COUNT');
            invalid = true;
        }
        if (repeatEnd === null) reasons.push('MISSING_OR_INVALID_FINAL_FLAG');
        if (giftType === null) reasons.push('MISSING_OR_INVALID_GIFT_TYPE');
        if (!sequenceId) reasons.push('SEQUENCE_ID_UNPROVEN');
        if (giftType === 1 && combo === false)
            reasons.push('DEFAULTABLE_COMBO_FLAG');
        if (giftType !== null && giftType !== 1 && combo === true) {
            reasons.push('DELIVERY_FLAGS_CONFLICT');
            invalid = true;
        }
    }
    const delivery =
        giftType === 1 || combo === true
            ? 'combo-candidate'
            : giftType !== null
              ? 'individual-candidate'
              : 'unknown';
    const insufficient =
        !roomId ||
        !connectionRoomId ||
        !eventId ||
        !userId ||
        (kind === 'comment'
            ? content === null || content.length === 0
            : !giftId ||
              !repeatCount ||
              giftType === null ||
              repeatEnd === null ||
              (delivery === 'combo-candidate' && !sequenceId));
    return Object.freeze({
        schema: 1,
        provider: 'tiktok-live-connector@2.5.0',
        domain: 'observation',
        scoringEligible: false,
        kind,
        status: invalid
            ? 'invalid'
            : insufficient
              ? 'insufficient'
              : 'candidate-unverified',
        reasons: Object.freeze(reasons),
        connectionRoomId,
        confirmed: Object.freeze({
            roomId,
            eventId,
            userId,
            text: content,
            giftId,
            giftName,
            sequenceId,
            repeatCount,
            repeatEnd,
            giftType,
            combo,
        }),
        inferred: Object.freeze({
            delivery,
            phase:
                repeatEnd === 1
                    ? 'explicit-final-flag'
                    : repeatEnd === 0 && delivery === 'combo-candidate'
                      ? 'pending-candidate'
                      : 'unknown',
        }),
    });
}
