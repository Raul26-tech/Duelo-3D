import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
    mkdtempSync,
    rmSync,
    readFileSync,
    writeFileSync,
    statSync,
    symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import {
    loadReference,
    parseReference,
    reviewTemplate,
    parseReviews,
    pendingReview,
    prepareActive,
    verifyActive,
    type GiftReview,
} from '../src/catalog-tools/catalog.ts';
import { parseReviewedCatalog } from '../src/integration/config.ts';
import {
    validateRealOccurrence,
    TIKTOK_ORIGIN,
} from '../src/integration/ingress.ts';
import {
    createScoringEngine,
    type EngineOptions,
} from '../src/scoring/engine.ts';
import { openSqliteScoring } from '../src/persistence/sqlite.ts';
import { writeNewLocalJson, readLocalJson } from '../src/local-json.ts';
import { interpretComment } from '../src/scoring/comments.ts';
import { ROOM, USER } from './fixtures/tiktok.ts';

const reference = loadReference();
const expected = [
    ['Rose', '5655', 'lula', 2, 'operator-reported-live'],
    ['Finger Heart', '5487', 'lula', 10, 'operator-reported-live'],
    ['Heart', '5576', 'lula', 20, 'external-unconfirmed'],
    ['Doughnut', '5879', 'lula', 50, 'operator-reported-live'],
    ['Confetti', '5585', 'lula', 200, 'external-unconfirmed'],
    ['Money Gun', '7168', 'lula', 1000, 'external-unconfirmed'],
    ['Galaxy', '6364', 'lula', 10000, 'external-unconfirmed'],
    ['White Rose', '8239', 'flavio', 2, 'external-unconfirmed'],
    ['Overreact', '19447', 'flavio', 10, 'external-unconfirmed'],
    ['Tiny Diny', '6560', 'flavio', 20, 'operator-reported-live'],
    ['Capybara', '14488', 'flavio', 50, 'operator-reported-live'],
    ['Hand Heart', '6968', 'flavio', 200, 'external-unconfirmed'],
    ["You're Amazing", '9948', 'flavio', 1000, 'external-unconfirmed'],
    ['Watermelon Love', '6781', 'flavio', 10000, 'external-unconfirmed'],
];
// Explicit SYNTHETIC attestations for offline tests. These do not validate actual deliveries.
function approved(
    giftId: string,
    delivery: 'single' | 'cumulative-final' = 'single',
): GiftReview {
    const gift = reference.find((entry) => entry.giftId === giftId)!;
    return {
        giftId,
        idConfirmed: true,
        observedName: gift.name,
        nameConfirmed: true,
        connectorVersion: 'tiktok-live-connector@2.5.0',
        connectorFieldsReviewed: true,
        delivery,
        repeatCount: delivery === 'single' ? 'unit' : 'cumulative',
        repeatEnd: 'explicit-final',
        groupId: delivery === 'single' ? 'not-required' : 'sequence',
        operatorApproved: true,
    };
}
function temporary(t: TestContext) {
    const dir = mkdtempSync(join(tmpdir(), 'duelo-gifts-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}
const payload = (
    giftId: string,
    eventId: string,
    quantity = 1,
    final = 1,
    combo = false,
) => ({
    common: { roomId: ROOM, msgId: eventId },
    user: { id: USER },
    giftId,
    gift: {
        id: giftId,
        name:
            reference.find((entry) => entry.giftId === giftId)?.name ??
            'Unknown',
        type: combo ? 1 : 2,
        combo,
    },
    groupId: combo ? '7812345678901234567' : '0',
    repeatCount: quantity,
    repeatEnd: final,
});
const settings = (active: ReturnType<typeof prepareActive>): EngineOptions => ({
    origin: TIKTOK_ORIGIN,
    roomId: ROOM,
    domain: 'real',
    enableRealScoring: true,
    catalog: active.map(({ delivery: _delivery, ...rule }) => rule),
    sourcePolicy: 'synthetic-catalog-test',
});
function event(active: ReturnType<typeof prepareActive>, raw: unknown) {
    const result = validateRealOccurrence('gift', raw, ROOM, ROOM, active);
    assert.ok(result.event);
    return result.event;
}

test('referência preserva os 14 nomes, IDs, candidatos e pontos do operador', () => {
    assert.deepEqual(
        reference.map((gift) => [
            gift.name,
            gift.giftId,
            gift.candidate,
            gift.points,
            gift.provenance,
        ]),
        expected,
    );
    assert.equal(reference.length, 14);
    assert.ok(reference.every((gift) => gift.deliveryStatus === 'unreviewed'));
    assert.throws(() => {
        (reference[0] as { points: number }).points = 999;
    });
});
test('cinco IDs observados e nove provisórios nunca implicam entrega ou aprovação', () => {
    assert.equal(
        reference.filter((gift) => gift.provenance === 'operator-reported-live')
            .length,
        5,
    );
    assert.equal(
        reference.filter((gift) => gift.provenance === 'external-unconfirmed')
            .length,
        9,
    );
    const reviews = reviewTemplate(reference);
    assert.equal(reviews.filter((review) => review.idConfirmed).length, 5);
    assert.ok(
        reviews.every(
            (review) =>
                !review.operatorApproved &&
                review.delivery === null &&
                !review.nameConfirmed &&
                !review.connectorFieldsReviewed,
        ),
    );
    assert.deepEqual(prepareActive(reference, reviews), []);
    assert.deepEqual(
        parseReviewedCatalog(
            readLocalJson(
                fileURLToPath(
                    new URL(
                        '../../../config/gift-catalog.example.json',
                        import.meta.url,
                    ),
                ),
            ),
        ),
        [],
    );
});
for (const giftId of [
    '',
    '0',
    '-1',
    '5.5',
    'abc',
    5655,
    Number.MAX_SAFE_INTEGER + 1,
]) {
    test(`referência rejeita ID inválido ${JSON.stringify(giftId)}`, () => {
        assert.throws(() =>
            parseReference(
                reference.map((gift, index) =>
                    index ? gift : { ...gift, giftId },
                ),
            ),
        );
    });
}
test('referência rejeita IDs duplicados e candidatos inválidos', () => {
    assert.throws(() =>
        parseReference(
            reference.map((gift, index) =>
                index === 1 ? { ...gift, giftId: reference[0].giftId } : gift,
            ),
        ),
    );
    assert.throws(() =>
        parseReference(
            reference.map((gift, index) =>
                index ? gift : { ...gift, candidate: 'other' },
            ),
        ),
    );
});
for (const points of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '2',
]) {
    test(`referência rejeita pontos inválidos ${String(points)}`, () => {
        assert.throws(() =>
            parseReference(
                reference.map((gift, index) =>
                    index ? gift : { ...gift, points },
                ),
            ),
        );
    });
}
test('aprovação incompleta rejeitada campo a campo, sem coerção ou suposição de entrega', () => {
    for (const change of [
        { idConfirmed: false },
        { observedName: 'rose' },
        { observedName: null },
        { nameConfirmed: false },
        { connectorFieldsReviewed: false },
        { connectorVersion: 'other' },
        { delivery: null },
        { repeatCount: null },
        { repeatEnd: null },
        { groupId: null },
        { idConfirmed: 'true' },
        { delivery: 'cumulative-final', repeatCount: 'unit' },
        { delivery: 'cumulative-final', groupId: 'not-required' },
    ])
        assert.throws(() =>
            prepareActive(reference, [{ ...approved('5655'), ...change }]),
        );
    assert.ok(
        pendingReview(reference[0], reviewTemplate(reference)[0]).includes(
            'delivery',
        ),
    );
});
test('provisório exige confirmação explícita do ID, nome e revisão do operador', () => {
    assert.throws(
        () =>
            prepareActive(reference, [
                { ...approved('5576'), idConfirmed: false },
            ]),
        /id_confirmation/,
    );
    assert.deepEqual(
        prepareActive(reference, [
            { ...approved('5576'), operatorApproved: false },
        ]),
        [],
    );
    assert.deepEqual(prepareActive(reference, [approved('5576')]), [
        {
            giftId: '5576',
            name: 'Heart',
            candidate: 'lula',
            points: 20,
            delivery: 'single',
        },
    ]);
});
test('revisões desconhecidas/duplicadas e metadados extras são rejeitados', () => {
    assert.throws(() =>
        parseReviews([{ ...approved('5655'), giftId: '9999' }], reference),
    );
    assert.throws(() =>
        parseReviews([approved('5655'), approved('5655')], reference),
    );
    assert.throws(() =>
        prepareActive(reference, [{ ...approved('5655'), points: 999 }]),
    );
});
test('geração seleciona apenas aprovações completas e remove todos os metadados administrativos', () => {
    const active = prepareActive(reference, [
        approved('5655'),
        { ...approved('6560'), operatorApproved: false },
    ]);
    assert.deepEqual(active, [
        {
            giftId: '5655',
            name: 'Rose',
            candidate: 'lula',
            points: 2,
            delivery: 'single',
        },
    ]);
    assert.deepEqual(
        Object.keys(active[0]).sort(),
        ['giftId', 'name', 'candidate', 'points', 'delivery'].sort(),
    );
    assert.deepEqual(
        verifyActive(reference, [approved('5655')], active),
        active,
    );
    assert.throws(() => verifyActive(reference, [], active));
    assert.throws(() =>
        verifyActive(
            reference,
            [approved('5655')],
            [{ ...active[0], points: 10 }],
        ),
    );
    assert.throws(() =>
        verifyActive(
            reference,
            [approved('5655')],
            [{ ...active[0], provenance: 'operator-reported-live' }],
        ),
    );
});
test('presente desconhecido e Rose com ID observado mas entrega não revisada não pontuam', () => {
    const active = prepareActive(reference, reviewTemplate(reference));
    const engine = createScoringEngine(settings(active));
    assert.equal(
        engine.process(event(active, payload('9999', '1001'))).reason,
        'UNKNOWN_GIFT',
    );
    assert.equal(
        engine.process(event(active, payload('5655', '1002'))).reason,
        'UNKNOWN_GIFT',
    );
    assert.deepEqual(engine.snapshot().scores, { lula: 0, flavio: 0 });
});
test('cenários sintéticos single: Rose 2 para Lula, Tiny Diny 20 para Flávio; replay não repete', () => {
    const active = prepareActive(reference, [
        approved('5655'),
        approved('6560'),
    ]);
    const engine = createScoringEngine(settings(active));
    const rose = event(active, payload('5655', '1101'));
    assert.equal(engine.process(rose).points, 2);
    assert.equal(engine.process(rose).status, 'duplicate');
    assert.equal(
        engine.process(event(active, payload('6560', '1102'))).points,
        20,
    );
    assert.deepEqual(engine.snapshot().scores, { lula: 2, flavio: 20 });
});
test('combos SINTÉTICOS acumulativos: dez Roses 20, três Capybaras 150, sem somar intermediárias', () => {
    const active = prepareActive(reference, [
        approved('5655', 'cumulative-final'),
        approved('14488', 'cumulative-final'),
    ]);
    const engine = createScoringEngine(settings(active));
    for (const [id, count, final] of [
        ['1201', 1, 0],
        ['1202', 2, 0],
        ['1203', 10, 0],
    ] as const)
        assert.equal(
            engine.process(
                event(active, payload('5655', id, count, final, true)),
            ).points,
            0,
        );
    const final = event(active, payload('5655', '1204', 10, 1, true));
    assert.equal(engine.process(final).points, 20);
    assert.equal(engine.process(final).status, 'duplicate');
    const capybara = (id: string, count: number, end: number) =>
        event(active, {
            ...payload('14488', id, count, end, true),
            groupId: '7912345678901234567',
        });
    assert.equal(engine.process(capybara('1205', 1, 0)).points, 0);
    assert.equal(engine.process(capybara('1206', 3, 1)).points, 150);
    assert.equal(engine.process(capybara('1207', 3, 1)).status, 'duplicate');
    assert.deepEqual(engine.snapshot().scores, { lula: 20, flavio: 150 });
});
test('SQLite recupera combo pendente e rejeita mudança silenciosa de catálogo; rollback íntegro', (t) => {
    const dir = temporary(t);
    const filename = join(dir, 'score.sqlite');
    const active = prepareActive(reference, [
        approved('5655', 'cumulative-final'),
    ]);
    let store = openSqliteScoring({
        filename,
        mode: 'create',
        engine: settings(active),
    });
    store.process(event(active, payload('5655', '1301', 1, 0, true)));
    const before = store.snapshot();
    store.close();
    store = openSqliteScoring({
        filename,
        mode: 'resume',
        engine: settings(active),
    });
    try {
        assert.deepEqual(store.snapshot(), before);
        const sql = new Database(filename);
        sql.exec(
            "CREATE TRIGGER fail_score BEFORE UPDATE ON dispute BEGIN SELECT RAISE(ABORT, 'synthetic'); END",
        );
        const final = event(active, payload('5655', '1302', 10, 1, true));
        assert.throws(() => store.process(final));
        assert.deepEqual(store.snapshot(), before);
        sql.exec('DROP TRIGGER fail_score');
        sql.close();
        assert.equal(store.process(final).points, 20);
    } finally {
        store.close();
    }
    store = openSqliteScoring({
        filename,
        mode: 'resume',
        engine: settings(active),
    });
    assert.equal(
        store.process(event(active, payload('5655', '1302', 10, 1, true)))
            .status,
        'duplicate',
    );
    store.close();
    assert.throws(
        () =>
            openSqliteScoring({
                filename,
                mode: 'resume',
                engine: settings(prepareActive(reference, [])),
            }),
        /context/,
    );
});
test('arquivos novos somente: não sobrescreve catálogo ativo, nem grava no repositório ou por symlink', (t) => {
    const dir = temporary(t);
    const active = join(dir, 'active.json');
    writeNewLocalJson(active, []);
    assert.equal(statSync(active).mode & 0o777, 0o600);
    assert.throws(() => writeNewLocalJson(active, [{ points: 999 }]));
    assert.deepEqual(readLocalJson(active), []);
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    assert.throws(
        () => writeNewLocalJson(join(repo, 'would-write.json'), []),
        /outside/,
    );
    symlinkSync(repo, join(dir, 'repo-link'), 'dir');
    assert.throws(
        () => writeNewLocalJson(join(dir, 'repo-link', 'would-write.json'), []),
        /outside/,
    );
    assert.throws(() => writeNewLocalJson('relative.json', []));
    const oversized = join(dir, 'large.json');
    writeFileSync(oversized, ' '.repeat(65537));
    assert.throws(() => readLocalJson(oversized));
});
test('CLI offline: list, template, validate, prepare e verify; argumentos e sobrescrita falham', (t) => {
    const dir = temporary(t);
    const template = join(dir, 'reviews.json');
    const active = join(dir, 'active.json');
    const cli = fileURLToPath(
        new URL('../src/catalog-tools/main.ts', import.meta.url),
    );
    const run = (...args: string[]) =>
        spawnSync(process.execPath, [cli, ...args], {
            cwd: dir,
            encoding: 'utf8',
            env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: undefined },
        });
    const list = run('list');
    assert.equal(list.status, 0);
    assert.equal(JSON.parse(list.stdout).length, 14);
    assert.equal(run('template', '--output', template).status, 0);
    assert.equal(run('validate', template).status, 0);
    assert.equal(JSON.parse(run('validate', template).stdout).pending, 14);
    assert.equal(run('prepare', template, '--output', active).status, 0);
    assert.deepEqual(readLocalJson(active), []);
    assert.equal(run('verify', template, active).status, 0);
    assert.notEqual(run('prepare', template, '--output', active).status, 0);
    assert.notEqual(run('approve-all').status, 0);
    assert.notEqual(
        run('prepare', template, '--force', '--output', active).status,
        0,
    );
    writeFileSync(template, JSON.stringify([approved('5655')]));
    const approvedFile = join(dir, 'authorized.json');
    assert.equal(run('prepare', template, '--output', approvedFile).status, 0);
    assert.equal(run('verify', template, approvedFile).status, 0);
    assert.equal(JSON.parse(run('list', template).stdout)[0].pending.length, 0);
});
test('comentários 13 e 22 permanecem intactos; aliases mistos não pontuam', () => {
    assert.equal(interpretComment('13'), 'lula');
    assert.equal(interpretComment('22'), 'flavio');
    assert.equal(interpretComment('Lula 13'), 'lula');
    assert.equal(interpretComment('Flávio 22'), 'flavio');
    assert.equal(interpretComment('13 22'), null);
    assert.equal(interpretComment('Lula 22'), null);
});
