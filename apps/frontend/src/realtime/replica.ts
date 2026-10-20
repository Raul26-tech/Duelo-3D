import {
    parseStateMessage,
    type RemoteState,
    type StateMessage,
} from './protocol.ts';

export function createReplica() {
    let state: RemoteState | null = null;
    let needsSnapshot = true;
    return {
        beginConnection() {
            needsSnapshot = true;
        },
        getState(): RemoteState | null {
            return state ? { ...state, scores: { ...state.scores } } : null;
        },
        accept(value: unknown): StateMessage | null {
            const message = parseStateMessage(value);
            if (!message) return null;
            const next = message.state;
            if (needsSnapshot && message.type !== 'state.snapshot') return null;
            if (!needsSnapshot && state?.sessionId !== next.sessionId)
                return null;
            if (
                state?.sessionId === next.sessionId &&
                next.version < state.version
            )
                return null;
            if (!needsSnapshot && state && next.version <= state.version)
                return null;
            state = { ...next, scores: { ...next.scores } };
            needsSnapshot = false;
            return {
                ...message,
                state: { ...state, scores: { ...state.scores } },
            };
        },
    };
}
