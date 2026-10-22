import test from 'node:test';
import assert from 'node:assert/strict';
import {
    mkdtempSync,
    chmodSync,
    rmSync,
    existsSync,
    readFileSync,
    lstatSync,
    symlinkSync,
    linkSync,
    mkdirSync,
    readdirSync,
    openSync,
    closeSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import Database from 'better-sqlite3';
import { once } from 'node:events';
import { defer } from './helpers/resources.ts';
import { makePublicFixture } from './helpers/platform.ts';
import {
    assertLocalPath,
    assertPrivateFile,
    assertPrivateDirectory,
    protectTemporaryDirectory,
    createPrivateFile,
    isLocalAbsolutePath,
} from '../src/private-files.ts';
import { readCredential, makeCredential } from '../src/admin/credentials.ts';
import { reserveLocalJson, writeNewLocalJson } from '../src/local-json.ts';
import { resolveDatabasePath } from '../src/persistence/paths.ts';
import { readRealConfig } from '../src/integration/config.ts';
import { openSqliteScoring } from '../src/persistence/sqlite.ts';

function temporary(t: import('node:test').TestContext) {
    const path = mkdtempSync(join(tmpdir(), 'duelo Windows ç '));
    defer(t, () => rmSync(path, { recursive: true, force: true }));
    return path;
}
const credentials = makeCredential(
    'test_windows',
    'synthetic-only-long-password',
);

test('caminhos Windows: unidades e separadores nativos, sem caminhos relativos, ADS ou dispositivos', () => {
    for (const path of [
        'C:\\Duelo privado\\placar.sqlite',
        'd:/dados/placar.sqlite',
        'C:\\Usuários\\Carine\\arquivo.json',
    ])
        assert.equal(isLocalAbsolutePath(path, 'win32'), true, path);
    for (const path of [
        'C:relative.sqlite',
        '\\relative.sqlite',
        '/tmp/test.sqlite',
        'relative.sqlite',
        '\\\\server\\share\\db.sqlite',
        '\\\\?\\C:\\db.sqlite',
        'C:\\data\\db.sqlite:stream',
        'C:\\data.\\db.sqlite',
        'C:\\data\\NUL.sqlite',
        'C:\\data\\CON',
        'C:\\data\\LPT1.json',
        'C:\\data\\x?.json',
        'C:\\data\\bad\0.json',
    ])
        assert.equal(isLocalAbsolutePath(path, 'win32'), false, path);
});

test('caminhos nativos com espaços e Unicode são aceitos pelo config real, manifesto e relatório', (t) => {
    const dir = temporary(t),
        database = join(dir, 'score.sqlite'),
        report = join(dir, 'report.json');
    const base = {
        DUEL_MODE: 'real',
        TIKTOK_REAL_ENABLED: 'true',
        TIKTOK_IDENTITY_REVIEWED: 'true',
        TIKTOK_USERNAME: 'synthetic_only',
        TIKTOK_ROOM_ID: '9000000000000000001',
        TIKTOK_SESSION_ACTION: 'create',
        TIKTOK_DATABASE: database,
        TIKTOK_RUNTIME_REPORT: report,
    };
    const config = readRealConfig(base);
    assert.equal(config.filename, database);
    assert.equal(config.runtimeReport!.filename, report);
    assert.equal(config.runtimeReport!.durationMs, 35 * 60000);
    assert.deepEqual(config.gifts, []);
    // Reaching JSON validation proves this native absolute path passed the path guard.
    const manifest = join(dir, 'manifest.json');
    writeNewLocalJson(manifest, {});
    assert.throws(
        () =>
            readRealConfig({
                ...base,
                TIKTOK_EXPERIMENTAL_ENABLED: 'true',
                TIKTOK_EXPERIMENT_MANIFEST: manifest,
            }),
        /manifest|experiment|plan/iu,
    );
    assert.equal(existsSync(database), false);
});

test('reservas JSON fecham descritor antes de cancelar e nunca sobrescrevem arquivo', (t) => {
    const filename = join(temporary(t), 'reserved.json');
    const output = reserveLocalJson(filename);
    assertPrivateFile(filename);
    assert.throws(() => reserveLocalJson(filename));
    output.cancel();
    output.cancel();
    assert.equal(existsSync(filename), false);
    writeNewLocalJson(filename, { safe: true });
    assertPrivateFile(filename);
    assert.deepEqual(JSON.parse(readFileSync(filename, 'utf8')), {
        safe: true,
    });
    assert.throws(() => writeNewLocalJson(filename, {}));
});

test('credencial privada: ACL nativa no Windows, 0600 no Unix, leitura e rejeição de acesso público', (t) => {
    const filename = join(temporary(t), 'credential.json');
    writeNewLocalJson(filename, credentials);
    assertPrivateFile(filename);
    assert.deepEqual(readCredential(filename), credentials);
    makePublicFixture(filename);
    assert.throws(() => readCredential(filename));
});

test('credenciais: aliases por hard link e diretório junction/symlink não concedem acesso', (t) => {
    const dir = temporary(t),
        child = join(dir, 'private');
    mkdirSync(child);
    const filename = join(child, 'credential.json');
    writeNewLocalJson(filename, credentials);
    const alias = join(dir, 'alias.json');
    linkSync(filename, alias);
    assert.throws(() => readCredential(alias), /regular/);
    rmSync(alias);
    assert.deepEqual(readCredential(filename), credentials);
    const junction = join(dir, 'junction');
    symlinkSync(
        child,
        junction,
        process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.throws(
        () => readCredential(join(junction, 'credential.json')),
        /Symlink|reparse/,
    );
    assert.throws(
        () => assertLocalPath(junction + sep + '..' + sep + 'other.json'),
        /Symlink|reparse|absolute/,
    );
    assert.throws(
        () => resolveDatabasePath(join(junction, 'score.sqlite'), true),
        /Symlink|reparse/,
    );
});

test('caminho de banco é externo, sem desvio por junction e sem sobrescrever fonte/build', (t) => {
    const dir = temporary(t);
    assert.equal(
        resolveDatabasePath(join(dir, 'new', 'score.sqlite'), true),
        join(dir, 'new', 'score.sqlite'),
    );
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    assert.throws(
        () => resolveDatabasePath(join(repo, 'forbidden.sqlite'), true),
        /outside/,
    );
    const alias = join(dir, 'source');
    symlinkSync(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(
        () => resolveDatabasePath(join(alias, 'forbidden.sqlite'), true),
        /Symlink|reparse|outside/,
    );
    assert.equal(existsSync(join(repo, 'forbidden.sqlite')), false);
});

test('recursos temporários: servidor e SQLite encerram antes de remover diretório, em LIFO', async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'duelo-lifetime-'));
    const order: string[] = [];
    await t.test('fixture', async (child) => {
        defer(child, () => {
            order.push('remove');
            rmSync(directory, { recursive: true });
        });
        const store = openSqliteScoring({
            filename: join(directory, 'score.sqlite'),
            mode: 'create',
            engine: {
                origin: 'offline',
                roomId: 'test',
                domain: 'simulation',
                catalog: [],
            },
        });
        defer(child, () => {
            order.push('sqlite');
            store.close();
        });
        const server = createServer();
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        defer(
            child,
            () =>
                new Promise<void>((resolve, reject) =>
                    server.close((error) => {
                        order.push('server');
                        if (error) reject(error);
                        else resolve();
                    }),
                ),
        );
    });
    assert.deepEqual(order, ['server', 'sqlite', 'remove']);
    assert.equal(existsSync(directory), false);
});

test('SQLite: rollback, dedup/replay e remoção de WAL/SHM após a última conexão', (t) => {
    const dir = temporary(t),
        filename = join(dir, 'score.sqlite');
    const options = {
        filename,
        engine: {
            origin: 'offline',
            roomId: 'test',
            domain: 'simulation' as const,
            catalog: [],
        },
    };
    const event = {
        origin: 'offline',
        roomId: 'test',
        domain: 'simulation',
        type: 'comment',
        eventId: 'one',
        text: '13',
    };
    let store = openSqliteScoring({ ...options, mode: 'create' });
    defer(t, () => store.close());
    assert.equal(store.process(event).points, 1);
    const expected = store.snapshot();
    const sql = new Database(filename);
    try {
        sql.exec(
            "CREATE TRIGGER fail_commit BEFORE UPDATE ON dispute BEGIN SELECT RAISE(ABORT, 'controlled rollback'); END",
        );
        assert.throws(
            () => store.process({ ...event, eventId: 'two' }),
            /controlled rollback/,
        );
        assert.deepEqual(store.snapshot(), expected);
        sql.exec('DROP TRIGGER fail_commit');
    } finally {
        sql.close();
    }
    store.close();
    store = openSqliteScoring({ ...options, mode: 'resume' });
    assert.deepEqual(store.snapshot(), expected);
    assert.equal(store.process(event).status, 'duplicate');
    assert.throws(() => openSqliteScoring({ ...options, mode: 'create' }));
    assert.deepEqual(store.snapshot(), expected);
    store.close();
    for (const name of readdirSync(dir)) rmSync(join(dir, name));
    assert.deepEqual(readdirSync(dir), []);
});

test('Windows: ACL insegura herdada é recusada mesmo com chmod 0600; Unix mantém a regra POSIX', (t) => {
    const dir = temporary(t),
        file = join(dir, 'file.json');
    writeNewLocalJson(file, credentials);
    if (process.platform === 'win32') {
        execFileSync(
            join(
                process.env.SystemRoot ?? 'C:\\Windows',
                'System32',
                'icacls.exe',
            ),
            [file, '/inheritance:e'],
            { stdio: 'ignore', windowsHide: true },
        );
        chmodSync(file, 0o600); // Emulated mode is not an ACL proof.
        assert.throws(() => assertPrivateFile(file));
    } else {
        assert.equal(lstatSync(file).mode & 0o777, 0o600);
        assertPrivateFile(file);
    }
});

test('arquivos privados: CreateNew falha para alvo existente e não revela conteúdo', (t) => {
    const file = join(temporary(t), 'private.json');
    const fd = createPrivateFile(file);
    writeFileSync(fd, '{}');
    closeSync(fd);
    assertPrivateFile(file);
    assert.throws(() => createPrivateFile(file));
    assert.equal(readFileSync(file, 'utf8'), '{}');
});

test('credencial malformada ou excessiva não vaza conteúdo e libera o arquivo', (t) => {
    const dir = temporary(t),
        malformed = join(dir, 'malformed.json'),
        large = join(dir, 'large.json');
    const fd = createPrivateFile(malformed);
    writeFileSync(fd, 'PRIVATE_SYNTHETIC_VALUE');
    closeSync(fd);
    assert.throws(
        () => readCredential(malformed),
        (error) => {
            assert.ok(error instanceof Error);
            assert.doesNotMatch(error.message, /PRIVATE_SYNTHETIC_VALUE/);
            return true;
        },
    );
    writeNewLocalJson(large, { data: 'x'.repeat(5000) });
    assert.throws(() => readCredential(large));
    rmSync(malformed);
    rmSync(large);
});

test('teardown propaga falhas e ainda encerra os recursos restantes', () => {
    const helpers = new URL('./helpers/resources.ts', import.meta.url).href;
    const code = `import test from 'node:test';
        import { defer } from ${JSON.stringify(helpers)};
        test('controlled cleanup failure', t => {
            defer(t, () => console.log('REMAINING_RESOURCE_CLOSED'));
            defer(t, () => { throw new Error('CONTROLLED_CLOSE_FAILURE'); });
        });`;
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
    delete env.FORCE_COLOR;
    const result = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', code],
        { encoding: 'utf8', env, timeout: 15000 },
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /Resource teardown failed/);
    assert.match(result.stdout + result.stderr, /REMAINING_RESOURCE_CLOSED/);
});

test('diretório de homologação: verifica ACL/0700 sem alterar permissões e recusa acesso público', (t) => {
    const dir = temporary(t),
        privateDir = join(dir, 'private');
    mkdirSync(privateDir);
    protectTemporaryDirectory(privateDir);
    assertPrivateDirectory(privateDir);
    if (process.platform === 'win32') makePublicFixture(privateDir);
    else chmodSync(privateDir, 0o755);
    assert.throws(() => assertPrivateDirectory(privateDir));
    // Credential policy is still strict: directory verification never grants file access.
    assert.throws(() => assertPrivateFile(privateDir), /regular/);
});
