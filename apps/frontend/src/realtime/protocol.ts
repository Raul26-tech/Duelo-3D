import type { Side } from '../config/participants.ts';
export type RemoteState = {
    mode: 'simulation';
    sessionId: string;
    version: number;
    scores: { a: number; b: number };
};
export type StateMessage = {
    protocol: 1;
    type: 'state.snapshot' | 'state.updated';
    state: RemoteState;
    correlationId?: string;
    effect?: { kind: 'vote'; side: Side } | { kind: 'reset' };
};
function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseStateMessage(value: unknown): StateMessage | null {
    if (
        !object(value) ||
        value.protocol !== 1 ||
        (value.type !== 'state.snapshot' && value.type !== 'state.updated') ||
        !object(value.state)
    )
        return null;
    const state = value.state;
    if (
        state.mode !== 'simulation' ||
        typeof state.sessionId !== 'string' ||
        !/^[A-Za-z0-9_-]{16,64}$/.test(state.sessionId) ||
        !Number.isSafeInteger(state.version) ||
        Number(state.version) < 0 ||
        !object(state.scores)
    )
        return null;
    const { a, b } = state.scores;
    if (
        !Number.isSafeInteger(a) ||
        !Number.isSafeInteger(b) ||
        Number(a) < 0 ||
        Number(b) < 0 ||
        !Number.isSafeInteger(Number(a) + Number(b))
    )
        return null;
    if (value.type === 'state.updated') {
        const effect = value.effect;
        if (
            !object(effect) ||
            (effect.kind !== 'reset' &&
                !(
                    effect.kind === 'vote' &&
                    (effect.side === 'a' || effect.side === 'b')
                ))
        )
            return null;
    }
    return value as unknown as StateMessage;
}
