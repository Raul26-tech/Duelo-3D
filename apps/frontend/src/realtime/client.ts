import type { Side } from '../config/participants.ts';
import { createReplica } from './replica.ts';
import type { StateMessage } from './protocol.ts';

export type ConnectionStatus =
    'disconnected' | 'connecting' | 'connected' | 'unauthorized';
export function reconnectDelay(attempt: number) {
    return Math.min(8000, 500 * 2 ** Math.min(attempt, 4));
}
export function createRealtimeClient(options: {
    url: string;
    onState(message: StateMessage): void;
    onStatus(status: ConnectionStatus): void;
    onRejected?(code: string): void;
    socketFactory?: (url: string) => WebSocket;
    schedule?: typeof setTimeout;
    cancel?: typeof clearTimeout;
    idFactory?: () => string;
}) {
    const replica = createReplica();
    const schedule = options.schedule ?? setTimeout;
    const cancel = options.cancel ?? clearTimeout;
    const id = options.idFactory ?? (() => crypto.randomUUID());
    let socket: WebSocket | null = null;
    let token = '';
    let generation = 0;
    let attempt = 0;
    let ready = false;
    let stopped = true;
    let denied = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const status = (value: ConnectionStatus) => {
        ready = value === 'connected';
        options.onStatus(value);
    };
    function connect() {
        if (stopped || denied) return;
        const current = ++generation;
        replica.beginConnection();
        status('connecting');
        try {
            socket = (options.socketFactory ?? ((url) => new WebSocket(url)))(
                options.url,
            );
        } catch {
            reconnect();
            return;
        }
        const connection = socket;
        deadline = schedule(() => connection.close(), 7000);
        connection.onopen = () => {
            if (current !== generation) return;
            connection.send(
                JSON.stringify({
                    type: 'simulation.authorize',
                    correlationId: id(),
                    token,
                }),
            );
        };
        connection.onmessage = (event) => {
            if (
                current !== generation ||
                typeof event.data !== 'string' ||
                event.data.length > 16384
            )
                return;
            let value: unknown;
            try {
                value = JSON.parse(event.data);
            } catch {
                return;
            }
            if (
                value &&
                typeof value === 'object' &&
                'type' in value &&
                value.type === 'command.rejected' &&
                'code' in value &&
                typeof value.code === 'string'
            ) {
                options.onRejected?.(value.code);
                if (value.code === 'UNAUTHORIZED') {
                    denied = true;
                    status('unauthorized');
                    connection.close();
                }
                return;
            }
            const message = replica.accept(value);
            if (!message) return;
            cancel(deadline);
            attempt = 0;
            status('connected');
            options.onState(message);
        };
        connection.onerror = () => connection.close();
        connection.onclose = () => {
            if (current !== generation) return;
            cancel(deadline);
            if (!denied) status('disconnected');
            reconnect();
        };
    }
    function reconnect() {
        if (stopped || denied) return;
        cancel(retry);
        retry = schedule(connect, reconnectDelay(attempt++));
    }
    function send(type: 'simulation.vote' | 'simulation.reset', side?: Side) {
        const state = replica.getState();
        if (!ready || !state || socket?.readyState !== 1) return false;
        const command = {
            type,
            correlationId: id(),
            mode: 'simulation',
            sessionId: state.sessionId,
            ...(side ? { side } : {}),
        };
        // Sem fila/reenvio: resultado incerto será reconciliado por snapshot.
        try {
            socket.send(JSON.stringify(command));
            return true;
        } catch {
            socket.close();
            return false;
        }
    }
    return {
        authorize(value: string) {
            if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) return false;
            ++generation;
            cancel(retry);
            cancel(deadline);
            socket?.close();
            token = value;
            stopped = false;
            denied = false;
            attempt = 0;
            connect();
            return true;
        },
        vote(side: Side) {
            return send('simulation.vote', side);
        },
        reset() {
            return send('simulation.reset');
        },
        close() {
            stopped = true;
            token = '';
            ++generation;
            cancel(retry);
            cancel(deadline);
            socket?.close();
            status('disconnected');
        },
    };
}
