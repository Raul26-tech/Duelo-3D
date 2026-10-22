import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openSqliteScoring } from '../src/persistence/sqlite.ts';
import { ScoringIntegrityError } from '../src/persistence/port.ts';
import { defaultScoringDatabasePath } from '../src/persistence/paths.ts';
import { parseEvent } from '../src/scoring/validation.ts';
import {
    createScoringEngine,
    type EngineOptions,
} from '../src/scoring/engine.ts';

const catalog = [
    {
        giftId: 'red-fixture',
        name: 'Synthetic red',
        candidate: 'lula',
        points: 7,
    },
    {
        giftId: 'blue-fixture',
        name: 'Synthetic blue',
        candidate: 'flavio',
        points: 25,
    },
];
const settings: EngineOptions = {
    origin: 'offline',
    roomId: 'room',
    domain: 'simulation',
    catalog,
};
const comment = (eventId = 'c1', text = 'Lula') => ({
    origin: 'offline',
    roomId: 'room',
    domain: 'simulation',
    type: 'comment',
    eventId,
    text,
});
const gift = (eventId = 'g1', giftId = 'red-fixture') => ({
    origin: 'offline',
    roomId: 'room',
    domain: 'simulation',
    type: 'gift',
    eventId,
    giftId,
    delivery: { kind: 'single', quantity: 1 },
});
const combo = (
    eventId: string,
    quantity: number,
    final: boolean,
    sequenceId = 's1',
) => ({
    ...gift(eventId),
    delivery: { kind: 'combo', sequenceId, quantity, final },
});

function fixture(t: TestContext, engine: EngineOptions = settings) {
    const dir = mkdtempSync(join(tmpdir(), 'duelo-persistence-'));
    const filename = join(dir, 'scoring.sqlite');
    const handles: ReturnType<typeof openSqliteScoring>[] = [];
    t.after(() => {
        for (const handle of handles) handle.close();
        rmSync(dir, { recursive: true, force: true });
    });
    const open = (mode: 'create' | 'resume', config = engine) => {
        const handle = openSqliteScoring({ filename, mode, engine: config });
        handles.push(handle);
        return handle;
    };
    const sql = <T>(work: (db: Database.Database) => T): T => {
        const db = new Database(filename, { fileMustExist: true });
        try {
            db.pragma('foreign_keys = ON');
            return work(db);
        } finally {
            db.close();
        }
    };
    const dump = () =>
        sql((db) =>
            JSON.stringify(
                [
                    'dispute',
                    'journal',
                    'event_identities',
                    'gift_sequences',
                ].map((table) =>
                    db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
                ),
            ),
        );
    return { filename, open, sql, dump };
}

test('SQLite persiste comentários, presentes, sessão, placar e versão após reinício', (t) => {
    const f = fixture(t);
    const first = f.open('create');
    first.process(comment());
    first.process(gift());
    first.process(gift('blue', 'blue-fixture'));
    const expected = first.snapshot();
    assert.deepEqual(expected.scores, { lula: 8, flavio: 25 });
    assert.equal(expected.version, 3);
    first.close();
    const resumed = f.open('resume');
    assert.deepEqual(resumed.snapshot(), expected);
    assert.equal(resumed.process(comment()).status, 'duplicate');
    assert.equal(resumed.process(gift()).status, 'duplicate');
    assert.deepEqual(resumed.snapshot(), expected);
    f.sql((db) => {
        assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
        assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
        assert.deepEqual(db.pragma('foreign_key_check'), []);
        assert.equal(
            (
                db
                    .prepare('SELECT COUNT(*) AS n FROM event_identities')
                    .get() as { n: number }
            ).n,
            3,
        );
    });
});

test('recupera combo pendente e pontua somente uma finalização, mesmo após novos reinícios', (t) => {
    const f = fixture(t);
    let engine = f.open('create');
    engine.process(combo('n1', 1, false));
    engine.process(combo('n3', 3, false));
    const pending = engine.snapshot();
    assert.equal(pending.version, 0);
    f.sql((db) =>
        assert.deepEqual(
            db
                .prepare('SELECT quantity, final, invalid FROM gift_sequences')
                .get(),
            { quantity: 3, final: 0, invalid: 0 },
        ),
    );
    engine.close();
    engine = f.open('resume');
    assert.deepEqual(engine.snapshot(), pending);
    assert.equal(engine.process(combo('final', 3, true)).points, 21);
    const finished = engine.snapshot();
    engine.close();
    engine = f.open('resume');
    assert.equal(engine.process(combo('final', 3, true)).status, 'duplicate');
    assert.equal(
        engine.process(combo('other-final-id', 3, true)).reason,
        'COMBO_ALREADY_PROCESSED',
    );
    assert.deepEqual(engine.snapshot(), finished);
});

test('fingerprints e identidades contraditórias são preservados após reinício', (t) => {
    const f = fixture(t);
    const engine = f.open('create');
    engine.process(comment());
    engine.close();
    const resumed = f.open('resume');
    assert.equal(
        resumed.process(comment('c1', 'Flavio')).reason,
        'IDENTITY_CONFLICT',
    );
    assert.deepEqual(resumed.snapshot().scores, { lula: 1, flavio: 0 });
    assert.equal(resumed.process(comment('c2', 'Lula')).points, 1);
});

test('quarentena de combo é persistida mesmo quando uma rejeição não altera pontos/versão', (t) => {
    const f = fixture(t);
    const engine = f.open('create');
    engine.process(combo('n1', 2, false));
    assert.equal(
        engine.process(combo('n1', 3, false)).reason,
        'IDENTITY_CONFLICT',
    );
    engine.close();
    const resumed = f.open('resume');
    assert.equal(
        resumed.process(combo('final', 3, true)).reason,
        'COMBO_CONFLICT',
    );
    assert.equal(resumed.snapshot().version, 0);
    f.sql((db) =>
        assert.equal(
            (
                db.prepare('SELECT invalid FROM gift_sequences').get() as {
                    invalid: number;
                }
            ).invalid,
            1,
        ),
    );
});

test('eventos sem voto, desconhecidos e IDs grandes continuam protegidos por deduplicação', (t) => {
    const f = fixture(t);
    const engine = f.open('create');
    engine.process(comment('empty', 'oi'));
    engine.process(gift('unknown', 'unknown'));
    engine.process({ ...comment(), eventId: 900719925474099312345n });
    engine.close();
    const resumed = f.open('resume');
    assert.equal(
        resumed.process(comment('empty', 'Lula')).reason,
        'IDENTITY_CONFLICT',
    );
    assert.equal(resumed.process(gift('unknown')).reason, 'IDENTITY_CONFLICT');
    assert.equal(
        resumed.process({ ...comment(), eventId: '900719925474099312345' })
            .status,
        'duplicate',
    );
});

for (const commitFailure of [false, true]) {
    test(`rollback integral ${commitFailure ? 'no COMMIT por FK diferida' : 'durante gravação da projeção'}`, (t) => {
        const f = fixture(t);
        const engine = f.open('create');
        engine.process(combo('pending', 1, false));
        const before = engine.snapshot();
        const dump = f.dump();
        f.sql((db) =>
            db.exec(
                commitFailure
                    ? `
            CREATE TRIGGER injected_failure AFTER UPDATE ON dispute BEGIN
                INSERT INTO event_identities VALUES ('nonexistent-session', 'orphan', 'invalid');
            END;`
                    : `
            CREATE TRIGGER injected_failure BEFORE UPDATE ON dispute BEGIN
                SELECT RAISE(ABORT, 'injected write failure');
            END;`,
            ),
        );
        assert.throws(() => engine.process(combo('final', 3, true)));
        assert.equal(
            f.dump(),
            dump,
            'journal, identities, sequences and scores all roll back',
        );
        f.sql((db) => db.exec('DROP TRIGGER injected_failure'));
        assert.deepEqual(
            engine.snapshot(),
            before,
            'no uncommitted in-memory score survives',
        );
        assert.equal(engine.process(combo('final', 3, true)).points, 21);
        engine.close();
        assert.equal(
            f.open('resume').process(combo('final', 3, true)).status,
            'duplicate',
        );
    });
}

test('overflow por multiplicação e por total não deixa alterações parciais', (t) => {
    const f = fixture(t, {
        ...settings,
        catalog: [{ ...catalog[0], points: Number.MAX_SAFE_INTEGER }],
    });
    const engine = f.open('create');
    const before = f.dump();
    assert.equal(
        engine.process(combo('overflow', 2, true)).reason,
        'SCORE_LIMIT',
    );
    assert.equal(f.dump(), before);
    assert.equal(engine.process(gift('max')).points, Number.MAX_SAFE_INTEGER);
    const full = f.dump();
    assert.equal(engine.process(comment('next')).reason, 'SCORE_LIMIT');
    assert.equal(
        engine.process(comment('blue', 'Flavio')).reason,
        'SCORE_LIMIT',
    );
    assert.equal(f.dump(), full);
    engine.close();
    assert.equal(
        f.open('resume').snapshot().scores.lula,
        Number.MAX_SAFE_INTEGER,
    );
});

test('saturação não apaga identidades e permanece válida após reinício', (t) => {
    const f = fixture(t, { ...settings, capacity: 2 });
    const engine = f.open('create');
    engine.process(comment('first'));
    engine.process(comment('second'));
    engine.close();
    const resumed = f.open('resume');
    const before = f.dump();
    assert.equal(resumed.process(comment('third')).reason, 'CAPACITY_REACHED');
    assert.equal(resumed.process(comment('first')).status, 'duplicate');
    assert.equal(f.dump(), before);
});

test('publicação que falha após commit não autoriza reprocessamento após reinício', (t) => {
    const f = fixture(t);
    const engine = f.open('create');
    assert.throws(() => {
        assert.equal(engine.process(comment()).status, 'applied');
        throw new Error('publication failed');
    });
    engine.close();
    const resumed = f.open('resume');
    assert.equal(resumed.process(comment()).status, 'duplicate');
    assert.equal(resumed.snapshot().scores.lula, 1);
});

test('conexões coordenadas recarregam estado dentro da transação, sem cache divergente', (t) => {
    const f = fixture(t);
    const a = f.open('create');
    const b = f.open('resume');
    a.process(comment('a'));
    b.process(comment('b'));
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.equal(a.snapshot().scores.lula, 2);
    assert.equal(b.process(comment('a')).status, 'duplicate');
});

test('processos simultâneos usam escritor SQLite serializado e deduplicam a mesma ocorrência', async (t) => {
    const f = fixture(t);
    const engine = f.open('create');
    const moduleUrl = new URL('../src/persistence/sqlite.ts', import.meta.url)
        .href;
    const run = (worker: number) =>
        new Promise<void>((resolve, reject) => {
            const code = `import { openSqliteScoring } from ${JSON.stringify(moduleUrl)};
            const e = openSqliteScoring(${JSON.stringify({ filename: f.filename, mode: 'resume', engine: settings })});
            try {
                e.process(${JSON.stringify(comment('shared'))});
                for (let i = 0; i < 8; i++) e.process({...${JSON.stringify(comment())}, eventId: 'worker-${worker}-' + i});
            } finally { e.close(); }`;
            const child = spawn(
                process.execPath,
                ['--input-type=module', '-e', code],
                { stdio: ['ignore', 'ignore', 'pipe'] },
            );
            let stderr = '';
            child.stderr.on('data', (data) => {
                stderr += data;
            });
            child.on('error', reject);
            child.on('exit', (exit) =>
                exit === 0 ? resolve() : reject(new Error(stderr)),
            );
        });
    await Promise.all([run(1), run(2), run(3)]);
    assert.equal(engine.snapshot().scores.lula, 25);
    assert.equal(engine.snapshot().version, 25);
});

for (const sql of [
    'UPDATE dispute SET lula = lula + 1',
    'UPDATE dispute SET version = version + 1',
    "UPDATE event_identities SET fingerprint = 'changed'",
    'DELETE FROM event_identities',
    'DELETE FROM journal',
    'UPDATE gift_sequences SET quantity = 9',
    "UPDATE dispute SET origin = 'other'",
    "UPDATE dispute SET catalog_json = '[]'",
    "UPDATE dispute SET rules_version = 'future-rules'",
    'PRAGMA user_version = 999',
    'DELETE FROM dispute',
]) {
    test(`bloqueia retomada com dados inconsistentes: ${sql}`, (t) => {
        const f = fixture(t);
        const engine = f.open('create');
        engine.process(comment());
        engine.process(combo('pending', 2, false));
        engine.close();
        f.sql((db) => {
            db.pragma('foreign_keys = OFF');
            db.exec(sql);
        });
        assert.throws(() => f.open('resume'), ScoringIntegrityError);
        assert.throws(() => f.open('create'), /EEXIST/);
    });
}

test('replay detecta contradição lógica mesmo se o digest das projeções foi recalculado', (t) => {
    const f = fixture(t);
    const engine = f.open('create');
    engine.process(comment());
    const sessionId = engine.snapshot().sessionId;
    engine.close();
    const checkpoint = createScoringEngine(settings, sessionId).checkpoint();
    // A forged zero score with an authentic journal cannot pass deterministic replay.
    const forged = {
        ...checkpoint,
        events: [
            {
                identity: JSON.stringify([
                    'offline',
                    'room',
                    'simulation',
                    'comment',
                    'c1',
                ]),
                fingerprint: JSON.stringify(['comment', 'Lula']),
            },
        ],
    };
    const journal = [parseEvent(comment())!];
    const digest = createHash('sha256')
        .update(
            JSON.stringify({
                rules: checkpoint.configuration.rulesVersion,
                checkpoint: forged,
                journal,
            }),
        )
        .digest('hex');
    f.sql((db) =>
        db
            .prepare('UPDATE dispute SET lula = 0, version = 0, digest = ?')
            .run(digest),
    );
    assert.throws(() => f.open('resume'), /replay does not match/);
});

test('não cria placar zerado em retomada ausente, vazia ou fisicamente corrompida', (t) => {
    const f = fixture(t);
    assert.throws(() => f.open('resume'));
    assert.equal(existsSync(f.filename), false);
    writeFileSync(f.filename, '');
    assert.throws(() => f.open('resume'), ScoringIntegrityError);
    writeFileSync(f.filename, 'not a SQLite database');
    assert.throws(() => f.open('resume'));
});

test('configuração, catálogo, capacidade e domínio não podem mudar silenciosamente ao recuperar', (t) => {
    const f = fixture(t);
    f.open('create').close();
    for (const config of [
        { ...settings, origin: 'other' },
        { ...settings, roomId: 'other' },
        { ...settings, domain: 'observation' as const },
        { ...settings, capacity: 9 },
        { ...settings, catalog: [{ ...catalog[0], points: 200 }] },
    ])
        assert.throws(() => f.open('resume', config), ScoringIntegrityError);
    // Entry order is not a change in the authorized catalog.
    assert.equal(
        f
            .open('resume', { ...settings, catalog: [...catalog].reverse() })
            .snapshot().version,
        0,
    );
});

test('simulação e observação são isoladas; domínio real não é habilitado', (t) => {
    const f = fixture(t);
    const simulation = f.open('create');
    assert.equal(
        simulation.process({ ...comment(), domain: 'observation' }).status,
        'rejected',
    );
    assert.equal(
        simulation.process({ ...comment(), domain: 'real' }).status,
        'rejected',
    );
    const obs = fixture(t, { ...settings, domain: 'observation' });
    let observer = obs.open('create');
    assert.equal(
        observer.process({ ...gift(), domain: 'observation' }).reason,
        'OBSERVATION_ONLY',
    );
    const before = observer.snapshot();
    observer.close();
    observer = obs.open('resume');
    assert.deepEqual(observer.snapshot(), before);
    assert.equal(before.version, 0);
    assert.equal(simulation.snapshot().scores.lula, 0);
    assert.throws(() =>
        obs.open('resume', {
            ...settings,
            domain: 'real' as EngineOptions['domain'],
        }),
    );
});

test('falha de integridade durante execução bloqueia a instância, sem usar memória antiga', (t) => {
    const f = fixture(t);
    const engine = f.open('create');
    engine.process(comment());
    f.sql((db) => db.exec('UPDATE dispute SET lula = 2'));
    assert.throws(() => engine.snapshot(), ScoringIntegrityError);
    assert.throws(() => engine.process(comment('new')), /blocked/);
});

test('morte de processo durante transação não comitada não altera estado recuperado', (t) => {
    const f = fixture(t);
    const engine = f.open('create');
    engine.process(comment());
    const expected = engine.snapshot();
    engine.close();
    const code = `const Database = require(${JSON.stringify(createRequire(import.meta.url).resolve('better-sqlite3'))});
        const db = new Database(${JSON.stringify(f.filename)});
        db.exec('BEGIN IMMEDIATE; UPDATE dispute SET lula = 999');
        process.stdout.write('TRANSACTION_OPEN', () => process.kill(process.pid, 'SIGKILL'));`;
    const child = spawnSync(process.execPath, ['-e', code]);
    assert.equal(child.stdout.toString(), 'TRANSACTION_OPEN');
    if (process.platform === 'win32') assert.notEqual(child.status, 0);
    else assert.equal(child.signal, 'SIGKILL');
    assert.deepEqual(f.open('resume').snapshot(), expected);
});

test('caminho padrão é externo ao repositório e caminhos de build/fonte são recusados', (t) => {
    const f = fixture(t);
    assert.ok(
        defaultScoringDatabasePath().endsWith(
            join('duelo-3d', 'scoring.sqlite'),
        ),
    );
    assert.throws(
        () =>
            openSqliteScoring({
                filename: 'local.sqlite',
                mode: 'create',
                engine: settings,
            }),
        /absolute/,
    );
    const inside = fileURLToPath(
        new URL('../dist/forbidden.sqlite', import.meta.url),
    );
    assert.throws(
        () =>
            openSqliteScoring({
                filename: inside,
                mode: 'create',
                engine: settings,
            }),
        /outside/,
    );
    assert.equal(existsSync(inside), false);
    assert.equal(f.open('create').snapshot().version, 0);
});

test('remoção do arquivo de uma conexão ativa bloqueia novas operações', (t) => {
    const f = fixture(t);
    const engine = f.open('create');
    engine.process(comment());
    const before = engine.snapshot();
    try {
        rmSync(f.filename);
    } catch (error) {
        // Windows can deny unlink while SQLite owns the handle. That is protection,
        // not a failed corruption test: prove identity/state remain usable and intact.
        assert.equal(process.platform, 'win32');
        assert.ok(
            ['EPERM', 'EACCES', 'EBUSY'].includes(
                (error as NodeJS.ErrnoException).code!,
            ),
        );
        assert.deepEqual(engine.snapshot(), before);
        assert.equal(engine.process(comment()).status, 'duplicate');
        engine.close();
        rmSync(f.filename); // Must be removable once every connection is closed.
        assert.throws(() => f.open('resume'));
        return;
    }
    assert.throws(() => engine.process(comment('new')), /removed or replaced/);
    assert.throws(() => engine.snapshot(), /blocked/);
});

test('recuperação preserva IDs Unicode e ordenação canônica independente de SQL', (t) => {
    const f = fixture(t);
    const engine = f.open('create');
    engine.process(comment('\uffff'));
    engine.process(comment('😀'));
    const expected = engine.snapshot();
    engine.close();
    const resumed = f.open('resume');
    assert.deepEqual(resumed.snapshot(), expected);
    assert.equal(resumed.process(comment('😀')).status, 'duplicate');
});

test('motor e histórico recebem a mesma cópia normalizada da entrada', (t) => {
    const f = fixture(t);
    const engine = f.open('create');
    let reads = 0;
    const input = {
        ...comment(),
        get eventId() {
            reads += 1;
            return reads === 1 ? 'original' : 'changed';
        },
    };
    assert.equal(engine.process(input).status, 'applied');
    assert.equal(reads, 1);
    engine.close();
    const resumed = f.open('resume');
    assert.equal(resumed.process(comment('original')).status, 'duplicate');
    assert.equal(resumed.snapshot().scores.lula, 1);
});
