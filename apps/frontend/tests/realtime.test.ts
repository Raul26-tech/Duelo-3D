import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplica } from '../src/realtime/replica.ts';
import {
    createRealtimeClient,
    reconnectDelay,
} from '../src/realtime/client.ts';

function message(version = 0, sessionId = 'session_012345678901') {
    return {
        type: 'state.snapshot',
        protocol: 1,
        state: {
            mode: 'simulation',
            sessionId,
            version,
            scores: { a: version, b: 0 },
        },
    };
}
function updated(version = 1, sessionId = 'session_012345678901') {
    return {
        ...message(version, sessionId),
        type: 'state.updated',
        effect: { kind: 'vote', side: 'a' },
    };
}
class FakeSocket {
    readyState = 0;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    send(value: string) {
        this.sent.push(value);
    }
    close() {
        this.readyState = 3;
        this.onclose?.();
    }
    open() {
        this.readyState = 1;
        this.onopen?.();
    }
    receive(value: unknown) {
        this.onmessage?.({ data: JSON.stringify(value) });
    }
}
function setup() {
    const sockets: FakeSocket[] = [];
    const states: unknown[] = [];
    const statuses: string[] = [];
    const timers = new Map<number, { fn: () => void; delay: number }>();
    let timerId = 0;
    const schedule = ((fn: () => void, delay: number) => {
        const id = ++timerId;
        timers.set(id, { fn, delay });
        return id;
    }) as unknown as typeof setTimeout;
    const cancel = ((id: number) => {
        timers.delete(id);
    }) as unknown as typeof clearTimeout;
    const client = createRealtimeClient({
        url: 'ws://127.0.0.1/realtime',
        onState: (state) => states.push(state),
        onStatus: (status) => statuses.push(status),
        socketFactory() {
            const socket = new FakeSocket();
            sockets.push(socket);
            return socket as unknown as WebSocket;
        },
        schedule,
        cancel,
        idFactory: () => 'command_012345678901',
    });
    return { client, sockets, states, statuses, timers };
}
const token = 'test_token_012345678901234567890123456789';

test('réplica exige snapshot e ignora sessões, versões e modos indevidos', () => {
    const replica = createReplica();
    assert.equal(replica.accept(updated()), null);
    assert.ok(replica.accept(message()));
    assert.ok(replica.accept(updated(2)));
    assert.equal(replica.accept(updated(1)), null);
    assert.equal(replica.accept(updated(3, 'old_session_0123456789')), null);
    const bad = message(3);
    bad.state.mode = 'real';
    assert.equal(replica.accept(bad), null);
    assert.equal(replica.getState()?.version, 2);
});
test('snapshot de reconexão substitui estado e permite sessão reiniciada', () => {
    const replica = createReplica();
    replica.accept(message(5));
    replica.beginConnection();
    assert.equal(replica.accept(updated(6)), null);
    assert.equal(replica.accept(message(4)), null);
    assert.ok(replica.accept(message(5)));
    replica.beginConnection();
    assert.ok(replica.accept(message(0, 'new_session_0123456789')));
    assert.equal(replica.getState()?.version, 0);
    assert.equal(replica.accept(updated(7)), null);
});
test('valida limites de pontuação e preserva a cópia do estado autorizado', () => {
    const replica = createReplica();
    const bad = message();
    bad.state.scores.a = -1;
    assert.equal(replica.accept(bad), null);
    replica.accept(message(2));
    const copy = replica.getState();
    assert.ok(copy);
    copy.scores.a = 999;
    assert.equal(replica.getState()?.scores.a, 2);
    assert.equal(
        replica.accept({ ...updated(3), effect: { kind: 'vote', side: 'x' } }),
        null,
    );
});

test('voto e reset enviam comandos sem atualizar o estado otimisticamente', () => {
    const s = setup();
    assert.equal(s.client.vote('a'), false);
    s.client.authorize(token);
    const ws = s.sockets[0];
    ws.open();
    assert.equal(JSON.parse(ws.sent[0]).type, 'simulation.authorize');
    assert.equal(s.client.vote('a'), false);
    ws.receive(message());
    assert.equal(s.states.length, 1);
    assert.equal(s.client.vote('a'), true);
    assert.equal(s.client.reset(), true);
    assert.equal(s.states.length, 1);
    const sent = JSON.parse(ws.sent[1]);
    assert.deepEqual(Object.keys(sent).sort(), [
        'correlationId',
        'mode',
        'sessionId',
        'side',
        'type',
    ]);
    assert.equal(sent.side, 'a');
    assert.equal(sent.mode, 'simulation');
    ws.receive(updated());
    assert.equal(s.states.length, 2);
    s.client.close();
});
test('reconexão tem backoff limitado, snapshot novo e nenhum reenvio de votos', () => {
    const s = setup();
    s.client.authorize(token);
    const first = s.sockets[0];
    first.open();
    first.receive(message());
    s.client.vote('a');
    first.close();
    const retry = [...s.timers.values()].find((timer) => timer.delay === 500);
    assert.ok(retry);
    retry.fn();
    const second = s.sockets[1];
    second.open();
    assert.equal(second.sent.length, 1);
    assert.equal(JSON.parse(second.sent[0]).type, 'simulation.authorize');
    assert.equal(s.client.vote('b'), false);
    second.receive(message(1));
    assert.equal(s.statuses.at(-1), 'connected');
    const count = s.states.length;
    first.receive(updated(99));
    assert.equal(s.states.length, count);
    assert.equal(reconnectDelay(30), 8000);
    s.client.close();
});
test('negação de autorização interrompe reconexão até nova chave', () => {
    const s = setup();
    assert.equal(s.client.authorize('weak'), false);
    s.client.authorize(token);
    const ws = s.sockets[0];
    ws.open();
    ws.receive({
        protocol: 1,
        type: 'command.rejected',
        code: 'UNAUTHORIZED',
        correlationId: 'auth_01234567890123',
    });
    assert.equal(s.statuses.at(-1), 'unauthorized');
    assert.equal(
        [...s.timers.values()].some((timer) => timer.delay === 500),
        false,
    );
    assert.equal(s.client.vote('a'), false);
    s.client.close();
});

test('réplica real rejeita simulação, mensagens obsoletas e sessão antiga; reconcilia snapshot persistido', () => {
    const replica = createReplica('real');
    const real = (
        value: ReturnType<typeof message> | ReturnType<typeof updated>,
    ) => ({ ...value, state: { ...value.state, mode: 'real' } });
    assert.equal(replica.accept(message()), null);
    assert.equal(replica.accept(real(updated())), null);
    assert.ok(replica.accept(real(message(5))));
    assert.equal(replica.accept(real(updated(4))), null);
    assert.equal(
        replica.accept(real(updated(6, 'old_session_0123456789'))),
        null,
    );
    replica.beginConnection();
    assert.equal(replica.accept(real(message(4))), null);
    assert.ok(replica.accept(real(message(5))));
    assert.ok(replica.accept(real(updated(6))));
    assert.equal(replica.accept(updated(7)), null);
    assert.equal(replica.getState()?.scores.a, 6);
});

test('cliente real não envia autorização/voto/reset; reconecta somente para leitura e ignora socket antigo', () => {
    const sockets: FakeSocket[] = [];
    const states: unknown[] = [];
    const timers = new Map<number, { callback: () => void; delay: number }>();
    let n = 0;
    const client = createRealtimeClient({
        url: 'ws://127.0.0.1/arena',
        mode: 'real',
        onState: (message) => states.push(message),
        onStatus() {},
        socketFactory() {
            const socket = new FakeSocket();
            sockets.push(socket);
            return socket as unknown as WebSocket;
        },
        schedule: ((callback: () => void, delay: number) => {
            const id = ++n;
            timers.set(id, { callback, delay });
            return id;
        }) as unknown as typeof setTimeout,
        cancel: ((id: number) => {
            timers.delete(id);
        }) as unknown as typeof clearTimeout,
    });
    assert.equal(client.authorize(token), false);
    assert.equal(client.startReadonly(), true);
    const first = sockets[0];
    first.open();
    first.receive({
        ...message(2),
        state: { ...message(2).state, mode: 'real' },
    });
    assert.equal(client.vote('a'), false);
    assert.equal(client.reset(), false);
    assert.equal(first.sent.length, 0);
    assert.equal(states.length, 1);
    first.close();
    const retry = [...timers.values()].find((timer) => timer.delay === 500);
    assert.ok(retry);
    retry.callback();
    sockets[1].open();
    sockets[1].receive({
        ...message(3),
        state: { ...message(3).state, mode: 'real' },
    });
    first.receive({
        ...updated(99),
        state: { ...updated(99).state, mode: 'real' },
    });
    assert.equal(states.length, 2);
    assert.equal(sockets[1].sent.length, 0);
    client.close();
    assert.equal(timers.size, 0);
});
