import { randomUUID } from 'node:crypto';
import {
    parseCommand,
    rejected,
    record,
    identity,
    type State,
    type ServerMessage,
} from './protocol.ts';

export function createSimulationSession(enabled: boolean, capacity = 4096) {
    let state: State = {
        mode: 'simulation',
        sessionId: randomUUID(),
        version: 0,
        scores: { a: 0, b: 0 },
    };
    // Nunca evictar identidades: ao atingir o limite, novos comandos são rejeitados.
    const applied = new Map<string, string>();
    const snapshot = (): State => ({ ...state, scores: { ...state.scores } });
    return {
        snapshot,
        execute(
            value: unknown,
            authorized: boolean,
        ): {
            changed: boolean;
            message: ServerMessage;
        } {
            const id =
                record(value) && identity(value.correlationId)
                    ? value.correlationId
                    : null;
            const no = (code: string) => ({
                changed: false,
                message: rejected(id, code),
            });
            if (!enabled) return no('SIMULATION_DISABLED');
            if (!authorized) return no('UNAUTHORIZED');
            const command = parseCommand(value);
            if (!command) return no('INVALID_COMMAND');
            if (command.sessionId !== state.sessionId)
                return no('SESSION_MISMATCH');
            const fingerprint =
                command.type +
                (command.type === 'simulation.vote' ? ':' + command.side : '');
            const prior = applied.get(command.correlationId);
            if (prior !== undefined) {
                if (prior !== fingerprint) return no('ID_CONFLICT');
                return {
                    changed: false,
                    message: {
                        type: 'state.snapshot',
                        protocol: 1,
                        state: snapshot(),
                        correlationId: command.correlationId,
                    },
                };
            }
            if (applied.size >= capacity) return no('SESSION_CAPACITY');
            if (
                !Number.isSafeInteger(state.version + 1) ||
                (command.type === 'simulation.vote' &&
                    !Number.isSafeInteger(state.scores.a + state.scores.b + 1))
            ) {
                return no('STATE_LIMIT');
            }
            const scores =
                command.type === 'simulation.reset'
                    ? { a: 0, b: 0 }
                    : {
                          ...state.scores,
                          [command.side]: state.scores[command.side] + 1,
                      };
            state = { ...state, version: state.version + 1, scores };
            applied.set(command.correlationId, fingerprint);
            return {
                changed: true,
                message: {
                    type: 'state.updated',
                    protocol: 1,
                    state: snapshot(),
                    correlationId: command.correlationId,
                    effect:
                        command.type === 'simulation.reset'
                            ? { kind: 'reset' }
                            : { kind: 'vote', side: command.side },
                },
            };
        },
    };
}
