import assert from 'node:assert/strict';
import test from 'node:test';
import { createScoringEngine } from '../src/scoring/engine.ts';
import {
    createGiftCatalog,
    DEFAULT_GIFT_CATALOG,
} from '../src/scoring/catalog.ts';
import { interpretComment } from '../src/scoring/comments.ts';
import {
    eventIdentity,
    normalizeId,
    parseEvent,
} from '../src/scoring/validation.ts';
import type { EngineOptions } from '../src/scoring/engine.ts';

// Synthetic IDs: these fixtures are never a platform gift catalog.
const catalog = [
    { giftId: 'test-red', name: 'Synthetic red', candidate: 'lula', points: 5 },
    {
        giftId: 'test-blue',
        name: 'Synthetic blue',
        candidate: 'flavio',
        points: 100,
    },
];
const options: EngineOptions = {
    origin: 'fixture',
    roomId: 'room-1',
    domain: 'simulation',
    catalog,
};
const comment = (eventId = 'c1', text = 'Lula') => ({
    origin: 'fixture',
    roomId: 'room-1',
    domain: 'simulation',
    eventId,
    type: 'comment',
    text,
});
const gift = (eventId = 'g1', giftId = 'test-red') => ({
    origin: 'fixture',
    roomId: 'room-1',
    domain: 'simulation',
    eventId,
    type: 'gift',
    giftId,
    delivery: { kind: 'single', quantity: 1 },
});
const combo = (
    eventId: string,
    quantity: number,
    final: boolean,
    sequenceId = 'seq-1',
    giftId = 'test-red',
) => ({
    ...gift(eventId, giftId),
    delivery: { kind: 'combo', sequenceId, quantity, final },
});

test('estado inicial isolado, versões e snapshots imutáveis', () => {
    const engine = createScoringEngine(options);
    const initial = engine.snapshot();
    assert.deepEqual(initial.scores, { lula: 0, flavio: 0 });
    assert.equal(initial.version, 0);
    assert.notEqual(
        initial.sessionId,
        createScoringEngine(options).snapshot().sessionId,
    );
    assert.throws(() => {
        // @ts-expect-error Verify runtime immutability as well as the readonly contract.
        initial.scores.lula = 90;
    }, TypeError);
    assert.equal(engine.process(comment()).status, 'applied');
    assert.equal(engine.snapshot().version, 1);
    assert.equal(initial.scores.lula, 0);
});

for (const [text, expected] of [
    ['Lula', 'lula'],
    ['LULA! Lula Lula', 'lula'],
    ['contra Lula', 'lula'],
    ['Flávio', 'flavio'],
    ['FLAVIO!', 'flavio'],
    ['Fla\u0301vio', 'flavio'],
    ['Lula ou Flávio', null],
    ['boa noite', null],
    ['lulalandia', null],
    ['préflavio', null],
    ['lula123', null],
    ['_lula', null],
    ['💙Flávio💙', 'flavio'],
] as const) {
    test(`comentário: ${JSON.stringify(text)}`, () =>
        assert.equal(interpretComment(text), expected));
}

test('comentários independentes com texto igual pontuam; nenhum/ambos não pontuam', () => {
    const engine = createScoringEngine(options);
    assert.equal(engine.process(comment('c1')).points, 1);
    assert.equal(engine.process(comment('c2')).points, 1);
    assert.equal(engine.process(comment('c3', 'flavio')).candidate, 'flavio');
    assert.equal(
        engine.process(comment('c4', 'Lula e Flávio')).status,
        'ignored',
    );
    assert.equal(engine.process(comment('c5', 'oi')).status, 'ignored');
    assert.deepEqual(engine.snapshot().scores, { lula: 2, flavio: 1 });
    assert.equal(engine.snapshot().version, 3);
});

test('catálogo padrão vazio; valores configurados e lado único são autoridade', () => {
    assert.equal(DEFAULT_GIFT_CATALOG.length, 0);
    assert.equal(
        createScoringEngine({ ...options, catalog: undefined }).process(gift())
            .reason,
        'UNKNOWN_GIFT',
    );
    for (const points of [5, 10, 20, 50, 100]) {
        const engine = createScoringEngine({
            ...options,
            catalog: [{ ...catalog[0], points }],
        });
        assert.equal(engine.process(gift()).points, points);
        assert.deepEqual(engine.snapshot().scores, { lula: points, flavio: 0 });
    }
    const engine = createScoringEngine(options);
    assert.equal(engine.process(gift('g', 'test-blue')).candidate, 'flavio');
    assert.deepEqual(engine.snapshot().scores, { lula: 0, flavio: 100 });
});

test('configurações inválidas, ambíguas ou duplicadas são recusadas', () => {
    for (const bad of [
        null,
        {},
        [{ ...catalog[0], candidate: ['lula', 'flavio'] }],
        [{ ...catalog[0], candidate: 'both' }],
        [{ ...catalog[0], points: 7 }],
        [{ ...catalog[0], name: '' }],
        [{ ...catalog[0], giftId: Number.MAX_SAFE_INTEGER + 1 }],
        [catalog[0], catalog[0]],
        [{ ...catalog[0], side: 'flavio' }],
    ])
        assert.throws(() => createGiftCatalog(bad));
});

test('catálogo e opções são copiados; mutações posteriores não mudam autoridade', () => {
    const mutable = {
        ...options,
        catalog: catalog.map((rule) => ({ ...rule })),
    };
    const engine = createScoringEngine(mutable);
    mutable.domain = 'observation';
    mutable.catalog[0].points = 100;
    mutable.catalog[0].candidate = 'flavio';
    assert.equal(engine.process(gift()).points, 5);
    assert.equal(engine.snapshot().domain, 'simulation');
    assert.equal(engine.snapshot().scores.lula, 5);
});

test('identidade inclui origem, sala, domínio e tipo, sem colisões por concatenação', () => {
    const base = parseEvent(comment())!;
    const keys = [
        base,
        { ...base, origin: 'other' },
        { ...base, roomId: 'other' },
        { ...base, domain: 'observation' as const },
        parseEvent(gift('c1'))!,
    ].map(eventIdentity);
    assert.equal(new Set(keys).size, 5);
    assert.notEqual(
        eventIdentity({ ...base, origin: 'a:b', roomId: 'c' }),
        eventIdentity({ ...base, origin: 'a', roomId: 'b:c' }),
    );
});

test('IDs grandes são preservados; números inexatos e IDs ausentes são recusados', () => {
    assert.equal(normalizeId(900719925474099312345n), '900719925474099312345');
    assert.equal(normalizeId('900719925474099312345'), '900719925474099312345');
    assert.equal(normalizeId(Number.MAX_SAFE_INTEGER + 1), null);
    const engine = createScoringEngine(options);
    const first = engine.process({ ...comment(), eventId: 42 });
    assert.equal(first.status, 'applied');
    assert.equal(
        engine.process({ ...comment(), eventId: '42' }).status,
        'duplicate',
    );
    for (const eventId of [
        undefined,
        '',
        ' ',
        {},
        -1,
        Infinity,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
    ]) {
        assert.equal(
            engine.process({ ...comment(), eventId }).status,
            'rejected',
        );
    }
    assert.equal(engine.snapshot().scores.lula, 1);
});

test('retransmissões e conflitos de identidade não reaplicam pontuação', () => {
    const engine = createScoringEngine(options);
    assert.equal(engine.process(comment()).status, 'applied');
    assert.equal(engine.process(comment()).status, 'duplicate');
    assert.equal(
        engine.process(comment('c1', 'Flavio')).reason,
        'IDENTITY_CONFLICT',
    );
    engine.process(comment('empty', 'oi'));
    assert.equal(
        engine.process(comment('empty', 'Lula')).reason,
        'IDENTITY_CONFLICT',
    );
    engine.process(gift('unknown', 'not-configured'));
    assert.equal(engine.process(gift('unknown')).reason, 'IDENTITY_CONFLICT');
    assert.equal(engine.snapshot().scores.lula, 1);
});

test('comentário e presente distintos somam, sem inventar eventos associados', () => {
    const engine = createScoringEngine(options);
    engine.process(comment('same-id'));
    engine.process(gift('same-id'));
    assert.deepEqual(engine.snapshot().scores, { lula: 6, flavio: 0 });
    assert.equal(engine.snapshot().version, 2);
});

test('eventos malformados ou campos arbitrários não alteram parcialmente o estado', () => {
    const engine = createScoringEngine(options);
    const initial = engine.snapshot();
    for (const value of [
        null,
        [],
        {},
        { ...comment(), text: 'L'.repeat(4097) },
        { ...comment(), points: 500 },
        { ...gift(), candidate: 'flavio' },
        { ...gift(), diamondCount: 999 },
        { ...gift(), delivery: { kind: 'single', quantity: 2 } },
        {
            ...combo('g', 1, true),
            delivery: { kind: 'combo', quantity: 1, final: true },
        },
        combo('g', -1, true),
        combo('g', 1.5, true),
        combo('g', Infinity, true),
        {
            ...combo('g', 1, true),
            delivery: { kind: 'combo', sequenceId: 's', quantity: 1 },
        },
    ]) {
        assert.equal(engine.process(value).reason, 'INVALID_EVENT');
        assert.deepEqual(engine.snapshot(), initial);
    }
});

test('fonte e sala únicas por instância; observação/simulação/real isolados', () => {
    const engine = createScoringEngine(options);
    for (const change of [
        { origin: 'other' },
        { roomId: 'other' },
        { domain: 'observation' },
        { domain: 'real' },
        { domain: 'diagnostic' },
    ]) {
        assert.equal(
            engine.process({ ...comment(), ...change }).status,
            'rejected',
        );
    }
    const observer = createScoringEngine({ ...options, domain: 'observation' });
    assert.equal(
        observer.process({ ...comment(), domain: 'observation' }).reason,
        'OBSERVATION_ONLY',
    );
    assert.equal(observer.snapshot().version, 0);
    assert.throws(() =>
        createScoringEngine({
            ...options,
            domain: 'real' as EngineOptions['domain'],
        }),
    );
    assert.deepEqual(engine.snapshot().scores, { lula: 0, flavio: 0 });
});

test('combo acumulado só pontua uma vez no total final; notificações não são somadas', () => {
    const engine = createScoringEngine(options);
    assert.equal(engine.process(combo('n1', 1, false)).reason, 'COMBO_PENDING');
    assert.equal(engine.process(combo('n2', 3, false)).points, 0);
    assert.equal(engine.process(combo('n2', 3, false)).status, 'duplicate');
    assert.equal(engine.snapshot().scores.lula, 0);
    assert.equal(engine.process(combo('n3', 3, true)).points, 15);
    assert.equal(engine.process(combo('n3', 3, true)).status, 'duplicate');
    assert.equal(
        engine.process(combo('n4', 3, true)).reason,
        'COMBO_ALREADY_PROCESSED',
    );
    assert.equal(engine.snapshot().scores.lula, 15);
    assert.equal(engine.snapshot().version, 1);
});

test('sequências distintas e final isolado inequívoco podem pontuar separadamente', () => {
    const engine = createScoringEngine(options);
    assert.equal(engine.process(combo('n1', 2, true)).points, 10);
    assert.equal(engine.process(combo('n2', 4, true, 'seq-2')).points, 20);
    assert.equal(engine.snapshot().scores.lula, 30);
});

test('contagem decrescente ou presente contraditório bloqueia sequência não finalizada', () => {
    for (const contradiction of [
        combo('n2', 1, false),
        combo('n2', 2, true, 'seq-1', 'test-blue'),
        combo('n2', 2, true, 'seq-1', 'unknown'),
    ]) {
        const engine = createScoringEngine(options);
        engine.process(combo('n1', 2, false));
        assert.equal(engine.process(contradiction).reason, 'COMBO_CONFLICT');
        assert.equal(
            engine.process(combo('n3', 3, true)).reason,
            'COMBO_CONFLICT',
        );
        assert.equal(engine.snapshot().version, 0);
    }
});

test('identidade contraditória também põe em quarentena a sequência original', () => {
    const engine = createScoringEngine(options);
    engine.process(combo('n1', 2, false));
    assert.equal(
        engine.process(combo('n1', 3, false, 'different-sequence')).reason,
        'IDENTITY_CONFLICT',
    );
    assert.equal(engine.process(combo('n3', 3, true)).reason, 'COMBO_CONFLICT');
    assert.equal(engine.snapshot().scores.lula, 0);
});

test('notificações atrasadas após finalização não produzem pontos adicionais', () => {
    const engine = createScoringEngine(options);
    engine.process(combo('final', 3, true));
    assert.equal(
        engine.process(combo('late', 2, false)).reason,
        'COMBO_CONFLICT',
    );
    assert.equal(
        engine.process(combo('changed-final', 4, true)).reason,
        'COMBO_CONFLICT',
    );
    assert.equal(engine.snapshot().scores.lula, 15);
});

test('limite inclui identidades e sequências; bloqueia novos sem descartar deduplicação', () => {
    const engine = createScoringEngine({ ...options, capacity: 2 });
    engine.process(comment('first'));
    engine.process(comment('second'));
    assert.equal(engine.process(comment('third')).reason, 'CAPACITY_REACHED');
    assert.equal(engine.process(comment('first')).status, 'duplicate');
    assert.equal(
        engine.process(comment('first', 'flavio')).reason,
        'IDENTITY_CONFLICT',
    );
    assert.equal(engine.snapshot().scores.lula, 2);
    const combos = createScoringEngine({ ...options, capacity: 2 });
    combos.process(combo('n1', 1, false));
    assert.equal(
        combos.process(combo('n2', 1, true)).reason,
        'CAPACITY_REACHED',
    );
    assert.equal(combos.snapshot().scores.lula, 0);
});

test('overflow é rejeitado atomicamente sem registrar finalização parcial', () => {
    const engine = createScoringEngine(options);
    const initial = engine.snapshot();
    assert.equal(
        engine.process(combo('huge', Number.MAX_SAFE_INTEGER, true)).reason,
        'SCORE_LIMIT',
    );
    assert.deepEqual(engine.snapshot(), initial);
    assert.equal(engine.process(combo('small', 1, true)).points, 5);
});

test('falha posterior na publicação não permite reaplicar o evento já registrado', () => {
    const engine = createScoringEngine(options);
    assert.throws(() => {
        const decision = engine.process(comment());
        assert.equal(decision.status, 'applied');
        throw new Error('publisher offline');
    });
    assert.equal(engine.process(comment()).status, 'duplicate');
    assert.equal(engine.snapshot().scores.lula, 1);
});
