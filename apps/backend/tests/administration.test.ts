import { fileURLToPath } from 'node:url';
import { writeNewLocalJson } from '../src/local-json.ts';
import { makePublicFixture } from './helpers/platform.ts';
import { defer, track } from './helpers/resources.ts';
import { request as httpRequest } from 'node:http';
import {
    SCHEMA,
    SCHEMA_VERSION,
    APPLICATION_ID,
} from '../src/persistence/schema.ts';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once, EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import { openSqliteScoring } from '../src/persistence/sqlite.ts';
import { createAdministrationService } from '../src/admin/service.ts';
import {
    makeCredential,
    readCredential,
    verifyCredential,
} from '../src/admin/credentials.ts';
import {
    createAdministrationServer,
    readAdministrationConfig,
    loadAdministrationAssets,
} from '../src/admin/server.ts';
import { parseReviewedCatalog } from '../src/integration/config.ts';
import { startRealRuntime } from '../src/integration/runtime.ts';
import { createBackendServer } from '../src/server.ts';
import {
    TIKTOK_ORIGIN,
    validateRealOccurrence,
} from '../src/integration/ingress.ts';
import {
    parseEvent,
    fingerprint,
    eventIdentity,
} from '../src/scoring/validation.ts';
import { createScoringEngine } from '../src/scoring/engine.ts';
import { ADMIN_ORIGIN } from '../src/scoring/administration.ts';
import { ROOM, USER, gift } from './fixtures/tiktok.ts';
const gifts = parseReviewedCatalog([
    {
        match: 'id',
        giftId: '5655',
        name: 'Rose',
        candidate: 'lula',
        points: 2,
        delivery: 'cumulative-final',
    },
    {
        match: 'id',
        giftId: '8239',
        name: 'White Rose',
        candidate: 'flavio',
        points: 2,
        delivery: 'single',
    },
]);
const engine = {
    origin: TIKTOK_ORIGIN,
    roomId: ROOM,
    domain: 'real' as const,
    enableRealScoring: true as const,
    sourcePolicy: 'synthetic-admin-context',
    catalog: gifts.map(({ delivery: _delivery, ...rule }) => rule),
};
const credential = makeCredential(
    'operador',
    'synthetic-password-only-for-tests',
);
async function json(response: Response) {
    return (await response.json()) as {
        csrf: string;
        state: { sessionId: string; version: number };
        rules: unknown[];
        history: unknown[];
        possibleDuplicates: unknown[];
        decision: { status: string };
    };
}
const localFetch = (url: string, init: RequestInit = {}): Promise<Response> =>
    new Promise((resolve, reject) => {
        const request = httpRequest(
            url,
            {
                agent: false,
                method: init.method ?? 'GET',
                headers: init.headers as Record<string, string>,
            },
            (response) => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                response.on('error', reject);
                response.on('end', () => {
                    const headers = new Headers();
                    for (const [key, value] of Object.entries(
                        response.headers,
                    )) {
                        if (Array.isArray(value))
                            for (const item of value) headers.append(key, item);
                        else if (value !== undefined) headers.set(key, value);
                    }
                    resolve(
                        new Response(Buffer.concat(chunks), {
                            status: response.statusCode,
                            headers,
                        }),
                    );
                });
            },
        );
        request.on('error', reject);
        request.end(init.body as string | undefined);
    });
const reason = 'Reconciliação sintética documentada pelo operador';
function temp(t: TestContext) {
    const dir = mkdtempSync(join(tmpdir(), 'duelo-admin-'));
    defer(t, () => rmSync(dir, { recursive: true, force: true }));
    return dir;
}
function award(sessionId: string, extra: Record<string, unknown> = {}) {
    return {
        operationId: randomUUID(),
        sessionId,
        candidate: 'lula',
        ruleId: '5655',
        quantity: 13,
        justification: reason,
        link: null,
        correctionOf: null,
        reconciliationConfirmed: true,
        ...extra,
    };
}
function rig(t: TestContext, overrides: Partial<typeof engine> = {}) {
    const filename = join(temp(t), 'score.sqlite');
    let storage = track(
        t,
        openSqliteScoring({
            filename,
            mode: 'create',
            engine: { ...engine, ...overrides },
        }),
    );
    let service = createAdministrationService(storage, {
        roomId: ROOM,
        assertAuthority() {},
        publish() {},
    });
    defer(t, () => storage.close());
    return {
        filename,
        get storage() {
            return storage;
        },
        get service() {
            return service;
        },
        restart() {
            storage.close();
            storage = track(
                t,
                openSqliteScoring({
                    filename,
                    mode: 'resume',
                    engine: { ...engine, ...overrides },
                }),
            );
            service = createAdministrationService(storage, {
                roomId: ROOM,
                assertAuthority() {},
                publish() {},
            });
            return storage.snapshot();
        },
    };
}
const source = (id: string, count = 1, final = 1, sequence = '9001') => {
    const raw = {
        ...gift(count, final, id),
        giftId: '5655',
        gift: { id: '5655', name: 'Rose', type: 1, combo: true },
        groupId: sequence,
    };
    const result = validateRealOccurrence('gift', raw, ROOM, ROOM, gifts);
    assert.ok(result.event);
    return result.event;
};
test('admin: catálogo autoritativo, justificativa, operador, data, versão e histórico recuperável', (t) => {
    const r = rig(t),
        request = award(r.storage.snapshot().sessionId);
    assert.equal(r.service.execute('operador', 'award', request).points, 26);
    assert.equal(r.storage.snapshot().scores.lula, 26);
    const db = track(t, new Database(r.filename));
    assert.equal(
        JSON.parse(
            (
                db.prepare('SELECT event_json FROM journal').get() as {
                    event_json: string;
                }
            ).event_json,
        ).appliedPoints,
        26,
    );
    db.close();
    const view = r.service.view(),
        op = view.operations[0];
    assert.equal(op.operatorId, 'operador');
    assert.equal(op.quantity, 13);
    assert.equal(op.points, 26);
    assert.equal(op.ruleId, '5655');
    assert.equal(op.justification, reason);
    assert.equal(op.state, 'applied');
    assert.equal(op.version, 1);
    assert.ok(Number.isFinite(Date.parse(op.at)));
    const state = r.restart();
    assert.deepEqual(state, view.state);
    assert.deepEqual(r.service.view().operations, view.operations);
});
test('admin: ID estável, timestamp do servidor preservado, duplicação e conflito entre operadores/tipos', (t) => {
    const r = rig(t),
        request = award(r.storage.snapshot().sessionId);
    r.service.execute('operador', 'award', request);
    r.restart();
    assert.equal(
        r.service.execute('operador', 'award', request).status,
        'duplicate',
    );
    for (const change of [
        { quantity: 2 },
        { justification: 'Outra justificativa sintética' },
    ])
        assert.equal(
            r.service.execute('operador', 'award', { ...request, ...change })
                .reason,
            'IDENTITY_CONFLICT',
        );
    assert.equal(
        r.service.execute('outro_operador', 'award', request).reason,
        'IDENTITY_CONFLICT',
    );
    assert.equal(
        r.service.execute('operador', 'reversal', {
            operationId: request.operationId,
            sessionId: request.sessionId,
            targetOperationId: request.operationId,
            justification: reason,
        }).reason,
        'IDENTITY_CONFLICT',
    );
    assert.equal(r.storage.snapshot().scores.lula, 26);
    assert.equal(r.service.view().operations.length, 1);
});
test('admin: rejeita pontos do cliente, quantidades inválidas, regra não aprovada e participante divergente', (t) => {
    const r = rig(t),
        base = award(r.storage.snapshot().sessionId);
    for (const change of [
        { points: 1 },
        { origin: 'tiktok' },
        { operatorId: 'outro' },
        { at: '2026-01-01T00:00:00.000Z' },
        { quantity: '13' },
        { quantity: 0 },
        { quantity: -1 },
        { quantity: 1.5 },
        { quantity: NaN },
        { quantity: Infinity },
        { quantity: Number.MAX_SAFE_INTEGER + 1 },
        { justification: 'curta' },
        { reconciliationConfirmed: false },
        { operationId: '113' },
    ])
        assert.throws(
            () =>
                r.service.execute('operador', 'award', { ...base, ...change }),
            /INVALID_REQUEST/,
        );
    for (const change of [
        { ruleId: '5487' },
        { ruleId: 'name:heart' },
        { ruleId: '5576' },
        { candidate: 'flavio' },
    ])
        assert.equal(
            r.service.execute('operador', 'award', { ...base, ...change })
                .reason,
            'UNAUTHORIZED_RULE',
        );
    assert.throws(
        () =>
            r.service.execute('operador', 'award', {
                ...base,
                sessionId: 'other',
            }),
        /SESSION_MISMATCH/,
    );
    assert.equal(r.storage.snapshot().version, 0);
});
test('admin: overflow não grava identidade, auditoria ou placar parcial', (t) => {
    const r = rig(t),
        request = award(r.storage.snapshot().sessionId, {
            quantity: Number.MAX_SAFE_INTEGER,
        });
    assert.equal(
        r.service.execute('operador', 'award', request).reason,
        'SCORE_LIMIT',
    );
    assert.equal(r.service.view().operations.length, 0);
    assert.equal(r.storage.snapshot().version, 0);
    const sql = track(t, new Database(r.filename));
    assert.equal(
        (sql.prepare('SELECT count(*) n FROM journal').get() as { n: number })
            .n,
        0,
    );
    sql.close();
});
test('admin: estorno integral, prevenção de estorno duplo e correção vinculada sem apagar original', (t) => {
    const r = rig(t),
        request = award(r.storage.snapshot().sessionId);
    r.service.execute('operador', 'award', request);
    const reversal = {
        operationId: randomUUID(),
        sessionId: request.sessionId,
        targetOperationId: request.operationId,
        justification: reason,
    };
    assert.equal(
        r.service.execute('operador', 'reversal', reversal).points,
        -26,
    );
    assert.equal(
        r.service.execute('operador', 'reversal', reversal).status,
        'duplicate',
    );
    assert.equal(
        r.service.execute('operador', 'reversal', {
            ...reversal,
            operationId: randomUUID(),
        }).reason,
        'ALREADY_REVERSED',
    );
    assert.equal(
        r.service.execute('operador', 'reversal', {
            ...reversal,
            operationId: randomUUID(),
            targetOperationId: randomUUID(),
        }).reason,
        'OPERATION_NOT_FOUND',
    );
    assert.equal(r.storage.snapshot().scores.lula, 0);
    const corrected = award(request.sessionId, {
        quantity: 3,
        correctionOf: request.operationId,
    });
    assert.equal(r.service.execute('operador', 'award', corrected).points, 6);
    assert.equal(
        r.service.execute('operador', 'award', {
            ...corrected,
            operationId: randomUUID(),
        }).reason,
        'INVALID_CORRECTION',
    );
    r.restart();
    const ops = r.service.view().operations;
    assert.equal(ops.length, 3);
    assert.equal(ops[0].state, 'reversed');
    assert.equal(ops[1].reference, request.operationId);
    assert.equal(ops[2].reference, request.operationId);
    assert.equal(r.storage.snapshot().scores.lula, 6);
});
test('admin: transação falha faz rollback de pontuação, identidade e histórico; nova tentativa é única', (t) => {
    const r = rig(t),
        request = award(r.storage.snapshot().sessionId);
    const before = r.storage.snapshot();
    const db = track(t, new Database(r.filename));
    db.exec(
        "CREATE TRIGGER fail_admin BEFORE UPDATE ON dispute BEGIN SELECT RAISE(ABORT, 'synthetic transaction'); END",
    );
    assert.throws(
        () => r.service.execute('operador', 'award', request),
        /synthetic transaction/,
    );
    assert.deepEqual(r.service.view(), { state: before, operations: [] });
    db.exec('DROP TRIGGER fail_admin');
    db.close();
    r.restart();
    assert.equal(r.service.execute('operador', 'award', request).points, 26);
    assert.equal(
        r.service.execute('operador', 'award', request).status,
        'duplicate',
    );
});
test('admin: falha de publicação após commit não permite reaplicar operação', (t) => {
    const r = rig(t),
        request = award(r.storage.snapshot().sessionId);
    const service = createAdministrationService(r.storage, {
        roomId: ROOM,
        assertAuthority() {},
        publish() {
            throw new Error('synthetic transport');
        },
    });
    assert.throws(
        () => service.execute('operador', 'award', request),
        /transport/,
    );
    r.restart();
    assert.equal(
        r.service.execute('operador', 'award', request).status,
        'duplicate',
    );
    assert.equal(r.storage.snapshot().version, 1);
});
test('admin: solicitações concorrentes serializam sem perda e repetição não publica duas vezes', async (t) => {
    const r = rig(t),
        request = award(r.storage.snapshot().sessionId, { quantity: 1 });
    let published = 0;
    const service = createAdministrationService(r.storage, {
        roomId: ROOM,
        assertAuthority() {},
        publish() {
            published++;
        },
    });
    const results = await Promise.all(
        Array.from({ length: 12 }, () =>
            Promise.resolve().then(() =>
                service.execute('operador', 'award', request),
            ),
        ),
    );
    assert.equal(
        results.filter((result) => result.status === 'applied').length,
        1,
    );
    assert.equal(published, 1);
    await Promise.all(
        Array.from({ length: 12 }, () =>
            Promise.resolve().then(() =>
                service.execute(
                    'operador',
                    'award',
                    award(request.sessionId, { quantity: 1 }),
                ),
            ),
        ),
    );
    assert.equal(r.storage.snapshot().scores.lula, 26);
    assert.equal(published, 13);
});
test('admin: evidência de ocorrência/sequência já persistida nunca autoriza dupla contagem', (t) => {
    const r = rig(t);
    r.storage.process(source('1001', 1, 0));
    const base = award(r.storage.snapshot().sessionId, {
        link: { eventId: '1001', actorId: USER, sequenceId: '9001' },
    });
    assert.equal(
        r.service.execute('operador', 'award', base).reason,
        'SOURCE_ALREADY_RECORDED',
    );
    assert.equal(
        r.service.execute('operador', 'award', {
            ...base,
            operationId: randomUUID(),
            link: { eventId: '1002', actorId: USER, sequenceId: '9001' },
        }).reason,
        'SOURCE_ALREADY_RECORDED',
    );
    assert.equal(r.storage.snapshot().version, 0);
});
test('admin: vínculo declarado não falsifica evento TikTok e mantém reserva após estorno/reinício', (t) => {
    const r = rig(t),
        request = award(r.storage.snapshot().sessionId, {
            quantity: 1,
            link: { eventId: '1001', actorId: USER, sequenceId: '9001' },
        });
    assert.equal(r.service.execute('operador', 'award', request).points, 2);
    r.restart();
    assert.equal(
        r.service.execute('operador', 'award', {
            ...request,
            operationId: randomUUID(),
        }).reason,
        'SOURCE_ALREADY_CLAIMED',
    );
    assert.equal(
        r.storage.process(source('1001')).reason,
        'MANUAL_RECONCILIATION_REQUIRED',
    );
    assert.equal(
        r.storage.process(source('1002', 3, 1)).reason,
        'MANUAL_RECONCILIATION_REQUIRED',
    );
    assert.equal(r.storage.process(source('1003', 2, 1, '9002')).points, 4);
    r.service.execute('operador', 'reversal', {
        operationId: randomUUID(),
        sessionId: request.sessionId,
        targetOperationId: request.operationId,
        justification: reason,
    });
    r.restart();
    assert.equal(
        r.storage.process(source('1004', 3, 1)).reason,
        'MANUAL_RECONCILIATION_REQUIRED',
    );
    assert.equal(r.storage.snapshot().scores.lula, 4);
});
test('admin: IDs de origens diferentes não colidem; link malformado e tentativa de promoção são recusados', (t) => {
    const r = rig(t),
        request = award(r.storage.snapshot().sessionId);
    for (const link of [
        { eventId: 1001, actorId: USER, sequenceId: null },
        { eventId: '1', actorId: USER, sequenceId: null, origin: 'evil' },
        { eventId: '1', actorId: 'unsafe', sequenceId: null },
    ])
        assert.throws(
            () => r.service.execute('operador', 'award', { ...request, link }),
            /INVALID_REQUEST/,
        );
    const event = parseEvent({
        origin: ADMIN_ORIGIN,
        roomId: ROOM,
        domain: 'real',
        eventId: request.operationId,
        actorId: 'operador',
        type: 'admin.award',
        adminVersion: 'admin-v1',
        sessionId: request.sessionId,
        at: '2026-10-22T12:00:00.000Z',
        justification: reason,
        candidate: 'lula',
        ruleId: '5655',
        quantity: 1,
        link: null,
        correctionOf: null,
        reconciliationConfirmed: true,
    });
    assert.ok(event);
    assert.notEqual(
        eventIdentity(event),
        eventIdentity({ ...event, origin: TIKTOK_ORIGIN, type: 'gift' }),
    );
    assert.ok(fingerprint(event).includes('admin-v1'));
    assert.equal(
        validateRealOccurrence(
            'gift',
            { ...gift(1, 1), ...event },
            ROOM,
            ROOM,
            gifts,
        ).event,
        undefined,
    );
    for (const domain of ['simulation', 'observation'] as const) {
        const scorer = createScoringEngine({
            origin: 'local',
            roomId: ROOM,
            domain,
        });
        assert.equal(scorer.process(event).points, 0);
    }
});
test('admin: adulteração de auditoria ou estado bloqueia recuperação sem zerar', (t) => {
    const r = rig(t);
    r.service.execute(
        'operador',
        'award',
        award(r.storage.snapshot().sessionId),
    );
    r.storage.close();
    const db = track(t, new Database(r.filename));
    db.exec(
        "UPDATE journal SET event_json=replace(event_json, 'Reconciliação', 'Adulteração')",
    );
    db.close();
    assert.throws(() => r.restart(), /digest/);
});
test('credenciais: hash nativo, arquivo externo privado, senha não armazenada e padrão desligado', async (t) => {
    assert.equal(readAdministrationConfig({}), null);
    assert.equal(readAdministrationConfig({ ADMIN_ENABLED: 'false' }), null);
    assert.throws(() => readAdministrationConfig({ ADMIN_ENABLED: 'true' }));
    assert.throws(() => makeCredential('operador', 'short'));
    assert.throws(() => makeCredential('<script>', 'long-synthetic-password'));
    const path = join(temp(t), 'credential.json');
    writeNewLocalJson(path, credential);
    assert.deepEqual(readCredential(path), credential);
    assert.ok(!readFileSync(path, 'utf8').includes('synthetic-password'));
    assert.equal(
        await verifyCredential(
            credential,
            'operador',
            'synthetic-password-only-for-tests',
        ),
        true,
    );
    assert.equal(
        await verifyCredential(
            credential,
            'outro',
            'synthetic-password-only-for-tests',
        ),
        false,
    );
    assert.equal(
        await verifyCredential(credential, 'operador', 'invalid'),
        false,
    );
    makePublicFixture(path);
    assert.throws(() => readCredential(path));
});
async function httpRig(t: TestContext, clock?: () => number) {
    const r = rig(t);
    const admin = createAdministrationServer({
        credential,
        service: r.service,
        gifts,
        connection: () => 'reconnecting',
        assets: new Map([
            [
                'index.html',
                {
                    type: 'text/html',
                    data: Buffer.from('<h1>Private panel</h1>'),
                },
            ],
            [
                'login.html',
                { type: 'text/html', data: Buffer.from('<h1>Login</h1>') },
            ],
        ]),
        now: clock,
    });
    admin.server.listen(0, '127.0.0.2');
    await once(admin.server, 'listening');
    const address = admin.server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.2:${address.port}`;
    defer(t, () => admin.close());
    let cookie = '',
        csrf = '';
    const request = (
        path: string,
        body?: unknown,
        headers: Record<string, string> = {},
    ) =>
        localFetch(origin + '/admin/api/' + path, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
                'X-Admin-Request': '1',
                ...(body === undefined
                    ? {}
                    : {
                          'Content-Type': 'application/json',
                          Origin: origin,
                          'X-CSRF-Token': csrf,
                      }),
                ...(cookie ? { Cookie: cookie } : {}),
                ...headers,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    async function login() {
        const response = await request('login', {
            operator: 'operador',
            password: 'synthetic-password-only-for-tests',
        });
        assert.equal(response.status, 200);
        cookie = response.headers.get('set-cookie')!.split(';')[0];
        csrf = (await json(response)).csrf;
        return response;
    }
    return {
        ...r,
        origin,
        request,
        login,
        get cookie() {
            return cookie;
        },
        get csrf() {
            return csrf;
        },
        admin,
    };
}
test('HTTP: autenticação, sessão, CSRF, origem, separação pública e logout', async (t) => {
    const r = await httpRig(t);
    assert.equal(
        await (await localFetch(r.origin + '/admin/')).text(),
        '<h1>Login</h1>',
    );
    assert.equal((await r.request('state')).status, 401);
    assert.equal((await r.request('award', {})).status, 401);
    assert.equal(
        (await r.request('login', { operator: 'operador', password: 'wrong' }))
            .status,
        401,
    );
    assert.equal(
        (
            await r.request(
                'login',
                { operator: 'operador', password: 'wrong' },
                { Origin: 'https://evil.example' },
            )
        ).status,
        403,
    );
    const response = await r.login();
    const cookie = response.headers.get('set-cookie')!;
    assert.ok(cookie.includes('HttpOnly'));
    assert.ok(cookie.includes('SameSite=Strict'));
    assert.ok(cookie.includes('Path=/admin'));
    assert.ok(!cookie.includes('Domain='));
    assert.equal(
        await (
            await localFetch(r.origin + '/admin/', {
                headers: { Cookie: r.cookie },
            })
        ).text(),
        '<h1>Private panel</h1>',
    );
    const state = await r.request('state');
    assert.equal(state.status, 200);
    const data = await json(state);
    assert.equal(data.rules.length, 2);
    assert.equal(data.history.length, 0);
    assert.ok(!JSON.stringify(data).includes(credential.hash));
    const request = award(data.state.sessionId);
    assert.equal(
        (await r.request('award', request, { 'X-CSRF-Token': 'invalid' }))
            .status,
        403,
    );
    assert.equal(
        (await r.request('award', request, { Origin: 'http://127.0.0.1:5173' }))
            .status,
        403,
    );
    assert.equal(
        (await r.request('award', { ...request, points: 1 })).status,
        400,
    );
    assert.equal((await r.request('award', request)).status, 200);
    assert.equal(
        (await json(await r.request('award', request))).decision.status,
        'duplicate',
    );
    assert.equal(
        (await json(await r.request('state?ruleId=5655&quantity=13')))
            .possibleDuplicates.length,
        1,
    );
    assert.equal(
        (await r.request('state', undefined, { 'X-Admin-Request': '' })).status,
        403,
    );
    assert.equal((await localFetch(r.origin + '/arena/mode')).status, 404);
    assert.equal((await r.request('logout', {})).status, 200);
    assert.equal((await r.request('state')).status, 401);
});
test('HTTP: limite de login, expiração de sessão e rotação contra fixation', async (t) => {
    let time = 100000;
    const r = await httpRig(t, () => time);
    await r.login();
    const old = r.cookie;
    await r.login();
    assert.notEqual(r.cookie, old);
    time += 600001;
    assert.equal((await r.request('state')).status, 401);
    for (let i = 0; i < 5; i++)
        assert.equal(
            (
                await r.request('login', {
                    operator: 'operador',
                    password: 'wrong',
                })
            ).status,
            401,
        );
    assert.equal(
        (await r.request('login', { operator: 'operador', password: 'wrong' }))
            .status,
        429,
    );
});
test('HTTP: falhas SQL são sanitizadas, corpo limitado e campos desconhecidos não modificam estado', async (t) => {
    const r = await httpRig(t);
    await r.login();
    const view = await json(await r.request('state'));
    const db = track(t, new Database(r.filename));
    db.exec(
        "CREATE TRIGGER fail_admin BEFORE UPDATE ON dispute BEGIN SELECT RAISE(ABORT, 'private-sql-detail'); END",
    );
    const response = await r.request('award', award(view.state.sessionId));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'ADMIN_UNAVAILABLE' });
    db.close();
    try {
        await r.request('award', { junk: 'x'.repeat(9000) });
    } catch {
        /* Limit can close the stream. */
    }
    assert.equal((await json(await r.request('state'))).state.version, 0);
});
test('runtime: administração publica após commit, retry não publica, arena recupera snapshot e rejeita escrita', async (t) => {
    class Provider extends EventEmitter {
        async connect() {
            throw new Error('offline synthetic');
        }
        async disconnect() {}
    }
    const server = createBackendServer('real');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const filename = join(temp(t), 'real.sqlite'),
        origin = 'http://127.0.0.1:5173';
    let fail = true,
        count = 0;
    const runtime = startRealRuntime({
        server,
        origin,
        config: {
            mode: 'real',
            username: 'synthetic_test',
            roomId: ROOM,
            filename,
            action: 'create',
            gifts,
            sourcePolicy: 'synthetic-admin-context',
        },
        factory: () => new Provider(),
        afterCommit(decision) {
            if (decision.status !== 'applied') return;
            const db = track(t, new Database(filename));
            assert.equal(
                (
                    db.prepare('SELECT version FROM dispute').get() as {
                        version: number;
                    }
                ).version,
                decision.state.version,
            );
            db.close();
            count++;
            if (fail) {
                fail = false;
                throw new Error('transport');
            }
        },
    });
    const admin = createAdministrationServer({
        credential,
        service: runtime.administration,
        gifts,
        connection: runtime.state,
        assets: new Map(),
    });
    admin.server.listen(0, '127.0.0.2');
    await once(admin.server, 'listening');
    const adminAddress = admin.server.address();
    assert.ok(adminAddress && typeof adminAddress !== 'string');
    const adminOrigin = `http://127.0.0.2:${adminAddress.port}`;
    const login = await localFetch(adminOrigin + '/admin/api/login', {
        method: 'POST',
        headers: {
            Origin: adminOrigin,
            'X-Admin-Request': '1',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            operator: 'operador',
            password: 'synthetic-password-only-for-tests',
        }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0],
        csrf = (await json(login)).csrf;
    const command = (kind: string, body: unknown) =>
        localFetch(adminOrigin + '/admin/api/' + kind, {
            method: 'POST',
            headers: {
                Origin: adminOrigin,
                'X-Admin-Request': '1',
                'Content-Type': 'application/json',
                Cookie: cookie,
                'X-CSRF-Token': csrf,
            },
            body: JSON.stringify(body),
        });
    const viewers: WebSocket[] = [];
    defer(t, async () => {
        await admin.close();
        viewers.forEach((ws) => ws.terminate());
        await runtime.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const viewer = async () => {
        const ws = new WebSocket(`ws://127.0.0.1:${address.port}/arena`, {
            origin,
        });
        viewers.push(ws);
        const [data] = await once(ws, 'message');
        return { ws, state: JSON.parse(data.toString()).state };
    };
    const first = await viewer();
    const closed = once(first.ws, 'close');
    const request = award(runtime.snapshot().sessionId);
    assert.equal((await command('award', request)).status, 200);
    await closed;
    const second = await viewer();
    assert.equal(second.state.scores.a, 26);
    assert.equal(
        (await json(await command('award', request))).decision.status,
        'duplicate',
    );
    assert.equal(count, 1);
    const update = once(second.ws, 'message');
    assert.equal(
        (
            await command('reversal', {
                operationId: randomUUID(),
                sessionId: request.sessionId,
                targetOperationId: request.operationId,
                justification: reason,
            })
        ).status,
        200,
    );
    assert.equal(JSON.parse((await update)[0].toString()).state.scores.a, 0);
    const denied = once(second.ws, 'message');
    second.ws.send(JSON.stringify({ type: 'admin.award', points: 999 }));
    assert.equal(
        JSON.parse((await denied)[0].toString()).code,
        'READ_ONLY_REAL_ARENA',
    );
    assert.equal(
        (await localFetch(`http://127.0.0.1:${address.port}/admin/api/state`))
            .status,
        404,
    );
});

test('legado v2 fixo: administração estende journal sem migrar schema, preserva fingerprints e combo anterior', (t) => {
    const fixture = JSON.parse(
        readFileSync(
            new URL('./fixtures/gift-id-v2.json', import.meta.url),
            'utf8',
        ),
    );
    const filename = join(temp(t), 'historical.sqlite');
    const db = track(t, new Database(filename));
    db.pragma('journal_mode=WAL');
    db.pragma('foreign_keys=ON');
    db.exec(SCHEMA);
    db.pragma(`application_id=${APPLICATION_ID}`);
    db.pragma(`user_version=${SCHEMA_VERSION}`);
    const cp = fixture.checkpoint,
        cfg = cp.configuration,
        state = cp.state;
    db.transaction(() => {
        db.prepare(
            'INSERT INTO dispute (singleton,session_id,origin,room_id,domain,source_policy,capacity,catalog_json,rules_version,version,lula,flavio,journal_count,digest) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ).run(
            state.sessionId,
            cfg.origin,
            cfg.roomId,
            cfg.domain,
            cfg.sourcePolicy,
            cfg.capacity,
            JSON.stringify(cfg.catalog),
            cfg.rulesVersion,
            state.version,
            state.scores.lula,
            state.scores.flavio,
            fixture.journal.length,
            fixture.digest,
        );
        fixture.journal.forEach((event: unknown, i: number) =>
            db
                .prepare('INSERT INTO journal VALUES (?,?,?)')
                .run(state.sessionId, i + 1, JSON.stringify(event)),
        );
        for (const event of cp.events)
            db.prepare('INSERT INTO event_identities VALUES (?,?,?)').run(
                state.sessionId,
                event.identity,
                event.fingerprint,
            );
        for (const sequence of cp.sequences)
            db.prepare(
                'INSERT INTO gift_sequences (session_id,identity,gift_id,actor_id,quantity,final,invalid) VALUES (?,?,?,?,?,?,?)',
            ).run(
                state.sessionId,
                sequence.identity,
                sequence.giftId,
                sequence.actorId,
                sequence.quantity,
                +sequence.final,
                +sequence.invalid,
            );
    })();
    const oldRows = db
        .prepare('SELECT event_json FROM journal ORDER BY position')
        .all();
    let storage = track(
        t,
        openSqliteScoring({
            filename,
            mode: 'resume',
            engine: fixture.options,
        }),
    );
    assert.deepEqual(storage.snapshot(), state);
    const service = createAdministrationService(storage, {
        roomId: cfg.roomId,
        assertAuthority() {},
        publish() {},
    });
    const request = award(state.sessionId);
    assert.equal(service.execute('operador', 'award', request).points, 26);
    storage.close();
    storage = track(
        t,
        openSqliteScoring({
            filename,
            mode: 'resume',
            engine: fixture.options,
        }),
    );
    try {
        assert.equal(storage.snapshot().scores.lula, 26);
        assert.equal(storage.administrationView().operations.length, 1);
        assert.equal(
            storage.process({
                ...fixture.journal[0],
                eventId: 'new-final',
                delivery: {
                    kind: 'combo',
                    sequenceId: '5001',
                    quantity: 3,
                    final: true,
                },
            }).points,
            6,
        );
        assert.deepEqual(
            db
                .prepare(
                    'SELECT event_json FROM journal ORDER BY position LIMIT 2',
                )
                .all(),
            oldRows,
        );
        for (const item of cp.events)
            assert.deepEqual(
                db
                    .prepare(
                        'SELECT identity,fingerprint FROM event_identities WHERE identity=?',
                    )
                    .get(item.identity),
                item,
            );
        assert.equal(db.pragma('user_version', { simple: true }), 2);
        assert.equal(storage.snapshot().scores.flavio, 20);
    } finally {
        storage.close();
        db.close();
    }
});

test('catálogo aprovado não é alterado pela administração; retomada incompatível continua bloqueada', (t) => {
    const r = rig(t);
    r.service.execute(
        'operador',
        'award',
        award(r.storage.snapshot().sessionId),
    );
    r.storage.close();
    assert.throws(
        () =>
            track(
                t,
                openSqliteScoring({
                    filename: r.filename,
                    mode: 'resume',
                    engine: { ...engine, catalog: [] },
                }),
            ),
        /context/,
    );
    assert.throws(
        () =>
            track(
                t,
                openSqliteScoring({
                    filename: r.filename,
                    mode: 'resume',
                    engine: { ...engine, sourcePolicy: 'different' },
                }),
            ),
        /context/,
    );
});

test('CLI de credencial usa stdin sem eco, cria arquivo novo e nunca imprime senha/hash', async (t) => {
    const { spawnSync } = await import('node:child_process');
    const path = join(temp(t), 'credential.json');
    const run = () =>
        spawnSync(
            process.execPath,
            [
                fileURLToPath(
                    new URL('../src/admin/credential-cli.ts', import.meta.url),
                ),
                '--operator',
                'operador',
                '--output',
                path,
            ],
            { input: 'synthetic-password-only-for-tests', encoding: 'utf8' },
        );
    const result = run();
    assert.equal(result.status, 0);
    assert.ok(!result.stdout.includes('synthetic-password'));
    assert.ok(!result.stdout.includes('hash'));
    assert.equal(readCredential(path).operator, 'operador');
    assert.notEqual(run().status, 0);
});
