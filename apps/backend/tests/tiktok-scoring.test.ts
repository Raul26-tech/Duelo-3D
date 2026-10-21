import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import {
    mkdtempSync,
    rmSync,
    readFileSync,
    writeFileSync,
    unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import { createBackendServer } from '../src/server.ts';
import { startRealRuntime } from '../src/integration/runtime.ts';
import {
    parseReviewedCatalog,
    readOperationMode,
    readRealConfig,
    type RealConfig,
} from '../src/integration/config.ts';
import { validateRealOccurrence } from '../src/integration/ingress.ts';
import { normalizeProviderEvent } from '../src/tiktok/normalize.ts';
import { ROOM, chat, gift } from './fixtures/tiktok.ts';
import type { Scheduler } from '../src/tiktok/contracts.ts';
import type { Decision } from '../src/scoring/contracts.ts';

const origin = 'http://127.0.0.1:5173';
const gifts = parseReviewedCatalog([
    {
        giftId: '501',
        name: 'Synthetic combo',
        candidate: 'flavio',
        points: 7,
        delivery: 'cumulative-final',
    },
    {
        giftId: '502',
        name: 'Synthetic single',
        candidate: 'lula',
        points: 25,
        delivery: 'single',
    },
]);
const comment = (id = '801', text = 'Lula') => ({ ...chat(id), content: text });
const combo = (id: string, count: number, final = 0) => gift(count, final, id);
const single = (id = '901') => ({
    ...gift(1, 1, id),
    giftId: '502',
    groupId: '0',
    gift: { id: '502', type: 2, combo: false, name: 'Synthetic single' },
});
class FakeProvider extends EventEmitter {
    roomId = ROOM;
    failure = false;
    disconnects = 0;
    async connect() {
        if (this.failure) throw new Error('private SDK error');
        return { roomId: this.roomId };
    }
    async disconnect() {
        this.disconnects++;
    }
}
const drain = async () => {
    for (let n = 0; n < 5; n++)
        await new Promise<void>((resolve) => setImmediate(resolve));
};
async function rig(
    t: TestContext,
    options: {
        afterCommit?: (decision: Decision) => void;
        provider?: FakeProvider;
        gifts?: typeof gifts;
        schedule?: Scheduler;
    } = {},
) {
    const directory = mkdtempSync(join(tmpdir(), 'duelo-real-'));
    const filename = join(directory, 'real.sqlite');
    const server = createBackendServer('real');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `ws://127.0.0.1:${address.port}/arena`;
    let provider = options.provider ?? new FakeProvider();
    const config: RealConfig = {
        mode: 'real',
        username: 'synthetic_test',
        roomId: ROOM,
        filename,
        action: 'create',
        gifts: options.gifts ?? gifts,
        sourcePolicy: 'synthetic-reviewed-policy',
    };
    const lines: string[] = [];
    let runtime = startRealRuntime({
        server,
        origin,
        config,
        factory: () => provider,
        afterCommit: options.afterCommit,
        schedule: options.schedule,
        writeDiagnostic: (line) => lines.push(line),
    });
    await drain();
    const clients: WebSocket[] = [];
    async function viewer() {
        const ws = new WebSocket(url, { origin });
        clients.push(ws);
        const first = once(ws, 'message');
        await once(ws, 'open');
        const [data] = await first;
        return { ws, state: JSON.parse(data.toString()).state };
    }
    async function restart(changes: Partial<RealConfig> = {}) {
        await runtime.close();
        provider = new FakeProvider();
        runtime = startRealRuntime({
            server,
            origin,
            config: { ...config, action: 'resume', ...changes },
            factory: () => provider,
            writeDiagnostic: (line) => lines.push(line),
        });
        await drain();
    }
    t.after(async () => {
        await runtime.close();
        for (const ws of clients) ws.terminate();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        rmSync(directory, { recursive: true, force: true });
    });
    return {
        filename,
        url,
        server,
        lines,
        viewer,
        restart,
        replaceProvider: () => (provider = new FakeProvider()),
        current: () => runtime,
        provider: () => provider,
    };
}

test('real: snapshot inicial; comentários usam regras existentes e retransmissões não repetem pontos', async (t) => {
    const r = await rig(t);
    const v = await r.viewer();
    assert.deepEqual(v.state.scores, { a: 0, b: 0 });
    assert.equal(v.state.mode, 'real');
    const update = once(v.ws, 'message');
    r.provider().emit('chat', comment());
    const [message] = await update;
    assert.equal(JSON.parse(message.toString()).state.scores.a, 1);
    for (const [id, text] of [
        ['802', 'FLÁVIO'],
        ['803', 'Lula e Flávio'],
        ['804', 'flaviolula'],
        ['805', 'Lula'],
    ])
        r.provider().emit('chat', comment(id, text));
    r.provider().emit('chat', comment());
    assert.deepEqual(r.current().snapshot().scores, { lula: 2, flavio: 1 });
    assert.equal(r.current().snapshot().version, 3);
});

test('real: IDs grandes exatos, usuário obrigatório, origem/sala divergentes e envelopes observados rejeitados', async (t) => {
    const r = await rig(t);
    for (const payload of [
        { ...comment(), common: { roomId: ROOM } },
        { ...comment(), user: {} },
        { ...comment(), common: { roomId: '999', msgId: '1' } },
        {
            ...comment(),
            common: { roomId: ROOM, msgId: Number.MAX_SAFE_INTEGER + 1 },
        },
        { ...comment(), origin: 'other' },
        { ...comment(), domain: 'real' },
        {
            ...normalizeProviderEvent('comment', comment(), ROOM),
            domain: 'real',
        },
        null,
        'Lula',
        [],
    ])
        r.provider().emit('chat', payload);
    assert.equal(r.current().snapshot().version, 0);
    r.provider().emit('chat', comment('18446744073709551615'));
    assert.equal(r.current().snapshot().scores.lula, 1);
    const sql = new Database(r.filename);
    assert.match(
        (
            sql.prepare('SELECT identity FROM event_identities').get() as {
                identity: string;
            }
        ).identity,
        /18446744073709551615/,
    );
    sql.close();
});

test('real: presentes desconhecidos e sem política não pontuam; unidade usa catálogo do servidor', async (t) => {
    const r = await rig(t);
    r.provider().emit('gift', {
        ...single('900'),
        giftId: '999',
        gift: { id: '999', type: 2, combo: false },
    });
    r.provider().emit('gift', { ...single(), repeatCount: 2 });
    r.provider().emit('gift', { ...single(), repeatEnd: undefined });
    assert.equal(r.current().snapshot().version, 0);
    r.provider().emit('gift', {
        ...single(),
        points: 1000000,
        candidate: 'flavio',
    });
    assert.deepEqual(r.current().snapshot().scores, { lula: 25, flavio: 0 });
    r.provider().emit('gift', single());
    assert.equal(r.current().snapshot().version, 1);
});

test('real: catálogo vazio padrão mantém presentes desligados', async (t) => {
    const r = await rig(t, { gifts: [] });
    r.provider().emit('gift', single());
    r.provider().emit('gift', combo('902', 3, 1));
    r.provider().emit('chat', comment());
    assert.deepEqual(r.current().snapshot().scores, { lula: 1, flavio: 0 });
});

test('real: combo acumulativo persiste pendência, retoma e contabiliza somente final; dedup após reinício', async (t) => {
    const r = await rig(t);
    r.provider().emit('gift', combo('1001', 1));
    r.provider().emit('gift', combo('1002', 2));
    assert.equal(r.current().snapshot().version, 0);
    const before = r.current().snapshot();
    await r.restart();
    assert.deepEqual(r.current().snapshot(), before);
    r.provider().emit('gift', combo('1002', 2));
    r.provider().emit('gift', combo('1003', 3));
    r.provider().emit('gift', combo('1004', 3, 1));
    assert.deepEqual(r.current().snapshot().scores, { lula: 0, flavio: 21 });
    const completed = r.current().snapshot();
    await r.restart();
    r.provider().emit('gift', combo('1004', 3, 1));
    r.provider().emit('gift', combo('1005', 3, 1));
    assert.deepEqual(r.current().snapshot(), completed);
    const reconnect = await r.viewer();
    assert.equal(reconnect.state.sessionId, completed.sessionId);
    assert.equal(reconnect.state.version, 1);
    assert.deepEqual(reconnect.state.scores, { a: 0, b: 21 });
});

test('real: ordem contraditória e dono divergente da sequência ficam em quarentena inclusive após reinício', async (t) => {
    const r = await rig(t);
    r.provider().emit('gift', combo('1101', 3));
    r.provider().emit('gift', combo('1102', 2));
    await r.restart();
    r.provider().emit('gift', combo('1103', 3, 1));
    assert.equal(r.current().snapshot().version, 0);
    const second = { ...combo('1104', 1), groupId: '9991' };
    r.provider().emit('gift', second);
    r.provider().emit('gift', {
        ...second,
        common: { ...second.common, msgId: '1105' },
        user: { id: '999' },
        repeatCount: 2,
        repeatEnd: 1,
    });
    r.provider().emit('gift', {
        ...second,
        common: { ...second.common, msgId: '1106' },
        repeatEnd: 1,
    });
    assert.equal(r.current().snapshot().version, 0);
});

test('real: mesma identidade com ator/texto contraditório rejeitada; repetições legítimas distintas pontuam', async (t) => {
    const r = await rig(t);
    r.provider().emit('chat', comment());
    r.provider().emit('chat', {
        ...comment(),
        user: { id: '999' },
        content: 'Flávio',
    });
    await r.restart();
    r.provider().emit('chat', comment());
    r.provider().emit('chat', comment('another-id-invalid'));
    r.provider().emit('chat', comment('1202'));
    assert.deepEqual(r.current().snapshot().scores, { lula: 2, flavio: 0 });
});

test('real: rollback integral não publica e bloqueia a conexão; retomada permite processar ocorrência não confirmada', async (t) => {
    const r = await rig(t);
    const v = await r.viewer();
    const messages: unknown[] = [];
    v.ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    const db = new Database(r.filename);
    db.exec(
        "CREATE TRIGGER fail_commit BEFORE UPDATE ON dispute BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    r.provider().emit('chat', comment());
    await drain();
    assert.equal(r.current().snapshot().version, 0);
    assert.equal(
        (db.prepare('SELECT COUNT(*) AS n FROM journal').get() as { n: number })
            .n,
        0,
    );
    assert.equal(
        (
            db.prepare('SELECT COUNT(*) AS n FROM event_identities').get() as {
                n: number;
            }
        ).n,
        0,
    );
    assert.equal(messages.length, 0);
    assert.equal(r.current().state(), 'stopped');
    db.exec('DROP TRIGGER fail_commit');
    db.close();
    await r.restart();
    r.provider().emit('chat', comment());
    assert.equal(r.current().snapshot().version, 1);
});

test('real: publicação ocorre depois do commit; falha de transporte reconciliada por snapshot sem reaplicação', async (t) => {
    let filename = '';
    let fail = true;
    const r = await rig(t, {
        afterCommit(decision) {
            if (decision.status !== 'applied') return;
            const db = new Database(filename);
            assert.equal(
                (
                    db.prepare('SELECT version FROM dispute').get() as {
                        version: number;
                    }
                ).version,
                decision.state.version,
            );
            db.close();
            if (fail) {
                fail = false;
                throw new Error('transport failed');
            }
        },
    });
    filename = r.filename;
    const v = await r.viewer();
    const closed = once(v.ws, 'close');
    r.provider().emit('chat', comment());
    await closed;
    const recovered = await r.viewer();
    assert.equal(recovered.state.scores.a, 1);
    r.provider().emit('chat', comment());
    assert.equal(r.current().snapshot().version, 1);
    const update = once(recovered.ws, 'message');
    r.provider().emit('chat', comment('1302'));
    await update;
    assert.equal(r.current().snapshot().scores.lula, 2);
});

test('real: voto/reset/token de simulação e payload TikTok pelo navegador não têm capacidade de escrita', async (t) => {
    const r = await rig(t);
    for (const type of [
        'simulation.vote',
        'simulation.reset',
        'simulation.authorize',
        'tiktok.comment',
    ]) {
        const v = await r.viewer();
        const message = once(v.ws, 'message');
        v.ws.send(
            JSON.stringify({
                type,
                token: 'a'.repeat(32),
                points: 100,
                payload: comment(),
            }),
        );
        const [data] = await message;
        assert.equal(JSON.parse(data.toString()).code, 'READ_ONLY_REAL_ARENA');
    }
    assert.equal(r.current().snapshot().version, 0);
});

test('real: múltiplos espectadores recebem estado confirmado e reconexão recebe snapshot', async (t) => {
    const r = await rig(t);
    const a = await r.viewer();
    const b = await r.viewer();
    const updates = [once(a.ws, 'message'), once(b.ws, 'message')];
    for (let n = 1; n <= 10; n++)
        r.provider().emit('chat', comment(String(1400 + n)));
    for (const update of updates)
        assert.equal(JSON.parse((await update)[0].toString()).state.version, 1);
    assert.equal((await r.viewer()).state.version, 10);
});

test('real: sala diferente na conexão bloqueia, callbacks antigos após encerramento não pontuam', async (t) => {
    const provider = new FakeProvider();
    provider.roomId = '999';
    const r = await rig(t, { provider });
    provider.emit('chat', comment());
    await drain();
    assert.equal(r.current().snapshot().version, 0);
    assert.equal(r.current().state(), 'stopped');
});

test('real: falha do conector não cria votos nem permite callbacks desconectados', async (t) => {
    const provider = new FakeProvider();
    provider.failure = true;
    const r = await rig(t, { provider });
    provider.emit('chat', comment());
    assert.equal(r.current().snapshot().version, 0);
    assert.equal(r.current().state(), 'reconnecting');
    await r.current().close();
    provider.emit('chat', comment());
    assert.ok(provider.disconnects > 0);
});

test('real: autoridade exclusiva e retomada com contexto alterado são bloqueadas', async (t) => {
    const r = await rig(t);
    assert.throws(
        () =>
            startRealRuntime({
                server: r.server,
                origin,
                factory: () => new FakeProvider(),
                config: {
                    mode: 'real',
                    username: 'synthetic_test',
                    roomId: ROOM,
                    filename: r.filename,
                    action: 'resume',
                    gifts,
                    sourcePolicy: 'synthetic-reviewed-policy',
                },
            }),
        /EEXIST/,
    );
    r.provider().emit('chat', comment());
    await assert.rejects(() => r.restart({ roomId: '999' }), /context/);
    await assert.rejects(
        () => r.restart({ sourcePolicy: 'different-policy' }),
        /context/,
    );
    await assert.rejects(
        () =>
            r.restart({
                gifts: parseReviewedCatalog([{ ...gifts[0], points: 200 }]),
            }),
        /context/,
    );
    const db = new Database(r.filename);
    assert.equal(
        (db.prepare('SELECT lula FROM dispute').get() as { lula: number }).lula,
        1,
    );
    db.close();
});

test('real: dados corrompidos não reiniciam disputa zerada', async (t) => {
    const r = await rig(t);
    r.provider().emit('chat', comment());
    await r.current().close();
    const db = new Database(r.filename);
    db.exec('UPDATE dispute SET lula = 2');
    db.close();
    await assert.rejects(() => r.restart(), /digest/);
});

test('real: overflow não grava identidade, sequência final ou placar parcial', async (t) => {
    const huge = parseReviewedCatalog([
        {
            giftId: '501',
            name: 'Synthetic',
            candidate: 'flavio',
            points: Number.MAX_SAFE_INTEGER,
            delivery: 'cumulative-final',
        },
    ]);
    const r = await rig(t, { gifts: huge });
    r.provider().emit('gift', combo('1501', 1));
    r.provider().emit('gift', combo('1502', 2, 1));
    assert.equal(r.current().snapshot().version, 0);
    await r.restart();
    r.provider().emit('gift', combo('1503', 1, 1));
    assert.equal(r.current().snapshot().scores.flavio, Number.MAX_SAFE_INTEGER);
    r.provider().emit('chat', comment());
    assert.equal(r.current().snapshot().scores.lula, 0);
});

test('config: real exige adesão explícita, identidade revisada e ação create/resume; padrão simulação', () => {
    assert.equal(readOperationMode({}), 'simulation');
    for (const env of [
        {},
        { DUEL_MODE: 'real' },
        { DUEL_MODE: 'observation', TIKTOK_REAL_ENABLED: 'true' },
    ])
        assert.throws(() => readRealConfig(env));
    const env = {
        DUEL_MODE: 'real',
        TIKTOK_REAL_ENABLED: 'true',
        TIKTOK_IDENTITY_REVIEWED: 'true',
        TIKTOK_USERNAME: 'synthetic_test',
        TIKTOK_ROOM_ID: ROOM,
        TIKTOK_SESSION_ACTION: 'resume',
        TIKTOK_DATABASE: '/tmp/synthetic-real.sqlite',
    };
    assert.equal(readRealConfig(env).gifts.length, 0);
    for (const changes of [
        { TIKTOK_SESSION_ACTION: '' },
        { TIKTOK_ROOM_ID: '' },
        { TIKTOK_IDENTITY_REVIEWED: 'false' },
        { TIKTOK_DATABASE: './db.sqlite' },
        { TIKTOK_DIAGNOSTIC_ENABLED: 'true' },
    ])
        assert.throws(() => readRealConfig({ ...env, ...changes }));
});

test('config: catálogo externo validado, imutável e política de retomada vinculada ao conteúdo', (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'duelo-catalog-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'catalog.json');
    writeFileSync(path, JSON.stringify(gifts));
    const env = {
        DUEL_MODE: 'real',
        TIKTOK_REAL_ENABLED: 'true',
        TIKTOK_IDENTITY_REVIEWED: 'true',
        TIKTOK_USERNAME: 'synthetic_test',
        TIKTOK_ROOM_ID: ROOM,
        TIKTOK_SESSION_ACTION: 'create',
        TIKTOK_DATABASE: '/tmp/synthetic-real.sqlite',
        TIKTOK_GIFT_CATALOG: path,
    };
    const first = readRealConfig(env);
    assert.equal(first.gifts[0].points, 7);
    assert.throws(() => {
        (first.gifts[0] as { points: number }).points = 999;
    });
    writeFileSync(path, JSON.stringify([{ ...gifts[0], points: 200 }]));
    assert.notEqual(readRealConfig(env).sourcePolicy, first.sourcePolicy);
    assert.equal(readFileSync(path, 'utf8').includes('200'), true);
    for (const entry of [
        { ...gifts[0], points: '7' },
        { ...gifts[0], delivery: 'unknown' },
        { ...gifts[0], delivery: ['single'] },
        { ...gifts[0], giftId: 'invented' },
    ])
        assert.throws(() => parseReviewedCatalog([entry]));
});

test('validador real não aceita projeções observadas nem sala fornecida pelo payload como autoridade', () => {
    const observed = normalizeProviderEvent('comment', comment(), ROOM);
    assert.equal(
        validateRealOccurrence(
            'comment',
            { ...observed, domain: 'real' },
            ROOM,
            ROOM,
            gifts,
        ).event,
        undefined,
    );
    assert.equal(
        validateRealOccurrence('comment', comment(), '999', ROOM, gifts).event,
        undefined,
    );
});

test('real: reconexão do provedor reafirma sala, não reenvia eventos e rejeita callbacks antigos', async (t) => {
    const timers = new Map<number, { callback: () => void; delay: number }>();
    let n = 0;
    const schedule: Scheduler = (callback, delay) => {
        const id = ++n;
        timers.set(id, { callback, delay });
        return () => {
            timers.delete(id);
        };
    };
    const r = await rig(t, { schedule });
    const old = r.provider();
    old.emit('chat', comment());
    old.emit('disconnected', {});
    await drain();
    old.emit('chat', comment('1601'));
    const fresh = r.replaceProvider();
    const retry = [...timers.values()].find((timer) => timer.delay === 1000);
    assert.ok(retry);
    retry.callback();
    fresh.emit('chat', comment('1602'));
    await drain();
    assert.equal(r.current().state(), 'connected');
    fresh.emit('chat', comment());
    fresh.emit('chat', comment('1603'));
    assert.equal(r.current().snapshot().scores.lula, 2);
    fresh.emit('disconnected', {});
    await drain();
    const other = r.replaceProvider();
    other.roomId = '999';
    const retry2 = [...timers.values()].find((timer) => timer.delay === 2000);
    assert.ok(retry2);
    retry2.callback();
    await drain();
    other.emit('chat', comment('1604'));
    assert.equal(r.current().state(), 'stopped');
    assert.equal(r.current().snapshot().scores.lula, 2);
});

test('real: Origin externo e canal de simulação não acessam arena; health permanece 200', async (t) => {
    const r = await rig(t);
    for (const [url, requestOrigin] of [
        [r.url, 'https://untrusted.example'],
        [r.url.replace('/arena', '/realtime'), origin],
    ]) {
        const ws = new WebSocket(url, { origin: requestOrigin });
        await assert.rejects(() => once(ws, 'open'), /403/);
        ws.terminate();
    }
    const health = await fetch(
        r.url.replace('ws:', 'http:').replace('/arena', '/health'),
    );
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
        status: 'ok',
        service: 'duelo-3d-backend',
    });
});

test('persistência: banco v1 legado de simulação continua recuperável sem migração implícita', async (t) => {
    const { openSqliteScoring } = await import('../src/persistence/sqlite.ts');
    const directory = mkdtempSync(join(tmpdir(), 'duelo-v1-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const filename = join(directory, 'legacy.sqlite');
    const engine = {
        origin: 'legacy',
        roomId: 'legacy-room',
        domain: 'simulation' as const,
    };
    const event = {
        ...engine,
        type: 'comment',
        eventId: 'legacy-1',
        text: 'Lula',
    };
    let coordinator = openSqliteScoring({ filename, mode: 'create', engine });
    coordinator.process(event);
    const before = coordinator.snapshot();
    coordinator.close();
    const db = new Database(filename);
    db.exec(
        'ALTER TABLE dispute DROP COLUMN source_policy; ALTER TABLE gift_sequences DROP COLUMN actor_id; PRAGMA user_version=1',
    );
    db.close();
    coordinator = openSqliteScoring({ filename, mode: 'resume', engine });
    assert.deepEqual(coordinator.snapshot(), before);
    assert.equal(coordinator.process(event).status, 'duplicate');
    assert.equal(
        coordinator.process({ ...event, eventId: 'legacy-2' }).points,
        1,
    );
    coordinator.close();
});

test('real: lock removido ou substituído revoga autoridade antes de novos eventos e snapshots', async (t) => {
    const r = await rig(t);
    r.provider().emit('chat', comment());
    unlinkSync(r.filename + '.authority.lock');
    writeFileSync(r.filename + '.authority.lock', 'replacement-authority');
    r.provider().emit('chat', comment('1702'));
    await drain();
    assert.throws(() => r.current().snapshot(), /Authority/);
    const db = new Database(r.filename);
    assert.equal(
        (db.prepare('SELECT lula FROM dispute').get() as { lula: number }).lula,
        1,
    );
    db.close();
    assert.equal(r.current().state(), 'stopped');
    await r.current().close();
    assert.equal(
        readFileSync(r.filename + '.authority.lock', 'utf8'),
        'replacement-authority',
    );
});

test('real: finalização, sequência e flags de entrega insuficientes não ganham confiança pela configuração', async (t) => {
    const r = await rig(t);
    for (const payload of [
        { ...combo('1801', 3, 1), repeatEnd: true },
        { ...combo('1802', 3, 1), groupId: undefined },
        { ...combo('1803', 3, 1), gift: { id: '501', type: 1, combo: false } },
        { ...combo('1804', 3, 1), gift: { id: '999', type: 1, combo: true } },
        { ...combo('1805', 3, 1), repeatCount: 1.5 },
    ])
        r.provider().emit('gift', payload);
    assert.equal(r.current().snapshot().version, 0);
});

test('real: rejeição de presente desconhecido completo preserva identidade contra retransmissão contraditória', async (t) => {
    const r = await rig(t);
    r.provider().emit('gift', {
        ...single('1901'),
        giftId: '999',
        gift: { id: '999', type: 2, combo: false },
    });
    assert.equal(r.current().snapshot().version, 0);
    await r.restart();
    r.provider().emit('gift', single('1901'));
    assert.equal(r.current().snapshot().version, 0);
    assert.ok(
        r.lines.some((line) => JSON.parse(line).reason === 'IDENTITY_CONFLICT'),
    );
});
