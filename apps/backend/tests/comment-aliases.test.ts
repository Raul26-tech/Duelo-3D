import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { interpretComment } from '../src/scoring/comments.ts';
import {
    createScoringEngine,
    type EngineOptions,
} from '../src/scoring/engine.ts';
import { openSqliteScoring } from '../src/persistence/sqlite.ts';
import {
    APPLICATION_ID,
    SCHEMA,
    SCHEMA_VERSION,
} from '../src/persistence/schema.ts';

const options: EngineOptions = {
    origin: 'offline',
    roomId: 'room',
    domain: 'simulation',
};
const comment = (eventId: string, text: string) => ({
    ...options,
    type: 'comment',
    eventId,
    text,
});

for (const [text, candidate] of [
    ['Lula', 'lula'],
    ['13', 'lula'],
    ['Flávio', 'flavio'],
    ['Flavio', 'flavio'],
    ['22', 'flavio'],
    ['Lula 13', 'lula'],
    ['Flávio 22', 'flavio'],
    ['Lula 22', null],
    ['Flávio 13', null],
    ['13 22', null],
    ['113', null],
    ['221', null],
    ['2022', null],
    ['13!', 'lula'],
    ['22!', 'flavio'],
    ['#13', 'lula'],
    ['#22', 'flavio'],
    ['LULA!!! 13', 'lula'],
    ['flAVIO!!! 22', 'flavio'],
    ['FlA\u0301ViO 22', 'flavio'],
    ['boa noite', null],
    ['lula13', null],
    ['flavio22', null],
    ['id13', null],
    ['22abc', null],
    ['_13', null],
    ['13_', null],
    ['foo_22', null],
    ['2213', null],
    ['13 13 Lula Lula', 'lula'],
    ['22 Flavio 22', 'flavio'],
] as const) {
    test(`tokens de comentário: ${JSON.stringify(text)}`, () => {
        assert.equal(interpretComment(text), candidate);
        const decision = createScoringEngine(options).process(
            comment('event', text),
        );
        assert.equal(decision.points, candidate ? 1 : 0);
        assert.deepEqual(decision.state.scores, {
            lula: candidate === 'lula' ? 1 : 0,
            flavio: candidate === 'flavio' ? 1 : 0,
        });
    });
}

test('aliases não alteram identidade, dedup ou o máximo de um ponto por comentário', () => {
    const engine = createScoringEngine(options);
    assert.equal(engine.process(comment('c1', 'Lula 13 13')).points, 1);
    assert.equal(engine.process(comment('c2', 'Lula 13 13')).points, 1);
    assert.equal(
        engine.process(comment('c1', 'Lula 13 13')).status,
        'duplicate',
    );
    assert.equal(
        engine.process(comment('c1', '22')).reason,
        'IDENTITY_CONFLICT',
    );
    assert.equal(engine.process(comment('c3', 'Flávio 22 22')).points, 1);
    assert.deepEqual(engine.snapshot().scores, { lula: 2, flavio: 1 });
    assert.equal(engine.snapshot().version, 3);
});

function database(t: TestContext) {
    const dir = mkdtempSync(join(tmpdir(), 'duelo-aliases-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return join(dir, 'score.sqlite');
}

test('SQLite v2: recupera interpretação, versão, IDs repetidos e placar sem reaplicar pontos', (t) => {
    const filename = database(t);
    let store = openSqliteScoring({
        filename,
        mode: 'create',
        engine: options,
    });
    assert.equal(store.process(comment('c1', '13')).points, 1);
    assert.equal(store.process(comment('c2', '22')).points, 1);
    assert.equal(store.process(comment('c3', 'Lula 22')).points, 0);
    const before = store.snapshot();
    store.close();
    store = openSqliteScoring({ filename, mode: 'resume', engine: options });
    try {
        assert.deepEqual(store.snapshot(), before);
        assert.equal(store.process(comment('c1', '13')).status, 'duplicate');
        assert.equal(store.process(comment('c4', '13')).points, 1);
        assert.equal(store.process(comment('c5', 'Lula 13')).points, 1);
        assert.equal(store.process(comment('c6', '13 22')).points, 0);
    } finally {
        store.close();
    }
    const sql = new Database(filename);
    assert.equal(
        (
            sql.prepare('SELECT rules_version FROM dispute').get() as {
                rules_version: string;
            }
        ).rules_version,
        'scoring-v2',
    );
    sql.close();
    assert.throws(
        () =>
            openSqliteScoring({
                filename,
                mode: 'resume',
                engine: { ...options, rulesVersion: 'scoring-v1' },
            }),
        /rules version/,
    );
});

// Captured from the unmodified ba86a41 engine, using only synthetic events.
// Fixed digests/checkpoints exercise actual pre-change serialization, not a current-code mock of v1.
const fixtures = JSON.parse(
    readFileSync(
        new URL('./fixtures/scoring-v1.json', import.meta.url),
        'utf8',
    ),
);
for (const fixture of fixtures) {
    for (const schema of fixture.options.domain === 'simulation'
        ? [1, SCHEMA_VERSION]
        : [SCHEMA_VERSION]) {
        test(`SQLite legado regras v1, schema ${schema}, ${fixture.options.domain}: preserva placar e interpretação na continuação`, (t) => {
            const filename = database(t);
            const sql = new Database(filename);
            sql.pragma('journal_mode = WAL');
            sql.pragma('foreign_keys = ON');
            sql.exec(
                schema === 1
                    ? SCHEMA.replace(", 'real'", '')
                          .replace('    source_policy TEXT,\n', '')
                          .replace('    actor_id TEXT,\n', '')
                    : SCHEMA,
            );
            sql.pragma(`application_id = ${APPLICATION_ID}`);
            sql.pragma(`user_version = ${schema}`);
            const cp = fixture.checkpoint;
            const cfg = cp.configuration;
            const state = cp.state;
            sql.transaction(() => {
                sql.prepare(
                    `INSERT INTO dispute (singleton, session_id, origin, room_id, domain, capacity, catalog_json, rules_version, version, lula, flavio, journal_count, digest)
                    VALUES (1, ?, ?, ?, ?, ?, ?, 'scoring-v1', ?, ?, ?, ?, ?)`,
                ).run(
                    state.sessionId,
                    cfg.origin,
                    cfg.roomId,
                    cfg.domain,
                    cfg.capacity,
                    JSON.stringify(cfg.catalog),
                    state.version,
                    state.scores.lula,
                    state.scores.flavio,
                    fixture.journal.length,
                    fixture.digest,
                );
                if (schema === SCHEMA_VERSION)
                    sql.prepare('UPDATE dispute SET source_policy = ?').run(
                        cfg.sourcePolicy ?? null,
                    );
                fixture.journal.forEach((event: unknown, index: number) =>
                    sql
                        .prepare('INSERT INTO journal VALUES (?, ?, ?)')
                        .run(state.sessionId, index + 1, JSON.stringify(event)),
                );
                for (const row of cp.events)
                    sql.prepare(
                        'INSERT INTO event_identities VALUES (?, ?, ?)',
                    ).run(state.sessionId, row.identity, row.fingerprint);
            })();
            sql.close();
            let store = openSqliteScoring({
                filename,
                mode: 'resume',
                engine: fixture.options,
            });
            assert.deepEqual(store.snapshot(), state);
            assert.equal(store.process(fixture.journal[0]).status, 'duplicate');
            assert.equal(
                store.process({
                    ...fixture.journal[0],
                    eventId: 'new-13',
                    text: '13',
                }).points,
                0,
            );
            assert.equal(
                store.process({
                    ...fixture.journal[0],
                    eventId: 'new-mixed',
                    text: 'Lula 22',
                }).points,
                1,
            );
            assert.equal(
                store.process({
                    ...fixture.journal[0],
                    eventId: 'new-name',
                    text: 'Flávio',
                }).points,
                1,
            );
            const continued = store.snapshot();
            store.close();
            store = openSqliteScoring({
                filename,
                mode: 'resume',
                engine: fixture.options,
            });
            assert.deepEqual(store.snapshot(), continued);
            store.close();
            assert.throws(
                () =>
                    openSqliteScoring({
                        filename,
                        mode: 'resume',
                        engine: {
                            ...fixture.options,
                            rulesVersion: 'scoring-v2',
                        },
                    }),
                /rules version/,
            );
            const persisted = new Database(filename);
            assert.equal(
                (
                    persisted
                        .prepare('SELECT rules_version FROM dispute')
                        .get() as { rules_version: string }
                ).rules_version,
                'scoring-v1',
            );
            persisted.close();
        });
    }
}

test('SQLite bloqueia versão de regras desconhecida ou alterada sem reinterpretar o journal', (t) => {
    for (const version of ['scoring-future', 'scoring-v1']) {
        const filename = database(t);
        const store = openSqliteScoring({
            filename,
            mode: 'create',
            engine: options,
        });
        store.process(comment('c1', '13'));
        store.close();
        const sql = new Database(filename);
        sql.prepare('UPDATE dispute SET rules_version = ?').run(version);
        sql.close();
        assert.throws(
            () =>
                openSqliteScoring({
                    filename,
                    mode: 'resume',
                    engine: options,
                }),
            /unsupported rules version|digest mismatch/,
        );
    }
});
