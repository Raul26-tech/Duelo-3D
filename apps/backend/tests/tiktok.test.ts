import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDiagnosticConfig } from '../src/tiktok/config.ts';
import { normalizeProviderEvent, providerId } from '../src/tiktok/normalize.ts';
import {
    createDiagnosticLogger,
    createEventObserver,
} from '../src/tiktok/diagnostics.ts';
import { createDiagnosticClient } from '../src/tiktok/client.ts';
import { createProviderFactory } from '../src/tiktok/provider.ts';
import type { ProviderClient, Scheduler } from '../src/tiktok/contracts.ts';
import { createScoringEngine } from '../src/scoring/engine.ts';
import { createSimulationSession } from '../src/realtime/session.ts';
import { openSqliteScoring } from '../src/persistence/sqlite.ts';
import { ROOM, USER, chat, gift } from './fixtures/tiktok.ts';

const drain = async () => {
    for (let n = 0; n < 25; n += 1) await Promise.resolve();
};
class FakeClient extends EventEmitter implements ProviderClient {
    connects = 0;
    disconnects = 0;
    result: () => Promise<unknown> = async () => ({ roomId: ROOM });
    cleanup: () => Promise<void> = async () => {};
    connect() {
        this.connects += 1;
        return this.result();
    }
    disconnect() {
        this.disconnects += 1;
        return this.cleanup();
    }
}
function rig(factory?: () => FakeClient, enabled = true) {
    let time = 0;
    let next = 0;
    const timers = new Map<number, { task: () => void; ms: number }>();
    const schedule: Scheduler = (task, ms) => {
        const id = ++next;
        timers.set(id, { task, ms });
        return () => {
            timers.delete(id);
        };
    };
    const lines: string[] = [];
    const logger = createDiagnosticLogger(
        (line) => lines.push(line),
        () => time,
    );
    const observer = createEventObserver(logger, () => time);
    const clients: FakeClient[] = [];
    const client = createDiagnosticClient({
        enabled,
        logger,
        observer,
        schedule,
        now: () => time,
        factory: () => {
            const provider = factory?.() ?? new FakeClient();
            clients.push(provider);
            return provider;
        },
    });
    return {
        client,
        clients,
        lines,
        observer,
        logger,
        timers,
        advance(ms: number) {
            time += ms;
        },
        fire(ms: number) {
            const timer = [...timers].find(([, item]) => item.ms === ms);
            assert.ok(timer, `missing timer ${ms}`);
            timers.delete(timer[0]);
            timer[1].task();
        },
    };
}

test('comentário v3 preserva texto e IDs integrais, sem habilitar pontuação', () => {
    const value = normalizeProviderEvent('comment', chat(), ROOM);
    assert.equal(value.status, 'candidate-unverified');
    assert.equal(value.confirmed.text, chat().content);
    assert.equal(value.confirmed.userId, USER);
    assert.equal(value.confirmed.roomId, ROOM);
    assert.equal(value.scoringEligible, false);
    assert.equal(value.domain, 'observation');
    assert.ok(Object.isFrozen(value.confirmed));
});

test('identidade ausente não é substituída por texto, username, timestamp ou ID fabricado', () => {
    const value = normalizeProviderEvent(
        'comment',
        { content: 'Lula', user: { uniqueId: 'person' }, timestamp: 123 },
        ROOM,
    );
    assert.equal(value.status, 'insufficient');
    assert.equal(value.confirmed.eventId, null);
    assert.equal(value.confirmed.userId, null);
    assert.equal(value.confirmed.roomId, null);
    assert.equal(value.connectionRoomId, ROOM);
    assert.equal(value.scoringEligible, false);
});

test('IDs grandes são texto/bigint exatos; números arredondados e placeholders são recusados', () => {
    assert.equal(providerId(900719925474099312345n), '900719925474099312345');
    assert.equal(providerId('900719925474099312345'), '900719925474099312345');
    for (const value of [
        0,
        '0',
        '',
        '000',
        -1,
        1.2,
        Infinity,
        {},
        ' 12',
        Number.MAX_SAFE_INTEGER + 1,
    ])
        assert.equal(providerId(value), null);
    assert.equal(
        normalizeProviderEvent(
            'comment',
            { ...chat(), user: { id: Number.MAX_SAFE_INTEGER + 1 } },
            ROOM,
        ).status,
        'invalid',
    );
});

test('conflito de transmissão ou de presente fica explícito', () => {
    assert.ok(
        normalizeProviderEvent('comment', chat(), '123').reasons.includes(
            'ROOM_CONFLICT',
        ),
    );
    const value = normalizeProviderEvent(
        'gift',
        { ...gift(), giftId: '999' },
        ROOM,
    );
    assert.equal(value.status, 'invalid');
    assert.ok(value.reasons.includes('GIFT_ID_CONFLICT'));
});

test('presente individual é apenas uma inferência do conector, nunca um voto', () => {
    const value = normalizeProviderEvent(
        'gift',
        {
            ...gift(),
            groupId: '0',
            gift: { ...gift().gift, type: 2, combo: false },
        },
        ROOM,
    );
    assert.equal(value.inferred.delivery, 'individual-candidate');
    assert.equal(value.confirmed.giftName, 'Synthetic gift');
    assert.equal(value.scoringEligible, false);
});

test('campos antigos do README não viram aliases silenciosos do esquema v3', () => {
    const value = normalizeProviderEvent(
        'comment',
        { common: chat().common, user: { userId: USER }, comment: 'Lula' },
        ROOM,
    );
    assert.equal(value.confirmed.text, null);
    assert.equal(value.confirmed.userId, null);
    assert.notEqual(value.status, 'candidate-unverified');
});

test('repeatEnd é 0/1 neste schema; boolean e campos ausentes não comprovam finalização', () => {
    const boolean = normalizeProviderEvent(
        'gift',
        { ...gift(), repeatEnd: true },
        ROOM,
    );
    assert.equal(boolean.confirmed.repeatEnd, null);
    assert.equal(boolean.inferred.phase, 'unknown');
    assert.ok(boolean.reasons.includes('MISSING_OR_INVALID_FINAL_FLAG'));
    const absent = normalizeProviderEvent(
        'gift',
        { ...gift(), groupId: undefined },
        ROOM,
    );
    assert.equal(absent.status, 'insufficient');
    assert.ok(absent.reasons.includes('SEQUENCE_ID_UNPROVEN'));
});

test('payloads malformados, quantidades incompatíveis e campos excessivos são limitados', () => {
    for (const payload of [null, [], 'bad', 123])
        assert.equal(
            normalizeProviderEvent('gift', payload, ROOM).status,
            'invalid',
        );
    for (const repeatCount of [
        undefined,
        0,
        -1,
        1.5,
        '3',
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
    ])
        assert.equal(
            normalizeProviderEvent('gift', { ...gift(), repeatCount }, ROOM)
                .status,
            'invalid',
        );
    assert.equal(
        normalizeProviderEvent(
            'comment',
            { ...chat(), content: 'a'.repeat(4097) },
            ROOM,
        ).confirmed.text,
        null,
    );
    assert.equal(
        normalizeProviderEvent(
            'gift',
            { ...gift(), gift: { ...gift().gift, name: 'x'.repeat(257) } },
            ROOM,
        ).status,
        'invalid',
    );
});

test('combo acumulado 1,2,3, repetição e final explícito são diagnosticados separadamente', () => {
    const r = rig();
    assert.ok(
        r.observer
            .observe(normalizeProviderEvent('gift', gift(1, 0, '1'), ROOM))
            .includes('sequence_started'),
    );
    assert.ok(
        r.observer
            .observe(normalizeProviderEvent('gift', gift(2, 0, '2'), ROOM))
            .includes('count_increased'),
    );
    assert.ok(
        r.observer
            .observe(normalizeProviderEvent('gift', gift(3, 0, '3'), ROOM))
            .includes('count_increased'),
    );
    const repeat = r.observer.observe(
        normalizeProviderEvent('gift', gift(3, 0, '3'), ROOM),
    );
    assert.ok(repeat.includes('retransmission_candidate'));
    assert.ok(repeat.includes('count_repeated'));
    assert.ok(
        r.observer
            .observe(normalizeProviderEvent('gift', gift(3, 1, '4'), ROOM))
            .includes('explicit_final'),
    );
    assert.ok(
        r.observer
            .observe(normalizeProviderEvent('gift', gift(3, 1, '5'), ROOM))
            .includes('after_final'),
    );
    assert.ok(
        r.lines.every((line) => JSON.parse(line).scoringEligible === false),
    );
});

test('identidade contraditória e contagem fora de ordem não são convertidas em eventos elegíveis', () => {
    const r = rig();
    r.observer.observe(normalizeProviderEvent('gift', gift(3, 0, '1'), ROOM));
    const notes = r.observer.observe(
        normalizeProviderEvent('gift', gift(2, 0, '1'), ROOM),
    );
    assert.ok(notes.includes('identity_conflict'));
    assert.ok(notes.includes('out_of_order'));
    const conflict = normalizeProviderEvent(
        'gift',
        { ...gift(4, 0, '2'), user: { id: '999' } },
        ROOM,
    );
    assert.ok(
        r.observer.observe(conflict).includes('sequence_context_conflict'),
    );
    assert.equal(conflict.scoringEligible, false);
});

test('combo sem grupo não é agrupado por usuário, presente ou proximidade de tempo', () => {
    const r = rig();
    for (const count of [1, 2, 3]) {
        const notes = r.observer.observe(
            normalizeProviderEvent(
                'gift',
                { ...gift(count), groupId: '0' },
                ROOM,
            ),
        );
        assert.ok(notes.includes('sequence_unidentifiable'));
        assert.ok(!notes.includes('count_increased'));
    }
});

test('TTL e desconexão classificam sequências como interrompidas, sem inventar finalização', () => {
    const r = rig();
    r.observer.observe(normalizeProviderEvent('gift', gift(), ROOM));
    r.advance(30_001);
    r.observer.tick();
    assert.ok(
        r.lines.some(
            (line) => JSON.parse(line).reason === 'sequence_interrupted',
        ),
    );
    const next = r.observer.observe(
        normalizeProviderEvent('gift', gift(3, 1, '2'), ROOM),
    );
    assert.ok(next.includes('final_without_prior'));
    r.observer.interrupt();
});

test('diagnóstico limita armazenamento e permite analisar eventos sem assumir deduplicação definitiva', () => {
    const r = rig();
    for (let i = 1; i <= 257; i += 1) {
        const event = normalizeProviderEvent(
            'gift',
            { ...gift(1, 0, String(i)), groupId: String(i) },
            ROOM,
        );
        const notes = r.observer.observe(event);
        if (i === 257) assert.ok(notes.includes('tracking_capacity'));
    }
    r.advance(61_000);
    r.observer.tick();
    assert.ok(
        r.observer
            .observe(normalizeProviderEvent('gift', gift(), ROOM))
            .includes('sequence_started'),
    );
});

test('logs usam whitelist, pseudônimos efêmeros e nunca serializam texto ou campos secretos', () => {
    const r = rig();
    const secret = {
        ...chat(),
        content: 'private-comment-token',
        signature: 'signature-private',
        cookies: 'cookie-private',
        user: { id: USER, nickname: 'nickname-private' },
    };
    r.observer.observe(normalizeProviderEvent('comment', secret, ROOM));
    r.observer.observe(
        normalizeProviderEvent(
            'gift',
            { ...gift(), gift: { ...gift().gift, name: 'gift-private' } },
            ROOM,
        ),
    );
    const output = r.lines.join('\n');
    for (const value of [
        ROOM,
        USER,
        chat().common.msgId,
        'private-comment-token',
        'signature-private',
        'cookie-private',
        'nickname-private',
        'gift-private',
    ])
        assert.ok(!output.includes(value), value);
    const lines2: string[] = [];
    createDiagnosticLogger((line) => lines2.push(line)).observation(
        normalizeProviderEvent('comment', secret, ROOM),
        [],
    );
    assert.notEqual(JSON.parse(r.lines[0]).user, JSON.parse(lines2[0]).user);
    assert.equal(JSON.parse(r.lines[0]).textLength, secret.content.length);
});

test('limites de frequência e tamanho produzem resumo em vez de logs ilimitados', () => {
    const r = rig();
    for (let i = 0; i < 1000; i += 1)
        r.observer.observe(
            normalizeProviderEvent('comment', chat(String(i + 1)), ROOM),
        );
    assert.ok(r.lines.length <= 20);
    assert.ok(r.lines.every((line) => Buffer.byteLength(line) <= 2048));
    r.advance(1001);
    r.logger.lifecycle('connected', 0);
    assert.ok(
        r.lines.some(
            (line) => JSON.parse(line).category === 'diagnostic_limit',
        ),
    );
});

test('configuração desligada por padrão; opt-in, conta e debug são validados sem credenciais no erro', () => {
    assert.equal(readDiagnosticConfig({}).enabled, false);
    assert.equal(
        readDiagnosticConfig({
            TIKTOK_DIAGNOSTIC_ENABLED: 'true',
            TIKTOK_USERNAME: 'fixture.user',
        }).enabled,
        true,
    );
    for (const env of [
        { TIKTOK_DIAGNOSTIC_ENABLED: 'yes' },
        { TIKTOK_DIAGNOSTIC_ENABLED: 'true' },
        { TIKTOK_DIAGNOSTIC_ENABLED: 'true', TIKTOK_USERNAME: '@bad' },
        {
            TIKTOK_DIAGNOSTIC_ENABLED: 'true',
            TIKTOK_USERNAME: 'valid',
            NODE_ENV: 'test',
        },
        {
            TIKTOK_DIAGNOSTIC_ENABLED: 'true',
            TIKTOK_USERNAME: 'valid',
            DEBUG_DESERIALIZE_XD: '1',
        },
        {
            TIKTOK_DIAGNOSTIC_ENABLED: 'true',
            TIKTOK_USERNAME: 'valid',
            NODE_DEBUG: 'http',
        },
    ])
        assert.throws(() => readDiagnosticConfig(env));
});

test('desligado não constrói conector; stop imediato não inicia conexão atrasada', async () => {
    const off = rig(undefined, false);
    off.client.start();
    await drain();
    assert.equal(off.clients.length, 0);
    await off.client.stop();
    const r = rig();
    r.client.start();
    await r.client.stop();
    await drain();
    assert.equal(r.clients[0].connects, 0);
});

test('conexão confirmada apenas após handshake; eventos anteriores não são apresentados como recebidos prontos', async () => {
    let resolve!: (value: unknown) => void;
    const r = rig(() => {
        const c = new FakeClient();
        c.result = () =>
            new Promise((done) => {
                resolve = done;
            });
        return c;
    });
    r.client.start();
    await drain();
    r.clients[0].emit('chat', chat());
    assert.equal(r.client.state(), 'connecting');
    assert.ok(!r.lines.some((line) => JSON.parse(line).category === 'comment'));
    resolve({ roomId: ROOM });
    await drain();
    r.clients[0].emit('chat', chat());
    assert.equal(r.client.state(), 'connected');
    assert.ok(r.lines.some((line) => JSON.parse(line).category === 'comment'));
    await r.client.stop();
});

test('desconexão limpa listeners e reconecta com backoff, sem consumir callbacks antigos', async () => {
    const r = rig();
    r.client.start();
    await drain();
    const oldHandler = r.clients[0].listeners('chat')[0] as (
        value: unknown,
    ) => void;
    r.clients[0].emit('disconnected', {});
    await drain();
    assert.equal(r.clients[0].listenerCount('chat'), 0);
    assert.equal(r.client.state(), 'reconnecting');
    oldHandler(chat());
    assert.ok(!r.lines.some((line) => JSON.parse(line).category === 'comment'));
    r.fire(1000);
    await drain();
    assert.equal(r.client.state(), 'connected');
    assert.equal(r.clients.length, 2);
    r.clients[1].emit('chat', chat());
    assert.ok(r.lines.some((line) => JSON.parse(line).category === 'comment'));
    await r.client.stop();
});

test('erros do provedor não vazam mensagens e as tentativas possuem orçamento limitado', async () => {
    const r = rig(() => {
        const c = new FakeClient();
        c.result = async () => {
            c.emit('error', new Error('secret-cookie-signature'));
            throw new Error('private-token');
        };
        return c;
    });
    r.client.start();
    await drain();
    for (const delay of [1000, 2000, 4000, 8000, 16000]) {
        r.fire(delay);
        await drain();
    }
    assert.equal(r.clients.length, 6);
    assert.equal(r.client.state(), 'stopped');
    assert.equal(r.client.reason(), 'retry_exhausted');
    assert.ok(!r.lines.join('').includes('secret-cookie-signature'));
    assert.ok(!r.lines.join('').includes('private-token'));
});

test('timeout de connect encerra diagnóstico sem abrir tentativa paralela; resultado tardio é desconectado', async () => {
    let resolve!: (value: unknown) => void;
    const r = rig(() => {
        const c = new FakeClient();
        c.result = () =>
            new Promise((done) => {
                resolve = done;
            });
        return c;
    });
    r.client.start();
    await drain();
    r.fire(15_000);
    await drain();
    assert.equal(r.client.state(), 'stopped');
    assert.equal(r.client.reason(), 'connect_timeout');
    assert.equal(r.clients.length, 1);
    resolve({ roomId: ROOM });
    await drain();
    assert.equal(r.client.state(), 'stopped');
    assert.ok(r.clients[0].disconnects >= 2);
});

test('limpeza incerta encerra em vez de criar uma segunda autoridade de conexão', async () => {
    const r = rig(() => {
        const c = new FakeClient();
        c.cleanup = () => new Promise(() => {});
        return c;
    });
    r.client.start();
    await drain();
    r.clients[0].emit('disconnected', {});
    await drain();
    r.fire(2500);
    await drain();
    assert.equal(r.client.state(), 'stopped');
    assert.equal(r.client.reason(), 'cleanup_timeout');
    assert.equal(r.clients.length, 1);
});

test('fim da LIVE e encerramento controlado não reconectam', async () => {
    const r = rig();
    r.client.start();
    await drain();
    r.clients[0].emit('gift', gift());
    r.clients[0].emit('streamEnd', {});
    await drain();
    assert.equal(r.client.reason(), 'stream_ended');
    assert.equal(r.client.state(), 'stopped');
    assert.equal(r.timers.size, 0);
    await r.client.stop();
    assert.equal(r.clients[0].listenerCount('gift'), 0);
});

test('flood de eventos é limitado antes da normalização', async () => {
    const r = rig();
    r.client.start();
    await drain();
    for (let n = 1; n <= 500; n += 1)
        r.clients[0].emit('chat', chat(String(n)));
    assert.ok(r.lines.length <= 20);
    await r.client.stop();
});

test('fronteira SDK valida exports e configura privacidade/abort sem abrir LIVE', async () => {
    const sign = { baseOptions: {} };
    const deserialize = {
        showBase64OnDecodeError: true,
        includeMessageTypes: null as string[] | null,
    };
    let options: Record<string, unknown> = {};
    class Sdk extends FakeClient {
        constructor(_username: string, opts: Record<string, unknown>) {
            super();
            options = opts;
        }
        wsClient = { terminate() {} };
    }
    const factory = await createProviderFactory(
        { enabled: true, username: 'synthetic' },
        async () => ({
            TikTokLiveConnection: Sdk,
            SignConfig: sign,
            WebcastDeserializeConfig: deserialize,
        }),
    );
    const client = factory();
    await client.disconnect();
    await assert.rejects(() => client.connect(), /cancelled/);
    assert.equal(options.authenticateWs, false);
    assert.equal(options.processInitialData, false);
    assert.equal(deserialize.showBase64OnDecodeError, false);
    await assert.rejects(
        () =>
            createProviderFactory(
                { enabled: true, username: 'synthetic' },
                async () => ({}),
            ),
        /Unsupported/,
    );
});

test('SDK instalado pode ser carregado e cancelado sem chamadas de rede', async () => {
    const factory = await createProviderFactory({
        enabled: true,
        username: 'synthetic',
    });
    const client = factory();
    await client.disconnect();
    await assert.rejects(() => client.connect(), /cancelled/);
});

test('entrypoint padrão termina desligado e não revela configuração privada', () => {
    const result = spawnSync(process.execPath, ['src/tiktok/main.ts'], {
        cwd: new URL('../', import.meta.url),
        env: {
            ...process.env,
            TIKTOK_DIAGNOSTIC_ENABLED: 'false',
            TIKTOK_SIGN_API_KEY: 'secret-never-print',
        },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('disabled'));
    assert.ok(!result.stdout.includes('secret-never-print'));
});

test('eventos observados não alteram motor, SQLite ou sessão WebSocket simulada', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'duelo-tiktok-isolation-'));
    const engine = createScoringEngine({
        origin: 'offline',
        roomId: 'room',
        domain: 'simulation',
    });
    const storage = openSqliteScoring({
        filename: join(dir, 'fixture.sqlite'),
        mode: 'create',
        engine: { origin: 'offline', roomId: 'room', domain: 'simulation' },
    });
    t.after(() => {
        storage.close();
        rmSync(dir, { recursive: true, force: true });
    });
    const simulation = createSimulationSession(true);
    const before = [
        engine.snapshot(),
        storage.snapshot(),
        simulation.snapshot(),
    ];
    const r = rig();
    r.client.start();
    await drain();
    r.clients[0].emit('chat', chat());
    r.clients[0].emit('gift', gift(3, 1));
    await r.client.stop();
    const observation = normalizeProviderEvent('comment', chat(), ROOM);
    assert.equal(engine.process(observation).status, 'rejected');
    assert.equal(storage.process(observation).status, 'rejected');
    assert.deepEqual(
        [engine.snapshot(), storage.snapshot(), simulation.snapshot()],
        before,
    );
    const directory = new URL('../src/tiktok/', import.meta.url);
    for (const filename of readdirSync(directory).filter((file) =>
        file.endsWith('.ts'),
    )) {
        const source = readFileSync(new URL(filename, directory), 'utf8');
        assert.ok(
            !/from ['"][^'"]*(scoring|persistence|realtime|frontend)/.test(
                source,
            ),
            filename,
        );
    }
});

test('stop durante backoff cancela a próxima conexão', async () => {
    const r = rig();
    r.client.start();
    await drain();
    r.clients[0].emit('disconnected', {});
    await drain();
    assert.ok(r.timers.size > 0);
    await r.client.stop();
    await drain();
    assert.equal(r.timers.size, 0);
    assert.equal(r.clients.length, 1);
});

test('mudança de sala na reconexão mantém os contextos observados separados', async () => {
    let count = 0;
    const r = rig(() => {
        const c = new FakeClient();
        count += 1;
        c.result = async () => ({
            roomId: count === 1 ? ROOM : '7312345678901234568',
        });
        return c;
    });
    r.client.start();
    await drain();
    r.clients[0].emit('disconnected', {});
    await drain();
    r.fire(1000);
    await drain();
    r.clients[1].emit('chat', chat());
    assert.ok(
        r.lines.some((line) => JSON.parse(line).reason === 'room_changed'),
    );
    assert.ok(
        r.lines.some((line) =>
            JSON.parse(line).reasons?.includes('ROOM_CONFLICT'),
        ),
    );
    await r.client.stop();
});
