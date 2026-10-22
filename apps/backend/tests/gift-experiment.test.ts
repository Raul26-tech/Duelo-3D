import { assessRuntimeEvidence } from '../src/catalog-tools/evidence.ts';
import Database from 'better-sqlite3';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
    mkdtempSync,
    rmSync,
    writeFileSync,
    readFileSync,
    renameSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
    experimentTemplate,
    experimentStatus,
    prepareExperiment,
    parseExperimentManifest,
} from '../src/catalog-tools/experiment.ts';
import { runCatalogCli } from '../src/catalog-tools/main.ts';
import {
    readRealConfig,
    parseReviewedCatalog,
} from '../src/integration/config.ts';
import { loadReference, prepareActive } from '../src/catalog-tools/catalog.ts';
import { openSqliteScoring } from '../src/persistence/sqlite.ts';
import { createBackendServer } from '../src/server.ts';
import { startRealRuntime } from '../src/integration/runtime.ts';
import { createRuntimeReport } from '../src/integration/runtime-report.ts';
import {
    createDiagnosticLogger,
    createEventObserver,
} from '../src/tiktok/diagnostics.ts';
import { normalizeProviderEvent } from '../src/tiktok/normalize.ts';
import {
    validateRealOccurrence,
    TIKTOK_ORIGIN,
} from '../src/integration/ingress.ts';
import { readLocalJson, writeNewLocalJson } from '../src/local-json.ts';
import { giftRuleKey } from '../src/scoring/catalog.ts';
import { ROOM, USER } from './fixtures/tiktok.ts';
const ref = loadReference();
// SYNTHETIC baseline/deliveries. Actual four private policies are not available here.
function base() {
    return parseReviewedCatalog(
        ['5655', '5487', '8239', '14488'].map((id) => {
            const g = ref.find((g) => g.giftId === id)!;
            return {
                giftId: id,
                name: g.name,
                candidate: g.candidate,
                points: g.points,
                delivery: id === '5655' ? 'cumulative-final' : 'single',
            };
        }),
    );
}
function approved() {
    const plan = experimentTemplate(base());
    plan.operator = 'synthetic_operator';
    plan.acceptExperimentalRisks = true;
    plan.hypotheses.forEach((h, index) => {
        h.delivery = index % 2 === 0 ? 'single' : 'cumulative-final';
        h.acceptsAssumption = true;
        h.rationale = 'Synthetic explicit assumption; not evidence from a LIVE';
    });
    return plan;
}
function temp(t: TestContext) {
    const dir = mkdtempSync(join(tmpdir(), 'duelo-experiment-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}
function env(dir: string): NodeJS.ProcessEnv {
    return {
        NODE_ENV: 'development',
        DUEL_MODE: 'real',
        TIKTOK_REAL_ENABLED: 'true',
        TIKTOK_IDENTITY_REVIEWED: 'true',
        TIKTOK_USERNAME: 'synthetic_test',
        TIKTOK_ROOM_ID: ROOM,
        TIKTOK_SESSION_ACTION: 'create',
        TIKTOK_DATABASE: join(dir, 'test.sqlite'),
    };
}
function config(t: TestContext) {
    const dir = temp(t),
        path = join(dir, 'manifest.json');
    writeNewLocalJson(path, prepareExperiment(approved()));
    return {
        dir,
        path,
        config: readRealConfig({
            ...env(dir),
            TIKTOK_EXPERIMENTAL_ENABLED: 'true',
            TIKTOK_EXPERIMENT_MANIFEST: path,
            TIKTOK_RUNTIME_REPORT: join(dir, 'report.json'),
        }),
    };
}
const raw = (
    id: string,
    name: string,
    event = '1001',
    count = 1,
    final = 1,
    combo = false,
    group = '8001',
) => ({
    common: { roomId: ROOM, msgId: event },
    user: { id: USER },
    giftId: id,
    gift: { id, name, type: combo ? 1 : 2, combo },
    groupId: combo ? group : '0',
    repeatCount: count,
    repeatEnd: final,
});

test('5.6.1: plano conserva exatamente quatro regras e dez políticas nulas sem alegar validação', () => {
    const original = base(),
        plan = experimentTemplate(original),
        status = experimentStatus(plan);
    assert.deepEqual(plan.baseline, original);
    assert.equal(status.length, 14);
    assert.equal(status.filter((g) => g.pending.length).length, 10);
    assert.ok(
        plan.hypotheses.every(
            (h) => h.delivery === null && !h.acceptsAssumption,
        ),
    );
    assert.throws(() => prepareExperiment(plan), /delivery_hypothesis/);
    assert.ok(status.every((g) => !g.operationallyValidatedByThisTool));
    assert.throws(() => experimentTemplate([]));
    assert.throws(() => experimentTemplate([...original.slice(1)]));
});
test('5.6.1: manifesto explícito tem seis IDs e oito ruleIds; nunca é catálogo validado', () => {
    const manifest = prepareExperiment(approved());
    assert.equal(manifest.rules.length, 14);
    assert.equal(
        manifest.rules.filter((r) => r.match === 'exact-name').length,
        8,
    );
    assert.equal(
        manifest.rules.filter((r) => r.match !== 'exact-name').length,
        6,
    );
    for (const old of base())
        assert.deepEqual(
            manifest.rules.find((r) => giftRuleKey(r) === giftRuleKey(old)),
            old,
        );
    for (const rule of manifest.rules)
        if (rule.match === 'exact-name')
            assert.ok(!Object.hasOwn(rule, 'giftId'));
    assert.equal(manifest.productionValidated, false);
    assert.throws(() => parseReviewedCatalog(manifest));
    assert.throws(() => prepareActive(ref, manifest));
    assert.equal(parseExperimentManifest(manifest).manifest.rules.length, 14);
});
for (const field of [
    'operator',
    'acceptExperimentalRisks',
    'delivery',
    'acceptsAssumption',
    'rationale',
])
    test(`5.6.1: não omite decisão experimental ${field}`, () => {
        const plan = approved();
        if (field === 'operator') plan.operator = '';
        else if (field === 'acceptExperimentalRisks')
            plan.acceptExperimentalRisks = false;
        else
            Object.assign(plan.hypotheses[0], {
                [field]:
                    field === 'delivery'
                        ? null
                        : field === 'rationale'
                          ? ''
                          : false,
            });
        assert.throws(() => prepareExperiment(plan));
    });
test('5.6.1: rejeita políticas inválidas, pontos injetados, duplicatas e adulteração do manifesto', () => {
    for (const patch of [
        { delivery: 'automatic' },
        { delivery: true },
        { points: 999 },
        { candidate: 'flavio' },
        { referenceGiftId: '5655' },
    ]) {
        const plan = approved();
        Object.assign(plan.hypotheses[0], patch);
        assert.throws(() => prepareExperiment(plan));
    }
    const duplicate = approved();
    duplicate.hypotheses[0] = duplicate.hypotheses[1];
    assert.throws(() => prepareExperiment(duplicate));
    const m = prepareExperiment(approved());
    assert.throws(() =>
        parseExperimentManifest({ ...m, productionValidated: true }),
    );
    assert.throws(() =>
        parseExperimentManifest({
            ...m,
            rules: m.rules.map((r, i) => (i === 0 ? { ...r, points: 999 } : r)),
        }),
    );
    assert.throws(() =>
        experimentTemplate(
            base().map((r, i) => (i === 0 ? { ...r, points: 100 } : r)),
        ),
    );
});
test('5.6.1: CLI produz apenas arquivos externos novos e não preenche decisões pelo operador', (t) => {
    const dir = temp(t),
        baseline = join(dir, 'base.json'),
        plan = join(dir, 'plan.json'),
        manifest = join(dir, 'manifest.json');
    writeNewLocalJson(baseline, base());
    runCatalogCli(
        ['experiment-template', baseline, '--output', plan],
        () => {},
    );
    assert.throws(() =>
        runCatalogCli(
            ['experiment-prepare', baseline, plan, '--output', manifest],
            () => {},
        ),
    );
    writeFileSync(plan, JSON.stringify(approved()));
    runCatalogCli(
        ['experiment-prepare', baseline, plan, '--output', manifest],
        () => {},
    );
    runCatalogCli(['experiment-verify', manifest], () => {});
    assert.throws(() =>
        runCatalogCli(
            ['experiment-prepare', baseline, plan, '--output', manifest],
            () => {},
        ),
    );
    assert.deepEqual(readLocalJson(baseline), base());
});
test('5.6.1: opt-in isolado do catálogo validado; política experimental fica vinculada ao SQLite', (t) => {
    const c = config(t),
        e = env(c.dir);
    assert.equal(readRealConfig(e).experiment, undefined);
    assert.throws(() =>
        readRealConfig({ ...e, TIKTOK_EXPERIMENT_MANIFEST: c.path }),
    );
    assert.throws(() => readRealConfig({ ...e, TIKTOK_GIFT_CATALOG: c.path }));
    assert.throws(() =>
        readRealConfig({
            ...e,
            TIKTOK_EXPERIMENTAL_ENABLED: 'true',
            TIKTOK_EXPERIMENT_MANIFEST: c.path,
            TIKTOK_GIFT_CATALOG: c.path,
        }),
    );
    const ordinary = join(c.dir, 'ordinary.json');
    writeNewLocalJson(ordinary, c.config.gifts);
    const prod = readRealConfig({ ...e, TIKTOK_GIFT_CATALOG: ordinary });
    assert.notEqual(prod.sourcePolicy, c.config.sourcePolicy);
    const opts = (cfg: typeof c.config) => ({
        origin: TIKTOK_ORIGIN,
        roomId: ROOM,
        domain: 'real' as const,
        enableRealScoring: true as const,
        catalog: cfg.gifts.map(({ delivery: _d, ...r }) => r),
        sourcePolicy: cfg.sourcePolicy,
    });
    const db = openSqliteScoring({
        filename: c.config.filename,
        mode: 'create',
        engine: opts(c.config),
    });
    const before = db.snapshot();
    db.close();
    assert.throws(
        () =>
            openSqliteScoring({
                filename: c.config.filename,
                mode: 'resume',
                engine: opts(prod),
            }),
        /context/,
    );
    const recovered = openSqliteScoring({
        filename: c.config.filename,
        mode: 'resume',
        engine: opts(c.config),
    });
    assert.deepEqual(recovered.snapshot(), before);
    recovered.close();
});
test('5.6.1: configuração limita janela de relatório a 35 minutos', (t) => {
    const c = config(t);
    for (const minutes of ['0', '36', '1.5', 'NaN', 'Infinity', '-1'])
        assert.throws(() =>
            readRealConfig({
                ...env(c.dir),
                TIKTOK_RUNTIME_REPORT: join(c.dir, 'out.json'),
                TIKTOK_RUNTIME_REPORT_MINUTES: minutes,
            }),
        );
    assert.equal(c.config.runtimeReport?.durationMs, 35 * 60000);
});
async function rig(
    t: TestContext,
    writeDiagnostic = (line: string) => {
        void line;
    },
    afterCommit?: () => void,
) {
    const c = config(t);
    class Provider extends EventEmitter {
        connects = 0;
        disconnects = 0;
        async connect() {
            this.connects++;
            return { roomId: ROOM };
        }
        async disconnect() {
            this.disconnects++;
        }
    }
    const fake = new Provider(),
        server = createBackendServer('real');
    const runtime = startRealRuntime({
        server,
        origin: 'http://127.0.0.1:5173',
        config: c.config,
        factory: () => fake,
        writeDiagnostic,
        afterCommit,
    });
    t.after(async () => {
        await runtime.close();
        server.close();
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    return { ...c, fake, runtime };
}
test('5.6.1: uma conexão, 14 presentes automáticos, combos e rejeições diagnosticados sem escrita pelo relatório', async (t) => {
    const r = await rig(t);
    let expectedLula = 0,
        expectedFlavio = 0;
    let n = 1000;
    for (const rule of r.config.gifts) {
        const combo = rule.delivery === 'cumulative-final',
            id = rule.match === 'exact-name' ? String(90000 + n) : rule.giftId,
            group = String(70000 + n);
        if (combo)
            r.fake.emit(
                'gift',
                raw(id, rule.name, String(++n), 1, 0, true, group),
            );
        const payload = raw(
            id,
            rule.name,
            String(++n),
            combo ? 3 : 1,
            1,
            combo,
            group,
        );
        r.fake.emit('gift', payload);
        r.fake.emit('gift', payload);
        if (rule.candidate === 'lula')
            expectedLula += rule.points * (combo ? 3 : 1);
        else expectedFlavio += rule.points * (combo ? 3 : 1);
    }
    r.fake.emit('gift', raw('999999', 'Unknown gift', String(++n)));
    r.fake.emit('gift', {
        ...raw('5655', 'Rose', String(++n)),
        common: { roomId: ROOM },
    });
    assert.deepEqual(r.runtime.snapshot().scores, {
        lula: expectedLula,
        flavio: expectedFlavio,
    });
    const before = r.runtime.snapshot();
    r.runtime.diagnosticReport();
    assert.deepEqual(r.runtime.snapshot(), before);
    assert.equal(r.fake.connects, 1);
    await r.runtime.close();
    assert.equal(r.fake.disconnects, 1);
    const saved = readLocalJson(
        r.config.runtimeReport!.filename,
    ) as NonNullable<ReturnType<typeof r.runtime.diagnosticReport>>;
    const assessment = assessRuntimeEvidence(ref, saved);
    assert.equal(assessment.authorizationGranted, false);
    assert.equal(assessment.runtimePurpose, 'experimental');
    assert.throws(() =>
        assessRuntimeEvidence(ref, {
            ...saved,
            outcomes: [{ ...saved.outcomes[0], actorId: USER }],
        }),
    );
    assert.equal(saved.purpose, 'experimental');
    assert.equal(saved.saved, true);
    assert.ok(
        saved.outcomes.some(
            (row) =>
                row.giftId === '999999' &&
                row.status !== 'applied' &&
                ['UNKNOWN_GIFT', 'NAME_NOT_AUTHORIZED'].includes(row.reason),
        ),
    );
    assert.ok(
        saved.outcomes.some(
            (row) => row.reason === 'UNPROVEN_OR_CONTRADICTORY_IDENTITY',
        ),
    );
    for (const secret of [ROOM, USER, 'private-cookie', 'private-token'])
        assert.ok(!JSON.stringify(saved).includes(secret));
});
test('5.6.1: automático/manual deduplicam identidade compartilhada, preservam estorno e replay', async (t) => {
    const r = await rig(t);
    const state = r.runtime.snapshot(),
        event = '50001',
        actor = USER;
    r.fake.emit('gift', raw('8239', 'White Rose', event, 2, 1, false));
    assert.equal(r.runtime.snapshot().scores.flavio, 0);
    const award = {
        operationId: randomUUID(),
        sessionId: state.sessionId,
        candidate: 'flavio',
        ruleId: '8239',
        quantity: 1,
        justification: 'Reconciliação sintética com identidade comprovada',
        link: { eventId: event, actorId: actor, sequenceId: null },
        correctionOf: null,
        reconciliationConfirmed: true,
    };
    assert.equal(
        r.runtime.administration.execute('synthetic_operator', 'award', award)
            .points,
        2,
    );
    r.fake.emit('gift', raw('8239', 'White Rose', event));
    assert.equal(r.runtime.snapshot().scores.flavio, 2);
    assert.equal(
        r.runtime.administration.execute('synthetic_operator', 'award', award)
            .status,
        'duplicate',
    );
    r.runtime.administration.execute('synthetic_operator', 'reversal', {
        operationId: randomUUID(),
        sessionId: state.sessionId,
        targetOperationId: award.operationId,
        justification: 'Estorno sintético preservando reserva da origem',
    });
    r.fake.emit('gift', raw('8239', 'White Rose', event));
    assert.equal(r.runtime.snapshot().scores.flavio, 0);
    const view = r.runtime.administration.view();
    await r.runtime.close();
    const server = createBackendServer('real');
    const again = startRealRuntime({
        server,
        origin: 'http://127.0.0.1:5173',
        config: { ...r.config, action: 'resume', runtimeReport: undefined },
        factory: () => r.fake,
    });
    try {
        assert.deepEqual(again.administration.view(), view);
        assert.equal(
            again.administration.execute('synthetic_operator', 'award', award)
                .status,
            'duplicate',
        );
    } finally {
        await again.close();
        server.close();
    }
});
test('5.6.1: falha dos logs/gravação do relatório não reverte nem reaplica pontuação', async (t) => {
    const r = await rig(t, () => {
        throw new Error('synthetic log failure');
    });
    const file = r.config.runtimeReport!.filename;
    renameSync(file, file + '.owned');
    writeFileSync(file, 'replacement');
    const payload = raw('8239', 'White Rose', '60001');
    r.fake.emit('gift', payload);
    r.fake.emit('gift', payload);
    assert.equal(r.runtime.snapshot().scores.flavio, 2);
    await r.runtime.close();
    assert.equal(readFileSync(file, 'utf8'), 'replacement');
});
test('5.6.1: janela de 35 minutos fecha captura, sem conexão extra e sem armazenamento ilimitado', (t) => {
    const dir = temp(t);
    let clock = 0;
    const observer = createEventObserver(createDiagnosticLogger(() => {}));
    const report = createRuntimeReport(
        { filename: join(dir, 'bounded.json'), durationMs: 35 * 60000 },
        'experimental',
        observer,
        () => {},
        () => clock,
    );
    const payload = raw('8239', 'White Rose');
    report.record('gift', payload, ROOM, 'GIFT_SCORED', 'applied', 1, 'id');
    report.observer.observe(normalizeProviderEvent('gift', payload, ROOM));
    clock = 34 * 60000;
    report.tick();
    assert.equal(report.snapshot().ended, null);
    clock = 35 * 60000;
    report.tick();
    assert.equal(report.snapshot().ended, 'duration_limit');
    report.record('gift', payload, ROOM, 'GIFT_SCORED', 'applied', 2, 'id');
    assert.equal(report.snapshot().sampledOutcomes, 1);
    assert.equal(report.snapshot().saved, true);
});

test('5.6.1: limite de 64 resultados e relatório de 60 KiB sem coleta ilimitada', (t) => {
    const dir = temp(t),
        report = createRuntimeReport(
            { filename: join(dir, 'capacity.json'), durationMs: 60000 },
            'experimental',
            createEventObserver(createDiagnosticLogger(() => {})),
            () => {},
        );
    for (let i = 0; i < 65; i++)
        report.record(
            'gift',
            raw(String(90000 + i), 'Unknown ' + i),
            ROOM,
            'UNKNOWN_GIFT',
            'rejected',
            0,
        );
    const snapshot = report.snapshot();
    assert.equal(snapshot.outcomes.length, 64);
    assert.equal(snapshot.droppedOutcomes, 1);
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot, null, 4)) <= 60000);
    report.finish('operator_stop');
});
test('5.6.1: rejeição de entrega incompatível não permite combo em regra single', async (t) => {
    const r = await rig(t);
    r.fake.emit('gift', raw('8239', 'White Rose', '61001', 3, 1, true));
    assert.deepEqual(r.runtime.snapshot().scores, { lula: 0, flavio: 0 });
    assert.ok(
        r.runtime
            .diagnosticReport()!
            .outcomes.some((row) => row.reason === 'DELIVERY_NOT_VALIDATED'),
    );
});
test('5.6.1: falha SQLite mantém placar/identidade em rollback e relatório registra falha sem commit', async (t) => {
    const r = await rig(t),
        db = new Database(r.config.filename);
    db.exec(
        "CREATE TRIGGER exp_failure BEFORE UPDATE ON dispute BEGIN SELECT RAISE(ABORT,'synthetic'); END",
    );
    const before = r.runtime.snapshot();
    r.fake.emit('gift', raw('8239', 'White Rose', '62001'));
    assert.deepEqual(r.runtime.snapshot(), before);
    assert.ok(
        r.runtime
            .diagnosticReport()!
            .outcomes.some(
                (row) =>
                    row.reason === 'PERSISTENCE_BLOCKED' &&
                    row.lastCommittedVersion === null,
            ),
    );
    db.exec('DROP TRIGGER exp_failure');
    db.close();
    await r.runtime.close();
});
test('5.6.1: publicação falha depois do commit não reaplica e observabilidade conserva versão confirmada', async (t) => {
    const r = await rig(
        t,
        () => {},
        () => {
            throw new Error('synthetic transport failure');
        },
    );
    const payload = raw('8239', 'White Rose', '63001');
    r.fake.emit('gift', payload);
    r.fake.emit('gift', payload);
    assert.equal(r.runtime.snapshot().scores.flavio, 2);
    assert.ok(
        r.runtime
            .diagnosticReport()!
            .outcomes.some(
                (row) =>
                    row.status === 'applied' &&
                    row.lastCommittedVersion === r.runtime.snapshot().version,
            ),
    );
});

test('5.6.1: alteração de entrega do baseline ou seleção de outro original bloqueia preparação', () => {
    const plan = approved();
    const different = base().map((rule) =>
        giftRuleKey(rule) === '5655'
            ? { ...rule, delivery: 'single' as const }
            : rule,
    );
    assert.throws(() => prepareExperiment(plan, different), /baseline/i);
    const modified = { ...plan, baseline: different };
    assert.throws(() => prepareExperiment(modified), /Baseline copy/);
    assert.equal(prepareExperiment(plan, base()).rules.length, 14);
});
