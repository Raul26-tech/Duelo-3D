import { defer, track } from './helpers/resources.ts';
import { runCatalogCli } from '../src/catalog-tools/main.ts';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once, EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import {
    createGiftCatalog,
    giftRuleKey,
    matchGift,
} from '../src/scoring/catalog.ts';
import {
    createScoringEngine,
    type EngineOptions,
} from '../src/scoring/engine.ts';
import { parseEvent, fingerprint } from '../src/scoring/validation.ts';
import {
    parseReviewedCatalog,
    readRealConfig,
    type ReviewedGift,
} from '../src/integration/config.ts';
import {
    validateRealOccurrence,
    TIKTOK_ORIGIN,
} from '../src/integration/ingress.ts';
import { openSqliteScoring } from '../src/persistence/sqlite.ts';
import {
    SCHEMA,
    SCHEMA_VERSION,
    APPLICATION_ID,
} from '../src/persistence/schema.ts';
import {
    loadReference,
    prepareActive,
    reviewTemplate,
    parseReference,
    type GiftReview,
} from '../src/catalog-tools/catalog.ts';
import { startRealRuntime } from '../src/integration/runtime.ts';
import { createBackendServer } from '../src/server.ts';
import { ROOM, USER } from './fixtures/tiktok.ts';

const reference = loadReference();
// All delivery attestations in this file are SYNTHETIC, never operator approval for a LIVE.
function review(
    id: string,
    delivery: 'single' | 'cumulative-final' = 'single',
): GiftReview {
    const item = reviewTemplate(reference).find((item) => item.giftId === id)!;
    return {
        ...item,
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
const active = (
    id: string,
    delivery: 'single' | 'cumulative-final' = 'single',
) => prepareActive(reference, [review(id, delivery)]);
const settings = (gifts: readonly ReviewedGift[]): EngineOptions => ({
    origin: TIKTOK_ORIGIN,
    roomId: ROOM,
    domain: 'real',
    enableRealScoring: true,
    sourcePolicy: 'hybrid-v1-synthetic',
    catalog: gifts.map(({ delivery: _delivery, ...rule }) => rule),
});
function raw(
    name: unknown,
    giftId = '99999',
    id = '1001',
    count = 1,
    final = 1,
    group = '5001',
    actor = USER,
    combo = false,
) {
    return {
        common: { roomId: ROOM, msgId: id },
        user: { id: actor },
        giftId,
        gift: {
            id: giftId,
            ...(name === undefined ? {} : { name }),
            type: combo ? 1 : 2,
            combo,
        },
        repeatCount: count,
        repeatEnd: final,
        groupId: group,
    };
}
function occurrence(gifts: readonly ReviewedGift[], data: unknown) {
    const result = validateRealOccurrence('gift', data, ROOM, ROOM, gifts);
    assert.ok(result.event, result.reason ?? 'Missing event');
    return result.event;
}
function temp(t: TestContext) {
    const directory = mkdtempSync(join(tmpdir(), 'duelo-hybrid-'));
    defer(t, () => rmSync(directory, { recursive: true, force: true }));
    return directory;
}
for (const item of reference.filter((gift) => gift.match === 'id')) {
    test(`ID confirmado: ${item.name} ${item.giftId}; nome e candidato preservados`, () => {
        const gifts = active(item.giftId);
        const engine = createScoringEngine(settings(gifts));
        const event = occurrence(gifts, raw(item.name, item.giftId));
        assert.equal(engine.process(event).points, item.points);
        assert.equal(engine.snapshot().scores[item.candidate], item.points);
        assert.equal(
            engine.process(occurrence(gifts, raw(item.name, '999999', '1002')))
                .points,
            0,
        );
        assert.equal(
            validateRealOccurrence(
                'gift',
                raw(item.name, item.giftId),
                ROOM,
                ROOM,
                gifts,
            ).matchReason,
            'MATCH_BY_ID',
        );
    });
}
for (const item of reference.filter((gift) => gift.match === 'exact-name')) {
    test(`nome literal ${item.name}: IDs histórico, desconhecido e divergente não autorizam outros nomes`, () => {
        const gifts = active(item.giftId);
        assert.equal(review(item.giftId).idConfirmed, false);
        assert.equal(gifts[0].match, 'exact-name');
        assert.equal(Object.hasOwn(gifts[0], 'giftId'), false);
        const engine = createScoringEngine(settings(gifts));
        for (const [index, id] of [
            item.giftId,
            '90000000000000000001',
            '90000000000000000002',
        ].entries()) {
            const event = occurrence(
                gifts,
                raw(item.name, id, String(2000 + index)),
            );
            assert.equal(event.type, 'gift');
            if (event.type === 'gift') {
                assert.equal(event.giftId, id);
                assert.equal(event.giftRuleId, item.ruleId);
            }
            assert.equal(engine.process(event).points, item.points);
            assert.equal(engine.process(event).status, 'duplicate');
        }
        for (const [index, name] of [
            item.name.toLowerCase(),
            ` ${item.name}`,
            `${item.name}!`,
        ].entries()) {
            const event = occurrence(
                gifts,
                raw(name, item.giftId, String(3000 + index)),
            );
            assert.equal(engine.process(event).points, 0);
        }
        assert.equal(engine.snapshot().scores[item.candidate], item.points * 3);
    });
}
test('referência seis por ID e oito por nome, nenhum autorizado; identidade interna única', () => {
    assert.equal(reference.filter((gift) => gift.match === 'id').length, 6);
    assert.equal(
        reference.filter((gift) => gift.match === 'exact-name').length,
        8,
    );
    assert.deepEqual(prepareActive(reference, reviewTemplate(reference)), []);
    assert.equal(
        new Set(
            reference.filter((gift) => gift.ruleId).map((gift) => gift.ruleId),
        ).size,
        8,
    );
    assert.throws(() =>
        parseReference(
            reference.map((gift) =>
                gift.name === 'Galaxy'
                    ? { ...gift, ruleId: 'name:heart' }
                    : gift,
            ),
        ),
    );
});
test('nome conhecido não dispensa revisão da entrega ou aprovação; sem promoção de ID', () => {
    for (const change of [
        { delivery: null },
        { connectorFieldsReviewed: false },
        { nameConfirmed: false },
        { observedName: 'heart' },
        { repeatCount: 'unit', delivery: 'cumulative-final' },
        { repeatEnd: null },
        { groupId: null },
    ])
        assert.throws(() =>
            prepareActive(reference, [{ ...review('5576'), ...change }]),
        );
    assert.deepEqual(
        prepareActive(reference, [
            { ...review('5576'), operatorApproved: false },
        ]),
        [],
    );
    assert.equal(
        reviewTemplate(reference).find((item) => item.giftId === '5576')!
            .idConfirmed,
        false,
    );
    assert.throws(() =>
        prepareActive(reference, [{ ...review('5576'), match: 'id' }]),
    );
});
test('catálogo estrito: nomes duplicados entre modos, IDs, identidade, pontos e campos extras', () => {
    const heart = active('5576')[0];
    const rose = active('5655')[0];
    for (const entries of [
        [heart, { ...heart, ruleId: 'name:other' }],
        [heart, { ...rose, name: 'Heart' }],
        [rose, { ...rose, name: 'Other' }],
        [{ ...heart, giftId: '5576' }],
        [{ ...heart, ruleId: '5576' }],
        [{ ...heart, ruleId: 'name:bad name' }],
        [{ ...heart, match: 'fuzzy' }],
        [{ ...heart, diamonds: 1 }],
        [{ ...rose, match: 'exact-name' }],
        [{ ...rose, delivery: null }],
        [{ ...heart, candidate: 'other' }],
        ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '20'].map(
            (points) => [{ ...heart, points }],
        ),
    ])
        assert.throws(() => parseReviewedCatalog(entries));
});
test('Rose ≠ White Rose; Heart ≠ Finger Heart ≠ Hand Heart; nomes próximos não correspondem', () => {
    const gifts = prepareActive(reference, [
        review('5655'),
        review('8239'),
        review('5576'),
        review('5487'),
        review('6968'),
        review('9948'),
    ]);
    assert.equal(
        matchGift(gifts, '5655', 'White Rose').reason,
        'ID_NAME_CONFLICT',
    );
    assert.equal(matchGift(gifts, '5655', 'Heart').reason, 'ID_NAME_CONFLICT');
    assert.equal(
        matchGift(gifts, '5487', 'Hand Heart').reason,
        'ID_NAME_CONFLICT',
    );
    assert.equal(
        matchGift(gifts, '999', "You're awesome").reason,
        'NAME_NOT_AUTHORIZED',
    );
    assert.equal(
        matchGift(gifts, '999', 'Finger Heart').reason,
        'NAME_NOT_AUTHORIZED',
    );
    assert.equal(
        matchGift(gifts, '999', 'White Rose').reason,
        'NAME_NOT_AUTHORIZED',
    );
    assert.equal(matchGift(gifts, '999', 'Heart').rule?.points, 20);
    assert.equal(matchGift(gifts, '999', 'Hand Heart').rule?.points, 200);
    assert.equal(matchGift(gifts, '999', "You're Amazing").rule?.points, 1000);
    assert.equal(
        matchGift(
            [
                gifts.find((gift) => gift.giftId === '5655')!,
                gifts.find((gift) => gift.giftId === '5655')!,
            ],
            '5655',
            'Rose',
        ).reason,
        'AMBIGUOUS_GIFT',
    );
});
test('ID correto com nome não autorizado nunca pontua nem permite fallback; ocorrência contraditória fica deduplicada', () => {
    const gifts = prepareActive(reference, [review('5655'), review('5576')]);
    const engine = createScoringEngine(settings(gifts));
    const bad = occurrence(gifts, raw('Heart', '5655'));
    assert.equal(engine.process(bad).reason, 'ID_NAME_CONFLICT');
    assert.equal(
        engine.process(occurrence(gifts, raw('Rose', '5655'))).reason,
        'IDENTITY_CONFLICT',
    );
    assert.equal(engine.snapshot().version, 0);
    assert.equal(
        engine.process(occurrence(gifts, raw(undefined, '5655', '1002')))
            .points,
        2,
    );
});
test('nome ausente, vazio, inválido ou parcial não pontua; ID externo ausente/contraditório não é inventado', () => {
    const gifts = active('5576');
    const engine = createScoringEngine(settings(gifts));
    for (const [i, name] of [
        undefined,
        '',
        null,
        13,
        {},
        'Heart extra',
        'Heart\n',
    ].entries()) {
        const result = validateRealOccurrence(
            'gift',
            raw(name, '999', String(4000 + i)),
            ROOM,
            ROOM,
            gifts,
        );
        if (result.event) assert.equal(engine.process(result.event).points, 0);
    }
    for (const data of [
        { ...raw('Heart'), giftId: undefined },
        {
            ...raw('Heart'),
            gift: { id: '888', name: 'Heart', type: 2, combo: false },
        },
    ])
        assert.equal(
            validateRealOccurrence('gift', data, ROOM, ROOM, gifts).event,
            undefined,
        );
    assert.equal(engine.snapshot().version, 0);
});
test('proteções do conector e entrega não são relaxadas por nome; preço externo não pontua', () => {
    const gifts = active('5576', 'cumulative-final');
    for (const data of [
        raw('Heart'),
        {
            ...raw('Heart', '999', '5001', 2, 1, '8001', USER, true),
            groupId: undefined,
        },
        {
            ...raw('Heart', '999', '5002', 2, 1, '8001', USER, true),
            repeatEnd: true,
        },
    ])
        assert.equal(
            validateRealOccurrence('gift', data, ROOM, ROOM, gifts).event,
            undefined,
        );
    const single = active('5576');
    const engine = createScoringEngine(settings(single));
    assert.equal(
        engine.process(
            occurrence(single, {
                ...raw('Heart'),
                points: 100000,
                candidate: 'flavio',
                diamondCount: 999999,
                coins: 999999,
            }),
        ).points,
        20,
    );
});
test('combos por nome: IDs externos podem variar entre ocorrências, sem somar intermediárias; mesma ocorrência divergente é conflito', () => {
    const gifts = active('5576', 'cumulative-final');
    const engine = createScoringEngine(settings(gifts));
    const send = (
        id: string,
        external: string,
        quantity: number,
        final: number,
        group = '8001',
    ) =>
        engine.process(
            occurrence(
                gifts,
                raw('Heart', external, id, quantity, final, group, USER, true),
            ),
        );
    assert.equal(send('6001', '999', 1, 0).reason, 'COMBO_PENDING');
    assert.equal(send('6002', '888', 2, 0).points, 0);
    assert.equal(send('6003', '777', 3, 1).points, 60);
    assert.equal(send('6003', '777', 3, 1).status, 'duplicate');
    assert.equal(send('6004', '666', 3, 1).reason, 'COMBO_ALREADY_PROCESSED');
    assert.equal(send('6005', '555', 2, 0).reason, 'COMBO_CONFLICT');
    assert.equal(send('6010', '999', 1, 0, '8002').reason, 'COMBO_PENDING');
    assert.equal(send('6010', '888', 1, 0, '8002').reason, 'IDENTITY_CONFLICT');
    assert.equal(send('6011', '888', 3, 1, '8002').reason, 'COMBO_CONFLICT');
    assert.equal(engine.snapshot().scores.lula, 60);
    assert.equal(engine.checkpoint().sequences[0].giftId, 'name:heart');
});
test('sequências independentes por ator e grupo, regressão, troca de regra e overflow', () => {
    const gifts = prepareActive(reference, [
        review('5576', 'cumulative-final'),
        review('5585', 'cumulative-final'),
    ]);
    const engine = createScoringEngine(settings(gifts));
    const send = (
        name: string,
        id: string,
        n: number,
        end: number,
        actor = USER,
        group = '9001',
    ) =>
        engine.process(
            occurrence(gifts, raw(name, '999', id, n, end, group, actor, true)),
        );
    assert.equal(send('Heart', '7001', 1, 0).points, 0);
    assert.equal(send('Heart', '7002', 2, 0, '999999').points, 0);
    assert.equal(send('Heart', '7003', 3, 1).points, 60);
    assert.equal(send('Heart', '7004', 2, 1, '999999').points, 40);
    assert.equal(send('Heart', '7010', 3, 0, USER, '9002').points, 0);
    assert.equal(
        send('Heart', '7011', 2, 0, USER, '9002').reason,
        'COMBO_CONFLICT',
    );
    assert.equal(
        send('Heart', '7012', 3, 1, USER, '9002').reason,
        'COMBO_CONFLICT',
    );
    assert.equal(send('Heart', '7020', 1, 0, USER, '9003').points, 0);
    assert.equal(
        send('Confetti', '7021', 2, 1, USER, '9003').reason,
        'COMBO_CONFLICT',
    );
    const huge = parseReviewedCatalog([
        {
            ...gifts.find((gift) => gift.name === 'Heart')!,
            points: Number.MAX_SAFE_INTEGER,
        },
    ]);
    const overflow = createScoringEngine(settings(huge));
    const before = overflow.checkpoint();
    assert.equal(
        overflow.process(
            occurrence(
                huge,
                raw('Heart', '999', '7101', 2, 1, '9101', USER, true),
            ),
        ).reason,
        'SCORE_LIMIT',
    );
    assert.deepEqual(overflow.checkpoint(), before);
});
test('evento normalizado e fingerprint mantêm ID externo, nome e regra; esquema incompleto e regra forjada rejeitados', () => {
    const gifts = active('5576');
    const event = occurrence(gifts, raw('Heart', '90000000000000000001'));
    assert.deepEqual(parseEvent(JSON.parse(JSON.stringify(event))), event);
    assert.ok(fingerprint(event).includes('90000000000000000001'));
    assert.ok(fingerprint(event).includes('name:heart'));
    for (const change of [
        { giftPolicy: 'v999' },
        { giftName: undefined },
        { giftRuleId: undefined },
        { giftRuleId: '5655' },
    ]) {
        const engine = createScoringEngine(settings(gifts));
        assert.equal(engine.process({ ...event, ...change }).points, 0);
    }
    const engine = createScoringEngine(settings(gifts));
    assert.equal(
        engine.process({
            ...event,
            giftPolicy: undefined,
            giftName: undefined,
            giftRuleId: undefined,
        }).points,
        0,
    );
});
test('SQLite híbrido: pending, rollback, commit, replay, dedup, fingerprint e retomada estrita', (t) => {
    const filename = join(temp(t), 'hybrid.sqlite');
    const gifts = active('5576', 'cumulative-final');
    const options = { filename, engine: settings(gifts) };
    let store = track(t, openSqliteScoring({ ...options, mode: 'create' }));
    const pending = occurrence(
        gifts,
        raw('Heart', '999', '8001', 1, 0, '10001', USER, true),
    );
    store.process(pending);
    const before = store.snapshot();
    store.close();
    store = track(t, openSqliteScoring({ ...options, mode: 'resume' }));
    assert.deepEqual(store.snapshot(), before);
    const final = occurrence(
        gifts,
        raw('Heart', '888', '8002', 3, 1, '10001', USER, true),
    );
    const db = track(t, new Database(filename));
    db.exec(
        "CREATE TRIGGER reject_commit BEFORE UPDATE ON dispute BEGIN SELECT RAISE(ABORT, 'synthetic'); END",
    );
    assert.throws(() => store.process(final), /synthetic/);
    assert.deepEqual(store.snapshot(), before);
    assert.equal(
        (db.prepare('SELECT count(*) n FROM journal').get() as { n: number }).n,
        1,
    );
    db.exec('DROP TRIGGER reject_commit');
    assert.equal(store.process(final).points, 60);
    const after = store.snapshot();
    store.close();
    store = track(t, openSqliteScoring({ ...options, mode: 'resume' }));
    assert.deepEqual(store.snapshot(), after);
    assert.equal(store.process(final).status, 'duplicate');
    assert.equal(
        store.process({ ...final, eventId: '8003' }).reason,
        'COMBO_ALREADY_PROCESSED',
    );
    assert.equal(
        store.process({ ...final, giftId: '777' }).reason,
        'IDENTITY_CONFLICT',
    );
    const events = db
        .prepare('SELECT event_json FROM journal ORDER BY position')
        .all() as { event_json: string }[];
    assert.equal(JSON.parse(events[0].event_json).giftId, '999');
    assert.equal(JSON.parse(events[1].event_json).giftId, '888');
    assert.equal(JSON.parse(events[1].event_json).giftRuleId, 'name:heart');
    assert.equal(
        (
            db.prepare('SELECT gift_id FROM gift_sequences').get() as {
                gift_id: string;
            }
        ).gift_id,
        'name:heart',
    );
    store.close();
    for (const engine of [
        { ...settings(gifts), sourcePolicy: 'different' },
        settings(parseReviewedCatalog([{ ...gifts[0], points: 25 }])),
    ])
        assert.throws(
            () =>
                track(
                    t,
                    openSqliteScoring({ filename, engine, mode: 'resume' }),
                ),
            /context/,
        );
    db.exec(
        "UPDATE journal SET event_json = replace(event_json, 'Heart', 'Other') WHERE position=1",
    );
    db.close();
    assert.throws(
        () => track(t, openSqliteScoring({ ...options, mode: 'resume' })),
        /digest/,
    );
});
test('catálogo legado de quatro presentes preserva configuração, fingerprint e política histórica', (t) => {
    const ids = ['5655', '5487', '6560', '14488'];
    const gifts = parseReviewedCatalog(
        ids.map((id) => {
            const gift = reference.find((item) => item.giftId === id)!;
            return {
                giftId: id,
                name: gift.name,
                candidate: gift.candidate,
                points: gift.points,
                delivery: 'single',
            };
        }),
    );
    assert.equal(gifts.length, 4);
    assert.ok(gifts.every((gift) => !Object.hasOwn(gift, 'match')));
    const filename = join(temp(t), 'legacy.sqlite');
    const options = { filename, engine: settings(gifts) };
    let store = track(t, openSqliteScoring({ ...options, mode: 'create' }));
    for (const [index, gift] of gifts.entries())
        store.process(
            occurrence(
                gifts,
                raw(gift.name, gift.giftId!, String(9000 + index)),
            ),
        );
    const before = store.snapshot();
    store.close();
    store = track(t, openSqliteScoring({ ...options, mode: 'resume' }));
    assert.deepEqual(store.snapshot(), before);
    assert.equal(before.scores.lula, 12);
    assert.equal(before.scores.flavio, 70);
    const data = occurrence(
        gifts,
        raw(gifts[0].name, gifts[0].giftId!, '9000'),
    );
    assert.equal(store.process(data).status, 'duplicate');
    if (data.type === 'gift') assert.equal(data.giftPolicy, undefined);
    store.close();
    const directory = temp(t),
        path = join(directory, 'legacy.json');
    writeFileSync(path, JSON.stringify(gifts));
    const env = {
        DUEL_MODE: 'real',
        TIKTOK_REAL_ENABLED: 'true',
        TIKTOK_IDENTITY_REVIEWED: 'true',
        TIKTOK_USERNAME: 'synthetic_test',
        TIKTOK_ROOM_ID: ROOM,
        TIKTOK_SESSION_ACTION: 'resume',
        TIKTOK_DATABASE: filename,
        TIKTOK_GIFT_CATALOG: path,
    };
    assert.equal(
        readRealConfig(env).sourcePolicy,
        createHash('sha256')
            .update(
                JSON.stringify({
                    provider: TIKTOK_ORIGIN,
                    profile: 'v3-reviewed-identity-v1',
                    username: 'synthetic_test',
                    roomId: ROOM,
                    gifts,
                }),
            )
            .digest('hex'),
    );
});
test('WebSocket híbrido: publica depois do commit, falha de publicação recupera por snapshot sem duplicação', async (t) => {
    class Provider extends EventEmitter {
        async connect() {
            return { roomId: ROOM };
        }
        async disconnect() {}
    }
    const provider = new Provider();
    const filename = join(temp(t), 'arena.sqlite');
    const server = createBackendServer('real');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = 'http://127.0.0.1:5173',
        gifts = prepareActive(reference, [review('5576'), review('5655')]);
    let publications = 0;
    const lines: string[] = [];
    const runtime = startRealRuntime({
        server,
        origin,
        writeDiagnostic: (line) => lines.push(line),
        factory: () => provider,
        config: {
            mode: 'real',
            username: 'synthetic_test',
            roomId: ROOM,
            filename,
            action: 'create',
            gifts,
            sourcePolicy: 'hybrid-v1-synthetic',
        },
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
            if (++publications === 1) throw new Error('synthetic transport');
        },
    });
    const viewers: WebSocket[] = [];
    defer(t, async () => {
        for (const ws of viewers) ws.terminate();
        await runtime.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    for (let i = 0; i < 5; i++)
        await new Promise<void>((resolve) => setImmediate(resolve));
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
    provider.emit('gift', raw('Heart'));
    await closed;
    const second = await viewer();
    assert.equal(second.state.scores.a, 20);
    provider.emit('gift', raw('Heart'));
    assert.equal(runtime.snapshot().version, 1);
    const update = once(second.ws, 'message');
    provider.emit('gift', raw('Heart', '888', '1002'));
    assert.equal(JSON.parse((await update)[0].toString()).state.scores.a, 40);
    const rejection = once(second.ws, 'message');
    second.ws.send(JSON.stringify({ type: 'simulation.vote', points: 999 }));
    assert.equal(
        JSON.parse((await rejection)[0].toString()).code,
        'READ_ONLY_REAL_ARENA',
    );
    assert.equal(runtime.snapshot().scores.lula, 40);
    provider.emit('gift', raw('Heart', '5655', '1003'));
    provider.emit(
        'gift',
        raw('Heart', '888', '1004', 2, 1, '5005', USER, true),
    );
    assert.equal(runtime.snapshot().scores.lula, 40);
    const reports = lines.map((line) => JSON.parse(line));
    assert.ok(
        reports.some(
            (row) =>
                row.reason === 'MATCH_BY_EXACT_NAME' &&
                row.matchMode === 'exact-name',
        ),
    );
    assert.ok(
        reports.some(
            (row) =>
                row.reason === 'ID_NAME_CONFLICT' && row.matchMode === 'id',
        ),
    );
    assert.ok(
        reports.some(
            (row) =>
                row.reason === 'DELIVERY_NOT_VALIDATED' &&
                row.matchMode === 'exact-name',
        ),
    );
    assert.ok(
        lines.every((line) => !line.includes(USER) && !line.includes(ROOM)),
    );
});

test('fixture capturada do motor anterior: replay v2 e combo pendente mantêm serialização e decisões', (t) => {
    const fixture = JSON.parse(
        readFileSync(
            new URL('./fixtures/gift-id-v2.json', import.meta.url),
            'utf8',
        ),
    );
    const filename = join(temp(t), 'historical.sqlite');
    const cp = fixture.checkpoint,
        cfg = cp.configuration,
        state = cp.state;
    const db = track(t, new Database(filename));
    // Import only the existing schema; no runtime migration or new table.
    db.pragma('journal_mode=WAL');
    db.pragma('foreign_keys=ON');
    db.exec(SCHEMA);
    db.pragma(`application_id=${APPLICATION_ID}`);
    db.pragma(`user_version=${SCHEMA_VERSION}`);
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
    db.close();
    const store = track(
        t,
        openSqliteScoring({
            filename,
            mode: 'resume',
            engine: fixture.options,
        }),
    );
    try {
        assert.deepEqual(store.snapshot(), state);
        assert.equal(store.process(fixture.journal[1]).status, 'duplicate');
        assert.equal(
            store.process({
                ...fixture.journal[0],
                eventId: '1003',
                delivery: {
                    kind: 'combo',
                    sequenceId: '5001',
                    quantity: 3,
                    final: true,
                },
            }).points,
            6,
        );
    } finally {
        store.close();
    }
});

test('SQLite rejeita alteração de identidade/regra mesmo com ID externo real preservado; contextos não se misturam', (t) => {
    const gifts = active('5576');
    const filename = join(temp(t), 'identities.sqlite'),
        options = { filename, engine: settings(gifts) };
    let store = track(t, openSqliteScoring({ ...options, mode: 'create' }));
    const event = occurrence(gifts, raw('Heart'));
    assert.equal(store.process(event).points, 20);
    store.close();
    store = track(t, openSqliteScoring({ ...options, mode: 'resume' }));
    try {
        assert.equal(
            store.process({ ...event, giftRuleId: 'name:galaxy' }).reason,
            'IDENTITY_CONFLICT',
        );
        for (const changed of [
            { roomId: '999' },
            { domain: 'observation' },
            { domain: 'simulation' },
            { origin: 'untrusted' },
        ])
            assert.equal(store.process({ ...event, ...changed }).points, 0);
        assert.equal(store.snapshot().scores.lula, 20);
    } finally {
        store.close();
    }
});

test('CLI híbrida: template seguro, geração/revisão/verify por nome sem ID confirmado e recusa de sobrescrita', (t) => {
    const directory = temp(t),
        reviewPath = join(directory, 'reviews.json'),
        activePath = join(directory, 'active.json');
    const output: string[] = [];
    const write = (line: string) => output.push(line);
    runCatalogCli(['template', '--output', reviewPath], write);
    assert.equal(
        JSON.parse(readFileSync(reviewPath, 'utf8')).filter(
            (item: GiftReview) => item.match === 'exact-name',
        ).length,
        8,
    );
    runCatalogCli(['validate', reviewPath], write);
    assert.equal(JSON.parse(output.at(-1)!).authorized, 0);
    writeFileSync(reviewPath, JSON.stringify([review('5576')]));
    runCatalogCli(['prepare', reviewPath, '--output', activePath], write);
    const prepared = JSON.parse(readFileSync(activePath, 'utf8'));
    assert.equal(prepared[0].ruleId, 'name:heart');
    assert.equal(Object.hasOwn(prepared[0], 'giftId'), false);
    runCatalogCli(['verify', reviewPath, activePath], write);
    assert.equal(JSON.parse(output.at(-1)!).authorized, 1);
    assert.throws(() =>
        runCatalogCli(['prepare', reviewPath, '--output', activePath], write),
    );
});

test('SQLite híbrido: overflow preserva sequência pendente e capacidade não descarta identidades', (t) => {
    const gifts = parseReviewedCatalog([
        {
            ...active('5576', 'cumulative-final')[0],
            points: Number.MAX_SAFE_INTEGER,
        },
    ]);
    const filename = join(temp(t), 'overflow.sqlite');
    const options = { filename, engine: settings(gifts) };
    const store = track(t, openSqliteScoring({ ...options, mode: 'create' }));
    try {
        const pending = occurrence(
            gifts,
            raw('Heart', '999', '9101', 1, 0, '11001', USER, true),
        );
        store.process(pending);
        const before = store.snapshot();
        assert.equal(
            store.process(
                occurrence(
                    gifts,
                    raw('Heart', '888', '9102', 2, 1, '11001', USER, true),
                ),
            ).reason,
            'SCORE_LIMIT',
        );
        assert.deepEqual(store.snapshot(), before);
        const db = track(t, new Database(filename));
        assert.equal(
            (
                db.prepare('SELECT count(*) n FROM journal').get() as {
                    n: number;
                }
            ).n,
            1,
        );
        assert.equal(
            (
                db.prepare('SELECT final FROM gift_sequences').get() as {
                    final: number;
                }
            ).final,
            0,
        );
        db.close();
        assert.equal(
            store.process(
                occurrence(
                    gifts,
                    raw('Heart', '777', '9103', 1, 1, '11001', USER, true),
                ),
            ).points,
            Number.MAX_SAFE_INTEGER,
        );
    } finally {
        store.close();
    }
    const engine = createScoringEngine({ ...settings(gifts), capacity: 2 });
    const pending = occurrence(
        gifts,
        raw('Heart', '999', '9201', 1, 0, '12001', USER, true),
    );
    engine.process(pending);
    const before = engine.checkpoint();
    assert.equal(
        engine.process(
            occurrence(
                gifts,
                raw('Heart', '999', '9202', 1, 1, '12001', USER, true),
            ),
        ).reason,
        'CAPACITY_REACHED',
    );
    assert.deepEqual(engine.checkpoint(), before);
});

test('legado: contradição de nome recebida é persistida, não pode reaparecer como voto válido e invalida combo pendente', (t) => {
    const gifts = parseReviewedCatalog([
        {
            giftId: '5655',
            name: 'Rose',
            candidate: 'lula',
            points: 2,
            delivery: 'cumulative-final',
        },
    ]);
    const filename = join(temp(t), 'legacy-conflict.sqlite'),
        options = { filename, engine: settings(gifts) };
    let store = track(t, openSqliteScoring({ ...options, mode: 'create' }));
    store.process(
        occurrence(
            gifts,
            raw('Rose', '5655', '9301', 1, 0, '13001', USER, true),
        ),
    );
    assert.equal(
        store.process(
            occurrence(
                gifts,
                raw('Other', '5655', '9302', 2, 1, '13001', USER, true),
            ),
        ).reason,
        'ID_NAME_CONFLICT',
    );
    store.close();
    store = track(t, openSqliteScoring({ ...options, mode: 'resume' }));
    try {
        assert.equal(
            store.process(
                occurrence(
                    gifts,
                    raw('Rose', '5655', '9304', 2, 1, '13001', USER, true),
                ),
            ).reason,
            'COMBO_CONFLICT',
        );
        assert.equal(
            store.process(
                occurrence(
                    gifts,
                    raw('Rose', '5655', '9302', 2, 1, '13001', USER, true),
                ),
            ).reason,
            'IDENTITY_CONFLICT',
        );
        assert.equal(
            store.process(
                occurrence(
                    gifts,
                    raw('Rose', '5655', '9303', 2, 1, '13001', USER, true),
                ),
            ).reason,
            'COMBO_CONFLICT',
        );
        assert.equal(store.snapshot().version, 0);
    } finally {
        store.close();
    }
});
