import test from 'node:test';
import assert from 'node:assert/strict';
import { createGiftReport, withGiftReport } from '../src/tiktok/gift-report.ts';
import {
    createEventObserver,
    createDiagnosticLogger,
} from '../src/tiktok/diagnostics.ts';
import { normalizeProviderEvent } from '../src/tiktok/normalize.ts';
import { createScoringEngine } from '../src/scoring/engine.ts';
import { ROOM, USER, gift, chat } from './fixtures/tiktok.ts';

function rig(limit = 32) {
    const report = createGiftReport(limit);
    const observer = withGiftReport(
        createEventObserver(createDiagnosticLogger(() => {})),
        report,
    );
    const receive = (payload: unknown) =>
        observer.observe(normalizeProviderEvent('gift', payload, ROOM));
    return { report, observer, receive };
}

test('relatório agregado identifica gift IDs e metadados públicos sem confirmar semântica ou pontuar', () => {
    const r = rig();
    r.receive({
        ...gift(1, 0, '101'),
        giftId: '5655',
        gift: { id: '5655', name: 'Rose', type: 1, combo: true },
    });
    r.receive({
        ...gift(2, 0, '102'),
        giftId: '5655',
        gift: { id: '5655', name: 'Rose', type: 1, combo: true },
    });
    r.receive({
        ...gift(3, 1, '103'),
        giftId: '5655',
        gift: { id: '5655', name: 'Rose', type: 1, combo: true },
    });
    const data = r.report.snapshot();
    assert.equal(data.domain, 'observation');
    assert.equal(data.scoringEligible, false);
    assert.equal(data.semanticsConfirmed, false);
    const row = data.gifts[0];
    assert.equal(row.giftId, '5655');
    assert.deepEqual(row.names, ['Rose']);
    assert.equal(row.notifications, 3);
    assert.equal(row.withGroupId, 3);
    assert.equal(row.repeatCountMin, 1);
    assert.equal(row.repeatCountMax, 3);
    assert.equal(row.repeatEndPending, 2);
    assert.equal(row.repeatEndFinal, 1);
    assert.equal(row.notes.count_increased, 2);
    assert.equal(row.requiresOperatorReview, true);
    assert.deepEqual(row.giftTypes, [1]);
    assert.deepEqual(row.comboFlags, [true]);
});
test('agregado registra retransmissão, regressão, contradição e identidade ausente como diagnóstico', () => {
    const r = rig();
    const first = gift(2, 0, '111');
    r.receive(first);
    r.receive(first);
    r.receive(gift(1, 0, '112'));
    r.receive(gift(3, 1, '111'));
    r.receive({ ...gift(), giftId: undefined, gift: {} });
    const data = r.report.snapshot();
    const row = data.gifts[0];
    assert.equal(data.missingGiftIds, 1);
    assert.equal(row.notes.retransmission_candidate, 1);
    assert.ok((row.notes.out_of_order ?? 0) > 0);
    assert.equal(row.notes.identity_conflict, 1);
    assert.equal(data.semanticsConfirmed, false);
});
test('relatório não contém usuários, sala, sequência, ocorrências, texto ou credenciais; cópias não mudam estado', () => {
    const r = rig();
    r.receive({
        ...gift(1, 1, '9812345678901234567'),
        cookie: 'private_cookie',
        token: 'private_token',
    });
    r.observer.observe(
        normalizeProviderEvent(
            'comment',
            { ...chat(), content: 'private_comment' },
            ROOM,
        ),
    );
    const json = JSON.stringify(r.report.snapshot());
    for (const secret of [
        ROOM,
        USER,
        '7612345678901234567',
        '9812345678901234567',
        'private_comment',
        'private_cookie',
        'private_token',
    ])
        assert.ok(!json.includes(secret));
    const copy = r.report.snapshot();
    copy.gifts[0].names.push('changed');
    assert.ok(!JSON.stringify(r.report.snapshot()).includes('changed'));
    r.observer.interrupt();
    r.observer.close();
    assert.equal(r.report.snapshot().scoringEligible, false);
});
test('capacidade do relatório é limitada e não decide pelo nome quando ID falta', () => {
    const r = rig(1);
    r.receive(gift());
    r.receive({
        ...gift(),
        giftId: '5655',
        gift: { id: '5655', name: 'Rose', type: 1, combo: true },
    });
    r.receive({ ...gift(), giftId: undefined, gift: { name: 'Rose' } });
    const data = r.report.snapshot();
    assert.equal(data.gifts.length, 1);
    assert.equal(data.dropped, 1);
    assert.equal(data.missingGiftIds, 1);
});
test('diagnóstico agregado permanece incompatível com o motor e não altera placar', () => {
    const r = rig();
    const engine = createScoringEngine({
        origin: 'offline',
        roomId: ROOM,
        domain: 'simulation',
    });
    const before = engine.snapshot();
    r.receive(gift(3, 1));
    assert.equal(engine.process(r.report.snapshot()).status, 'rejected');
    assert.deepEqual(engine.snapshot(), before);
});

test('relatório opt-in desligado não cria arquivo; configuração inválida falha sem conexão real', async (t) => {
    const { mkdtempSync, existsSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { spawnSync } = await import('node:child_process');
    const dir = mkdtempSync(join(tmpdir(), 'duelo-report-optin-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'report.json');
    const main = fileURLToPath(
        new URL('../src/tiktok/main.ts', import.meta.url),
    );
    for (const enabled of ['false', 'true']) {
        const result = spawnSync(process.execPath, [main], {
            encoding: 'utf8',
            env: {
                ...process.env,
                NODE_ENV: 'test',
                TIKTOK_DIAGNOSTIC_ENABLED: enabled,
                TIKTOK_GIFT_REPORT: path,
                TIKTOK_USERNAME: 'offline_test',
                NO_COLOR: '1',
                FORCE_COLOR: undefined,
            },
        });
        assert.equal(result.status, enabled === 'false' ? 0 : 1);
        assert.equal(existsSync(path), false);
    }
});

test('provedor falso reutiliza diagnóstico e salva somente agregados após encerramento', async (t) => {
    const { EventEmitter } = await import('node:events');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createDiagnosticClient } = await import('../src/tiktok/client.ts');
    const { reserveLocalJson, readLocalJson } =
        await import('../src/local-json.ts');
    const { loadReference, prepareActive } =
        await import('../src/catalog-tools/catalog.ts');
    const dir = mkdtempSync(join(tmpdir(), 'duelo-report-client-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const output = reserveLocalJson(join(dir, 'gifts.json'));
    class Fake extends EventEmitter {
        async connect() {
            return { roomId: ROOM };
        }
        async disconnect() {}
    }
    const fake = new Fake();
    const r = rig();
    const client = createDiagnosticClient({
        enabled: true,
        factory: () => fake,
        observer: r.observer,
        logger: createDiagnosticLogger(() => {}),
    });
    client.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    fake.emit('gift', gift(2, 1));
    await client.stop();
    output.save(r.report.snapshot());
    const saved = readLocalJson(join(dir, 'gifts.json')) as ReturnType<
        typeof r.report.snapshot
    >;
    assert.equal(saved.gifts[0].notifications, 1);
    assert.equal(saved.scoringEligible, false);
    assert.throws(() => prepareActive(loadReference(), saved));
});
