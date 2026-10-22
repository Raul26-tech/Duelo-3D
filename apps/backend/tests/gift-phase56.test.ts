import { defer, track } from './helpers/resources.ts';
import { spawnSync } from 'node:child_process';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once, EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import Database from 'better-sqlite3';
import {
    loadReference,
    prepareActive,
    reviewTemplate,
    type GiftReview,
} from '../src/catalog-tools/catalog.ts';
import {
    catalogStatus,
    prepareExtension,
} from '../src/catalog-tools/phase56.ts';
import {
    assessGiftEvidence,
    parseGiftEvidence,
} from '../src/catalog-tools/evidence.ts';
import { runCatalogCli } from '../src/catalog-tools/main.ts';
import { readLocalJson, writeNewLocalJson } from '../src/local-json.ts';
import { createGiftReport, withGiftReport } from '../src/tiktok/gift-report.ts';
import {
    createDiagnosticLogger,
    createEventObserver,
} from '../src/tiktok/diagnostics.ts';
import { createDiagnosticClient } from '../src/tiktok/client.ts';
import { normalizeProviderEvent } from '../src/tiktok/normalize.ts';
import {
    validateRealOccurrence,
    TIKTOK_ORIGIN,
} from '../src/integration/ingress.ts';
import { createScoringEngine } from '../src/scoring/engine.ts';
import { openSqliteScoring } from '../src/persistence/sqlite.ts';
import { giftRuleKey } from '../src/scoring/catalog.ts';
import { createAdministrationService } from '../src/admin/service.ts';
import { createAdministrationServer } from '../src/admin/server.ts';
import { makeCredential } from '../src/admin/credentials.ts';
import { ROOM, USER } from './fixtures/tiktok.ts';

const reference = loadReference();
const four = ['5655', '5487', '8239', '14488'];
// Every approval and delivery below is a synthetic test attestation, never operational evidence.
function review(
    id: string,
    delivery: 'single' | 'cumulative-final' = 'single',
): GiftReview {
    const template = reviewTemplate(reference).find(
        (item) => item.giftId === id,
    )!;
    return {
        ...template,
        observedName: reference.find((gift) => gift.giftId === id)!.name,
        nameConfirmed: true,
        connectorFieldsReviewed: true,
        delivery,
        repeatCount: delivery === 'single' ? 'unit' : 'cumulative',
        repeatEnd: 'explicit-final',
        groupId: delivery === 'single' ? 'not-required' : 'sequence',
        operatorApproved: true,
    };
}
const baseReviews = () => four.map((id) => review(id));
const baseline = () => prepareActive(reference, baseReviews());
const settings = (active: ReturnType<typeof prepareActive>) => ({
    origin: TIKTOK_ORIGIN,
    roomId: ROOM,
    domain: 'real' as const,
    enableRealScoring: true as const,
    sourcePolicy: 'phase56-offline-only',
    catalog: active.map(({ delivery: _delivery, ...rule }) => rule),
});
function raw(
    id: string,
    name: string,
    msgId = '1001',
    count = 1,
    final = 1,
    combo = false,
) {
    return {
        common: { roomId: ROOM, msgId },
        user: { id: USER },
        giftId: id,
        gift: { id, name, type: combo ? 1 : 2, combo },
        groupId: combo ? '8001' : '0',
        repeatCount: count,
        repeatEnd: final,
    };
}
function observe() {
    const report = createGiftReport();
    const observer = withGiftReport(
        createEventObserver(createDiagnosticLogger(() => {})),
        report,
    );
    return {
        report,
        observer,
        receive: (value: unknown) =>
            observer.observe(normalizeProviderEvent('gift', value, ROOM)),
    };
}
function temporary(t: TestContext) {
    const path = mkdtempSync(join(tmpdir(), 'duelo-phase56-'));
    defer(t, () => rmSync(path, { recursive: true, force: true }));
    return path;
}

test('5.6: 14 referências, quatro autorizações relatadas e dez pendências distintas de configuração', () => {
    const status = catalogStatus(reference);
    assert.equal(status.length, 14);
    assert.deepEqual(
        status
            .filter(
                (item) =>
                    item.reportedAuthorization ===
                    'operator-reported-authorized',
            )
            .map((item) => item.referenceGiftId)
            .sort(),
        [...four].sort(),
    );
    assert.equal(
        status.filter((item) => item.reportedAuthorization === 'pending')
            .length,
        10,
    );
    assert.equal(
        status.filter((item) => item.proposedMatch === 'exact-name').length,
        8,
    );
    for (const id of ['5879', '6560']) {
        const gift = status.find((item) => item.referenceGiftId === id)!;
        assert.equal(gift.reportedAuthorization, 'pending');
        assert.equal(gift.idEvidence, 'operator-reported-live');
        assert.equal(gift.reviewedDelivery, null);
    }
    assert.ok(
        status.every(
            (item) =>
                item.configured === 'not-inspected' &&
                !item.authorizationGrantedByThisTool,
        ),
    );
    assert.deepEqual(prepareActive(reference, reviewTemplate(reference)), []);
    const configured = catalogStatus(reference, baseline());
    assert.equal(
        configured.filter((item) => item.configured === 'present').length,
        4,
    );
    assert.ok(
        catalogStatus(reference, []).every(
            (item) => item.configured === 'absent',
        ),
    );
});

for (const [index, gift] of reference.entries()) {
    test(`5.6: aprovação SINTÉTICA ${gift.name} preserva modalidade, pontos e deduplicação`, () => {
        const active = prepareActive(reference, [review(gift.giftId)]);
        const engine = createScoringEngine(settings(active));
        const result = validateRealOccurrence(
            'gift',
            raw(
                gift.match === 'exact-name'
                    ? String(999900 + index)
                    : gift.giftId,
                gift.name,
            ),
            ROOM,
            ROOM,
            active,
        );
        assert.ok(result.event);
        assert.equal(result.matchMode, gift.match);
        assert.equal(engine.process(result.event).points, gift.points);
        assert.equal(engine.process(result.event).status, 'duplicate');
        assert.equal(engine.snapshot().scores[gift.candidate], gift.points);
        const pending = createScoringEngine(settings([]));
        const unknown = validateRealOccurrence(
            'gift',
            raw(gift.giftId, gift.name),
            ROOM,
            ROOM,
            [],
        );
        assert.ok(unknown.event);
        assert.equal(pending.process(unknown.event).points, 0);
    });
}

test('5.6: extensão exige revisão completa e preserva quatro regras e formato legado sem substituição', () => {
    const previous = baseline();
    assert.deepEqual(
        prepareExtension(reference, previous, [
            ...baseReviews(),
            ...reviewTemplate(reference).filter(
                (item) => !four.includes(item.giftId),
            ),
        ]),
        previous,
    );
    const inputCopy = JSON.stringify(previous);
    const full = [...baseReviews(), review('5576')];
    const next = prepareExtension(reference, previous, full);
    assert.equal(next.length, 5);
    for (const rule of previous)
        assert.deepEqual(
            next.find((item) => giftRuleKey(item) === giftRuleKey(rule)),
            rule,
        );
    assert.equal(JSON.stringify(previous), inputCopy);
    assert.throws(
        () => prepareExtension(reference, previous, [review('5576')]),
        /preserve/,
    );
    assert.throws(
        () =>
            prepareExtension(reference, previous, [
                ...baseReviews().slice(1),
                review('5576'),
            ]),
        /preserve/,
    );
    assert.throws(
        () =>
            prepareExtension(reference, previous, [
                ...baseReviews().map((item) =>
                    item.giftId === '5655'
                        ? review('5655', 'cumulative-final')
                        : item,
                ),
            ]),
        /preserve/,
    );
    const legacyReviews = baseReviews().map(
        ({ match: _match, ...item }) => item,
    );
    const legacy = prepareActive(reference, legacyReviews);
    assert.ok(!Object.hasOwn(legacy[0], 'match'));
    assert.deepEqual(
        prepareExtension(reference, legacy, [
            ...legacyReviews,
            review('5576'),
        ]).filter((item) => item.match !== 'exact-name'),
        legacy,
    );
    assert.throws(() => prepareExtension(reference, legacy, full), /preserve/);
});

test('5.6: revisão não pode definir pontos, trocar candidato nem aprovar entrega incompleta', () => {
    const previous = baseline();
    for (const change of [
        { points: 999 },
        { points: '20' },
        { candidate: 'flavio' },
        { nameConfirmed: false },
        { connectorFieldsReviewed: false },
        { delivery: null },
        { groupId: null },
        { observedName: 'heart' },
    ])
        assert.throws(() =>
            prepareExtension(reference, previous, [
                ...baseReviews(),
                { ...review('5576'), ...change },
            ]),
        );
    assert.throws(() =>
        prepareExtension(reference, previous, [
            ...baseReviews(),
            review('5576'),
            review('5576'),
        ]),
    );
    assert.throws(() =>
        catalogStatus(reference, [{ ...previous[0], points: 999 }]),
    );
    assert.throws(() =>
        catalogStatus(reference, [{ ...previous[0], giftId: '999999' }]),
    );
});

test('5.6: identificação insuficiente e conflitos não viram pontos ou fallback por nome', () => {
    const active = prepareActive(reference, [...baseReviews(), review('5576')]);
    for (const payload of [
        { ...raw('99999', 'Heart'), giftId: undefined },
        { ...raw('99999', 'Heart'), common: { roomId: ROOM } },
        { ...raw('99999', 'Heart'), user: {} },
        raw('5655', 'Heart'),
        raw('99999', 'heart'),
        {
            ...raw('99999', 'Heart'),
            gift: { id: '88888', name: 'Heart', type: 2, combo: false },
        },
    ]) {
        const engine = createScoringEngine(settings(active));
        const admitted = validateRealOccurrence(
            'gift',
            payload,
            ROOM,
            ROOM,
            active,
        );
        if (admitted.event)
            assert.equal(engine.process(admitted.event).points, 0);
        assert.deepEqual(engine.snapshot().scores, { lula: 0, flavio: 0 });
    }
});

test('5.6: relatório separa observação de identidade/aprovação e limita amostras sem dados pessoais', () => {
    const r = observe();
    for (let count = 1; count <= 10; count++)
        r.receive({
            ...raw(
                '99999',
                'Heart',
                String(1000 + count),
                count,
                count === 10 ? 1 : 0,
                true,
            ),
            cookie: 'private-cookie',
            token: 'private-token',
        });
    r.receive(raw('99999', 'Heart', '1010', 10, 1, true));
    const saved = r.report.snapshot();
    const evidence = saved.gifts[0].evidence;
    assert.equal(evidence.withOccurrenceId, 11);
    assert.equal(evidence.samples.length, 8);
    assert.equal(evidence.samplesDropped, 3);
    assert.deepEqual(
        evidence.samples.map((sample) => sample.repeatCount),
        [1, 2, 3, 4, 5, 6, 7, 8],
    );
    const assessed = assessGiftEvidence(reference, saved);
    const heart = assessed.candidates.find((item) => item.name === 'Heart')!;
    assert.deepEqual(heart.observedGiftIds, ['99999']);
    assert.equal(heart.identityConfirmedByThisTool, false);
    assert.equal(heart.authorizationGrantedByThisTool, false);
    assert.equal(heart.reportedAuthorization, 'pending');
    assert.equal(assessed.authorizationGranted, false);
    assert.equal(assessed.observations[0].notes.retransmission_candidate, 1);
    assert.throws(() => prepareActive(reference, assessed));
    for (const secret of [
        ROOM,
        USER,
        '8001',
        'private-cookie',
        'private-token',
    ])
        assert.ok(!JSON.stringify(assessed).includes(secret));
    const copy = r.report.snapshot();
    copy.gifts[0].evidence.samples[0].repeatCount = 999;
    assert.equal(
        r.report.snapshot().gifts[0].evidence.samples[0].repeatCount,
        1,
    );
});

test('5.6: relatório identifica ID/nome divergente, ID histórico, tradução e presente desconhecido', () => {
    const r = observe();
    r.receive(raw('5655', 'Heart'));
    r.receive(raw('5576', 'Historical unconfirmed name', '1002'));
    r.receive(raw('99998', 'Coração', '1003'));
    const assessment = assessGiftEvidence(reference, r.report.snapshot());
    assert.ok(
        assessment.candidates
            .find((item) => item.name === 'Rose')!
            .concerns.includes('id_name_contradiction'),
    );
    const heart = assessment.candidates.find((item) => item.name === 'Heart')!;
    assert.ok(heart.concerns.includes('id_belongs_to_another_reference'));
    assert.ok(heart.concerns.includes('historical_id_is_not_identity'));
    assert.ok(!heart.concerns.includes('id_name_contradiction'));
    assert.deepEqual(assessment.unrecognizedGiftIds, ['99998']);
});

test('5.6: relatório legado, campos ausentes e falta de identidade continuam exigindo revisão', () => {
    const r = observe();
    r.receive({ ...raw('5655', 'Rose'), common: { roomId: ROOM }, user: {} });
    r.receive({ ...raw('5655', 'Rose'), giftId: undefined });
    const assessment = assessGiftEvidence(reference, r.report.snapshot());
    assert.equal(assessment.summary.missingGiftIds, 1);
    assert.ok(
        assessment.candidates[0].concerns.includes(
            'incomplete_identity_or_name_evidence',
        ),
    );
    const saved = r.report.snapshot();
    const { evidenceVersion: _version, ...legacy } = saved;
    const { samplesPerGift: _samples, ...limits } = legacy.limits;
    const old = {
        ...legacy,
        limits,
        gifts: legacy.gifts.map(({ evidence: _evidence, ...row }) => row),
    };
    assert.ok(
        assessGiftEvidence(reference, old).candidates[0].concerns.includes(
            'identity_coverage_unavailable_in_legacy_report',
        ),
    );
});

test('5.6: parser de evidência rejeita contratos promovidos, campos privados e contadores contraditórios', () => {
    const r = observe();
    r.receive(raw('5655', 'Rose'));
    const saved = r.report.snapshot();
    for (const bad of [
        { ...saved, domain: 'real' },
        { ...saved, scoringEligible: true },
        { ...saved, token: 'private-token' },
        { ...saved, sampledNotifications: 0 },
        { ...saved, gifts: [saved.gifts[0], saved.gifts[0]] },
        { ...saved, gifts: [{ ...saved.gifts[0], actorId: USER }] },
        { ...saved, gifts: [{ ...saved.gifts[0], notifications: '1' }] },
        { ...saved, gifts: [{ ...saved.gifts[0], withGroupId: 999 }] },
        { ...saved, gifts: [{ ...saved.gifts[0], notes: { arbitrary: 1 } }] },
    ])
        assert.throws(() => parseGiftEvidence(bad));
});

test('5.6: CLI status/assess/extend só cria arquivos novos e não promove relatório em autorização', (t) => {
    const dir = temporary(t),
        source = join(dir, 'observation.json'),
        assessment = join(dir, 'assessment.json'),
        active = join(dir, 'active.json'),
        reviews = join(dir, 'reviews.json'),
        output = join(dir, 'candidate.json');
    const r = observe();
    r.receive(raw('99999', 'Heart'));
    writeNewLocalJson(source, r.report.snapshot());
    writeNewLocalJson(active, baseline());
    writeNewLocalJson(reviews, [...baseReviews(), review('5576')]);
    const lines: string[] = [];
    runCatalogCli(['status'], (line) => lines.push(line));
    assert.equal(JSON.parse(lines[0]).length, 14);
    runCatalogCli(['assess', source, '--output', assessment], () => {});
    assert.equal(
        (readLocalJson(assessment) as { authorizationGranted: boolean })
            .authorizationGranted,
        false,
    );
    assert.throws(() =>
        runCatalogCli(
            ['extend', active, assessment, '--output', output],
            () => {},
        ),
    );
    runCatalogCli(['extend', active, reviews, '--output', output], () => {});
    assert.equal((readLocalJson(output) as unknown[]).length, 5);
    assert.throws(() =>
        runCatalogCli(
            ['extend', active, reviews, '--output', output],
            () => {},
        ),
    );
    assert.throws(() =>
        runCatalogCli(['assess', source, '--output', assessment], () => {}),
    );
    assert.deepEqual(readLocalJson(active), baseline());
});

test('5.6: provedor falso observa sem motor/SQLite/admin e não concede autorizações', async () => {
    class Fake extends EventEmitter {
        async connect() {
            return { roomId: ROOM };
        }
        async disconnect() {}
    }
    const fake = new Fake(),
        r = observe();
    const engine = createScoringEngine(settings(baseline())),
        before = engine.snapshot();
    const client = createDiagnosticClient({
        enabled: true,
        factory: () => fake,
        logger: createDiagnosticLogger(() => {}),
        observer: r.observer,
    });
    client.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    fake.emit('gift', raw('5655', 'Rose'));
    fake.emit('gift', raw('99999', 'Heart', '1002'));
    await client.stop();
    const assessment = assessGiftEvidence(reference, r.report.snapshot());
    assert.equal(assessment.summary.sampledNotifications, 2);
    assert.equal(engine.process(assessment).status, 'rejected');
    assert.deepEqual(engine.snapshot(), before);
});

test('5.6: combo acumulativo por nome, retransmissão, rollback e SQLite recuperam sem mudar catálogo', (t) => {
    const dir = temporary(t),
        filename = join(dir, 'synthetic.sqlite');
    const active = prepareActive(reference, [
        ...baseReviews(),
        review('5576', 'cumulative-final'),
    ]);
    let storage = track(
        t,
        openSqliteScoring({
            filename,
            mode: 'create',
            engine: settings(active),
        }),
    );
    const admit = (msg: string, count: number, final: number, id = '99999') => {
        const result = validateRealOccurrence(
            'gift',
            raw(id, 'Heart', msg, count, final, true),
            ROOM,
            ROOM,
            active,
        );
        assert.ok(result.event);
        return result.event;
    };
    storage.process(admit('2001', 1, 0));
    storage.process(admit('2002', 2, 0, '99998'));
    const pending = storage.snapshot();
    storage.close();
    storage = track(
        t,
        openSqliteScoring({
            filename,
            mode: 'resume',
            engine: settings(active),
        }),
    );
    assert.deepEqual(storage.snapshot(), pending);
    const db = track(t, new Database(filename));
    db.exec(
        "CREATE TRIGGER phase56_fail BEFORE UPDATE ON dispute BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    );
    const final = admit('2003', 3, 1);
    assert.throws(() => storage.process(final));
    assert.deepEqual(storage.snapshot(), pending);
    db.exec('DROP TRIGGER phase56_fail');
    db.close();
    assert.equal(storage.process(final).points, 60);
    assert.equal(storage.process(final).status, 'duplicate');
    storage.close();
    storage = track(
        t,
        openSqliteScoring({
            filename,
            mode: 'resume',
            engine: settings(active),
        }),
    );
    assert.equal(storage.snapshot().scores.lula, 60);
    assert.equal(storage.process(final).status, 'duplicate');
    storage.close();
    assert.throws(
        () =>
            track(
                t,
                openSqliteScoring({
                    filename,
                    mode: 'resume',
                    engine: settings(baseline()),
                }),
            ),
        /context/,
    );
});

function localHttp(
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
): Promise<{
    status: number;
    headers: import('node:http').IncomingHttpHeaders;
    json: Record<string, any>;
}> {
    return new Promise((resolve, reject) => {
        const req = request(
            url,
            {
                agent: false,
                method: body === undefined ? 'GET' : 'POST',
                headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                res.on('end', () => {
                    try {
                        resolve({
                            status: res.statusCode!,
                            headers: res.headers,
                            json: JSON.parse(Buffer.concat(chunks).toString()),
                        });
                    } catch (error) {
                        reject(error);
                    }
                });
            },
        );
        req.on('error', reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
    });
}
test('5.6: painel autenticado lista só cinco regras revistas; servidor calcula, estorna, corrige e recupera auditoria', async (t) => {
    const filename = join(temporary(t), 'admin-test.sqlite');
    const active = prepareExtension(reference, baseline(), [
        ...baseReviews(),
        review('5576'),
    ]);
    let storage = track(
        t,
        openSqliteScoring({
            filename,
            mode: 'create',
            engine: settings(active),
        }),
    );
    let published = 0;
    const service = createAdministrationService(storage, {
        roomId: ROOM,
        assertAuthority() {},
        publish(decision) {
            assert.equal(storage.snapshot().version, decision.state.version);
            published++;
        },
    });
    const server = createAdministrationServer({
        credential: makeCredential(
            'phase56',
            'synthetic-password-phase56-only',
        ),
        service,
        gifts: active,
        connection: () => 'offline synthetic',
        assets: new Map(),
    });
    server.server.listen(0, '127.0.0.2');
    await once(server.server, 'listening');
    const address = server.server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.2:${address.port}`;
    defer(t, async () => {
        await server.close();
        storage.close();
    });
    const headers = {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Admin-Request': '1',
    };
    assert.equal(
        (await localHttp(origin + '/admin/api/state', undefined, headers))
            .status,
        401,
    );
    const login = await localHttp(
        origin + '/admin/api/login',
        { operator: 'phase56', password: 'synthetic-password-phase56-only' },
        headers,
    );
    assert.equal(login.status, 200);
    const authenticated = {
        ...headers,
        Cookie: login.headers['set-cookie']![0].split(';')[0],
        'X-CSRF-Token': login.json.csrf,
    };
    const api = (path: string, body?: unknown) =>
        localHttp(origin + '/admin/api/' + path, body, authenticated);
    const state = (await api('state')).json;
    assert.equal(state.rules.length, 5);
    assert.ok(
        state.rules.some(
            (rule: { ruleId: string }) => rule.ruleId === 'name:heart',
        ),
    );
    assert.ok(
        !state.rules.some((rule: { name: string }) => rule.name === 'Galaxy'),
    );
    const command = {
        operationId: randomUUID(),
        sessionId: state.state.sessionId,
        candidate: 'lula',
        ruleId: 'name:heart',
        quantity: 3,
        justification: 'Revisão sintética offline',
        link: null,
        correctionOf: null,
        reconciliationConfirmed: true,
    };
    assert.equal((await api('award', { ...command, points: 999 })).status, 400);
    assert.equal(
        (await api('award', { ...command, ruleId: 'name:galaxy' })).status,
        409,
    );
    assert.equal((await api('award', command)).json.decision.points, 60);
    assert.equal(
        (await api('award', command)).json.decision.status,
        'duplicate',
    );
    assert.equal(published, 1);
    const reversal = {
        operationId: randomUUID(),
        sessionId: command.sessionId,
        targetOperationId: command.operationId,
        justification: 'Estorno sintético',
    };
    assert.equal((await api('reversal', reversal)).status, 200);
    assert.equal(
        (
            await api('award', {
                ...command,
                operationId: randomUUID(),
                correctionOf: command.operationId,
                quantity: 1,
            })
        ).status,
        200,
    );
    const view = (await api('state')).json;
    assert.equal(view.state.scores.lula, 20);
    assert.equal(view.history.length, 3);
    const expected = storage.administrationView();
    storage.close();
    storage = track(
        t,
        openSqliteScoring({
            filename,
            mode: 'resume',
            engine: settings(active),
        }),
    );
    assert.deepEqual(storage.administrationView(), expected);
});

test('5.6: --no-env desabilitado não lê .env, carrega SDK ou abre bancos; ambiente real é rejeitado', () => {
    const entry = new URL('../src/tiktok/main.ts', import.meta.url).href;
    const code = `
        import { registerHooks } from 'node:module';
        import { Socket } from 'node:net';
        void process.stdout; void process.stderr;
        Socket.prototype.connect = function() { throw new Error('NETWORK_FORBIDDEN'); };
        process.loadEnvFile = () => { throw new Error('ENV_FORBIDDEN'); };
        registerHooks({ resolve(specifier, context, next) { if (specifier.startsWith('tiktok-live-connector') || specifier === 'better-sqlite3') throw new Error('SDK_SQL_FORBIDDEN'); return next(specifier, context); } });
        process.argv = ['node', 'diagnostic', '--no-env'];
        await import(${JSON.stringify(entry)});
    `;
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: 'test',
        TIKTOK_DIAGNOSTIC_ENABLED: 'false',
        DUEL_MODE: 'observation',
        TIKTOK_REAL_ENABLED: 'false',
        ADMIN_ENABLED: 'false',
        NO_COLOR: '1',
    };
    delete env.FORCE_COLOR;
    delete env.TIKTOK_DATABASE;
    delete env.TIKTOK_GIFT_CATALOG;
    const safe = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', code],
        { encoding: 'utf8', env },
    );
    assert.equal(safe.status, 0, safe.stderr);
    assert.ok(safe.stdout.includes('disabled'));
    for (const conflicting of [
        { TIKTOK_DATABASE: '/never-open/operational.sqlite' },
        { TIKTOK_GIFT_CATALOG: '/never-read/private.json' },
        { TIKTOK_REAL_ENABLED: 'true' },
        { ADMIN_ENABLED: 'true' },
        { DUEL_MODE: 'real' },
    ]) {
        const result = spawnSync(
            process.execPath,
            ['--input-type=module', '-e', code],
            { encoding: 'utf8', env: { ...env, ...conflicting } },
        );
        assert.notEqual(result.status, 0);
        assert.ok(!result.stderr.includes('FORBIDDEN'));
        assert.ok(!result.stderr.includes('never-open'));
    }
});
