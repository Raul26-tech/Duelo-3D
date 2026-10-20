export type Side = 'a' | 'b';
export type State = {
    mode: 'simulation';
    sessionId: string;
    version: number;
    scores: { a: number; b: number };
};
export type Command =
    | {
          type: 'simulation.vote';
          correlationId: string;
          mode: 'simulation';
          sessionId: string;
          side: Side;
      }
    | {
          type: 'simulation.reset';
          correlationId: string;
          mode: 'simulation';
          sessionId: string;
      };
export type Effect = { kind: 'vote'; side: Side } | { kind: 'reset' };
export type ServerMessage =
    | {
          type: 'state.snapshot';
          protocol: 1;
          state: State;
          correlationId?: string;
      }
    | {
          type: 'state.updated';
          protocol: 1;
          state: State;
          correlationId: string;
          effect: Effect;
      }
    | {
          type: 'command.rejected';
          protocol: 1;
          correlationId: string | null;
          code: string;
      };

export function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function exact(value: Record<string, unknown>, keys: string[]) {
    return (
        Object.keys(value).length === keys.length &&
        keys.every((key) => Object.hasOwn(value, key))
    );
}
export function identity(value: unknown): value is string {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{16,64}$/.test(value);
}
export function parseCommand(value: unknown): Command | null {
    if (
        !record(value) ||
        !identity(value.correlationId) ||
        !identity(value.sessionId) ||
        value.mode !== 'simulation'
    )
        return null;
    if (
        value.type === 'simulation.vote' &&
        exact(value, ['type', 'correlationId', 'mode', 'sessionId', 'side']) &&
        (value.side === 'a' || value.side === 'b')
    )
        return value as Command;
    if (
        value.type === 'simulation.reset' &&
        exact(value, ['type', 'correlationId', 'mode', 'sessionId'])
    )
        return value as Command;
    return null;
}
export function rejected(
    correlationId: string | null,
    code: string,
): ServerMessage {
    return { type: 'command.rejected', protocol: 1, correlationId, code };
}
