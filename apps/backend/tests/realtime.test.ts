import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { createBackendServer } from '../src/server.ts';
import { createSimulationSession } from '../src/realtime/session.ts';
import { readSimulationConfig } from '../src/realtime/config.ts';
import { attachRealtime } from '../src/realtime/server.ts';

const token = 'test_token_012345678901234567890123456789';
const origin = 'http://127.0.0.1:5173';
function vote(sessionId: string, id = 'command_012345678901', side = 'a') {
    return {
        type: 'simulation.vote',
        correlationId: id,
        mode: 'simulation',
        sessionId,
        side,
    };
}
function reset(sessionId: string, id = 'reset_01234567890123') {
    return {
        type: 'simulation.reset',
        correlationId: id,
        mode: 'simulation',
        sessionId,
    };
}
function next(ws: WebSocket): Promise<any> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('Sem mensagem WS'));
        }, 3000);
        const message = (data: WebSocket.RawData) => {
            cleanup();
            try {
                resolve(JSON.parse(data.toString()));
            } catch (error) {
                reject(error);
            }
        };
        const error = (value: Error) => {
            cleanup();
            reject(value);
        };
        const cleanup = () => {
            clearTimeout(timer);
            ws.off('message', message);
            ws.off('error', error);
        };
        ws.once('message', message);
        ws.once('error', error);
    });
}
async function running(t: { after(fn: () => unknown): void }, enabled = true) {
    const server = createBackendServer();
    const realtime = attachRealtime(server, { enabled, origin, token });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(
        () =>
            new Promise<void>((resolve, reject) => {
                realtime.close();
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    );
    const port = (server.address() as AddressInfo).port;
    return {
        ...realtime,
        url: `ws://127.0.0.1:${port}/realtime`,
        http: `http://127.0.0.1:${port}`,
    };
}
async function authorized(url: string) {
    const ws = new WebSocket(url, { origin });
    ws.on('error', () => {});
    await once(ws, 'open');
    const message = next(ws);
    ws.send(
        JSON.stringify({
            type: 'simulation.authorize',
            correlationId: 'auth_01234567890123',
            token,
        }),
    );
    return { ws, snapshot: await message };
}

test('sessão inicial, voto fixo +1 autorizado e versão monotônica', () => {
    const s = createSimulationSession(true);
    const initial = s.snapshot();
    assert.deepEqual(initial.scores, { a: 0, b: 0 });
    assert.equal(initial.mode, 'simulation');
    assert.equal(initial.version, 0);
    const result = s.execute(vote(initial.sessionId), true);
    assert.equal(result.changed, true);
    assert.deepEqual(s.snapshot().scores, { a: 1, b: 0 });
    assert.equal(s.snapshot().version, 1);
    initial.scores.a = 999;
    assert.equal(s.snapshot().scores.a, 1);
});
test('comandos inválidos, campos extras e pontos arbitrários são rejeitados', () => {
    const s = createSimulationSession(true);
    for (const value of [
        null,
        [],
        {},
        { ...vote(s.snapshot().sessionId), amount: 100 },
        { ...vote(s.snapshot().sessionId), scores: { a: 100, b: 0 } },
        vote(s.snapshot().sessionId, 'short'),
        vote(s.snapshot().sessionId, undefined, 'x'),
    ]) {
        assert.equal(s.execute(value, true).message.type, 'command.rejected');
    }
    assert.equal(s.snapshot().version, 0);
});
test('autorização obrigatória e isolamento de sessão/modo', () => {
    const s = createSimulationSession(true);
    const command = vote(s.snapshot().sessionId);
    assert.equal(s.execute(command, false).changed, false);
    assert.equal(s.execute({ ...command, mode: 'real' }, true).changed, false);
    assert.equal(
        s.execute({ ...command, sessionId: 'old_session_012345678' }, true)
            .changed,
        false,
    );
    const disabled = createSimulationSession(false);
    assert.equal(
        disabled.execute(vote(disabled.snapshot().sessionId), true).changed,
        false,
    );
    assert.equal(s.snapshot().version, 0);
});
test('identidade é idempotente, conflita se reutilizada e sobrevive ao reset', () => {
    const s = createSimulationSession(true);
    const command = vote(s.snapshot().sessionId);
    s.execute(command, true);
    assert.equal(s.execute(command, true).changed, false);
    assert.equal(
        s.execute({ ...command, side: 'b' }, true).message.type,
        'command.rejected',
    );
    s.execute(reset(s.snapshot().sessionId), true);
    assert.deepEqual(s.snapshot().scores, { a: 0, b: 0 });
    assert.equal(s.snapshot().version, 2);
    assert.equal(s.execute(command, true).changed, false);
    assert.deepEqual(s.snapshot().scores, { a: 0, b: 0 });
});
test('limite de identidades não permite replay após saturação', () => {
    const s = createSimulationSession(true, 1);
    const first = vote(s.snapshot().sessionId);
    s.execute(first, true);
    assert.equal(
        s.execute(vote(s.snapshot().sessionId, 'new_command_012345678'), true)
            .changed,
        false,
    );
    assert.equal(s.execute(first, true).changed, false);
    assert.equal(s.snapshot().scores.a, 1);
});
test('reinício gera nova sessão e configuração fora de dev desabilita simulação', () => {
    assert.notEqual(
        createSimulationSession(true).snapshot().sessionId,
        createSimulationSession(true).snapshot().sessionId,
    );
    assert.equal(readSimulationConfig({}).enabled, false);
    assert.equal(
        readSimulationConfig({
            NODE_ENV: 'production',
            SIMULATION_MODE: 'true',
        }).enabled,
        false,
    );
    assert.equal(
        readSimulationConfig({ NODE_ENV: 'development' }).enabled,
        false,
    );
    assert.equal(
        readSimulationConfig({
            NODE_ENV: 'development',
            SIMULATION_MODE: 'true',
        }).enabled,
        true,
    );
    assert.throws(() => readSimulationConfig({ SIMULATION_TOKEN: 'weak' }));
});

test('snapshot autorizado, broadcast, deduplicação, reset e reconexão reais', async (t) => {
    const app = await running(t);
    const a = await authorized(app.url);
    const b = await authorized(app.url);
    t.after(() => {
        a.ws.terminate();
        b.ws.terminate();
    });
    assert.equal(a.snapshot.type, 'state.snapshot');
    assert.deepEqual(a.snapshot.state.scores, { a: 0, b: 0 });
    const id = a.snapshot.state.sessionId;
    const command = vote(id);
    const pa = next(a.ws),
        pb = next(b.ws);
    a.ws.send(JSON.stringify(command));
    const [ma, mb] = await Promise.all([pa, pb]);
    assert.deepEqual(ma, mb);
    assert.equal(ma.type, 'state.updated');
    assert.equal(ma.state.scores.a, 1);
    const duplicate = next(a.ws);
    a.ws.send(JSON.stringify(command));
    assert.equal((await duplicate).state.version, 1);
    const resetA = next(a.ws),
        resetB = next(b.ws);
    b.ws.send(JSON.stringify(reset(id)));
    for (const m of await Promise.all([resetA, resetB])) {
        assert.equal(m.state.version, 2);
        assert.deepEqual(m.state.scores, { a: 0, b: 0 });
    }
    a.ws.terminate();
    const c = await authorized(app.url);
    t.after(() => c.ws.terminate());
    assert.equal(c.snapshot.state.sessionId, id);
    assert.equal(c.snapshot.state.version, 2);
    const health = await fetch(app.http + '/health');
    assert.equal(health.status, 200);
});
test('origem proibida e simulação desabilitada rejeitam upgrade', async (t) => {
    const app = await running(t);
    const bad = new WebSocket(app.url, { origin: 'https://evil.example' });
    t.after(() => bad.terminate());
    await assert.rejects(once(bad, 'open'));
    const disabled = await running(t, false);
    const ws = new WebSocket(disabled.url, { origin });
    t.after(() => ws.terminate());
    await assert.rejects(once(ws, 'open'));
    assert.equal(disabled.session.snapshot().version, 0);
});
test('chave inválida e comando anterior à autorização não alteram estado', async (t) => {
    const app = await running(t);
    for (const message of [
        {
            type: 'simulation.authorize',
            correlationId: 'auth_01234567890123',
            token: 'wrong_token_01234567890123456789012',
        },
        vote(app.session.snapshot().sessionId),
    ]) {
        const ws = new WebSocket(app.url, { origin });
        t.after(() => ws.terminate());
        await once(ws, 'open');
        const response = next(ws);
        ws.send(JSON.stringify(message));
        assert.equal((await response).code, 'UNAUTHORIZED');
    }
    assert.equal(app.session.snapshot().version, 0);
});
test('JSON malformado e campos adicionais recebem rejeição correlacionada', async (t) => {
    const app = await running(t);
    const { ws, snapshot } = await authorized(app.url);
    t.after(() => ws.terminate());
    let response = next(ws);
    ws.send('{');
    assert.equal((await response).code, 'INVALID_JSON');
    response = next(ws);
    ws.send(JSON.stringify({ ...vote(snapshot.state.sessionId), amount: 99 }));
    const rejected = await response;
    assert.equal(rejected.code, 'INVALID_COMMAND');
    assert.equal(rejected.correlationId, 'command_012345678901');
    assert.equal(app.session.snapshot().version, 0);
});

test('payload excessivo encerra conexão sem alterar a sessão', async (t) => {
    const app = await running(t);
    const { ws } = await authorized(app.url);
    t.after(() => ws.terminate());
    const closed = once(ws, 'close');
    ws.send('x'.repeat(4097));
    await closed;
    assert.equal(app.session.snapshot().version, 0);
});
