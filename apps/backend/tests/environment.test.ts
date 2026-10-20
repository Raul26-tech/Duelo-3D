import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'node:net';
import process from 'node:process';
import { syncBuiltinESMExports } from 'node:module';
import { loadOptionalEnv } from '../src/environment.ts';

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'duelo-root-env-'));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    const src = join(root, 'apps/backend/src');
    const dist = join(root, 'apps/backend/dist');
    const other = join(root, 'unrelated');
    for (const dir of [src, dist, other]) mkdirSync(dir, { recursive: true });
    for (const name of ['environment.ts', 'server.ts', 'main.ts']) {
        const source = new URL('../src/' + name, import.meta.url);
        copyFileSync(source, join(src, name));
        copyFileSync(source, join(dist, name));
    }
    return { root, src, dist, other };
}

function childEnv(values: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const key of ['FORCE_COLOR', 'PORT', 'BACKEND_PORT', 'BACKEND_HOST']) {
        delete env[key];
    }
    return {
        ...env,
        NODE_ENV: 'test',
        SIMULATION_MODE: 'false',
        ...values,
        NO_COLOR: '1',
    };
}

function probe(moduleDir: string, cwd: string, values: NodeJS.ProcessEnv = {}) {
    const environment = pathToFileURL(join(moduleDir, 'environment.ts')).href;
    const server = pathToFileURL(join(moduleDir, 'server.ts')).href;
    return spawnSync(
        process.execPath,
        [
            '--input-type=module',
            '--eval',
            `import { loadOptionalEnv } from ${JSON.stringify(environment)};
             import { getBackendConfig } from ${JSON.stringify(server)};
             loadOptionalEnv();
             console.log(JSON.stringify(getBackendConfig()));`,
        ],
        { cwd, env: childEnv(values), encoding: 'utf8', timeout: 5000 },
    );
}

test('sem .env central, src/dist usam padrões sem depender do cwd', () => {
    const dirs = fixture();
    try {
        for (const moduleDir of [dirs.src, dirs.dist]) {
            for (const cwd of [dirs.root, dirs.src, dirs.other]) {
                const result = probe(moduleDir, cwd);
                assert.equal(result.status, 0, result.stderr);
                assert.deepEqual(JSON.parse(result.stdout), {
                    port: 3000,
                    host: '127.0.0.1',
                });
            }
        }
        assert.equal(existsSync(join(dirs.root, '.env')), false);
    } finally {
        rmSync(dirs.root, { recursive: true, force: true });
    }
});

test('backend localiza .env da raiz e ignora arquivos por workspace/cwd', () => {
    const dirs = fixture();
    try {
        writeFileSync(
            join(dirs.root, '.env'),
            'FRONTEND_PORT=5200\nBACKEND_PORT=3201\nBACKEND_HOST=127.0.0.1\n',
        );
        for (const dir of [
            dirs.src,
            join(dirs.root, 'apps/backend'),
            dirs.other,
        ]) {
            writeFileSync(join(dir, '.env'), 'BACKEND_PORT=9999\n');
        }
        for (const moduleDir of [dirs.src, dirs.dist]) {
            const result = probe(moduleDir, dirs.other);
            assert.equal(result.status, 0, result.stderr);
            assert.equal(JSON.parse(result.stdout).port, 3201);
        }
        const terminal = probe(dirs.src, dirs.other, {
            BACKEND_PORT: '3202',
            BACKEND_HOST: '::1',
        });
        assert.equal(terminal.status, 0, terminal.stderr);
        assert.deepEqual(JSON.parse(terminal.stdout), {
            port: 3202,
            host: '::1',
        });
    } finally {
        rmSync(dirs.root, { recursive: true, force: true });
    }
});

test('erros diferentes de ENOENT não são ignorados pelo loader', (t) => {
    // O SO/API pode retornar ENOENT para arquivo/.env. Injete o erro
    // para verificar o contrato do loader sem depender desse detalhe.
    let failure: NodeJS.ErrnoException = new Error('falha controlada');
    const mocked = t.mock.method(process, 'loadEnvFile', () => {
        throw failure;
    });
    try {
        // O loader importa o builtin por nome; sincronize seu binding ESM.
        syncBuiltinESMExports();
        for (const code of ['EACCES', 'EIO', 'ENOTDIR']) {
            failure = Object.assign(new Error('falha controlada'), { code });
            assert.throws(
                () => loadOptionalEnv('arquivo-de-teste-nao-lido.env'),
                (error: unknown) => error === failure,
            );
        }
        failure = Object.assign(new Error('arquivo ausente'), {
            code: 'ENOENT',
        });
        assert.doesNotThrow(() =>
            loadOptionalEnv('arquivo-de-teste-nao-lido.env'),
        );
    } finally {
        mocked.mock.restore();
        syncBuiltinESMExports();
    }
});

for (const withEnv of [false, true]) {
    test(
        `node --watch responde /health com .env central ${withEnv ? 'presente' : 'ausente'}`,
        { timeout: 12000 },
        async (t) => {
            const dirs = fixture();
            const reserve = createServer();
            await new Promise<void>((resolve, reject) => {
                reserve.once('error', reject);
                reserve.listen(0, '127.0.0.1', resolve);
            });
            const address = reserve.address();
            assert.ok(address && typeof address !== 'string');
            const port = address.port;
            await new Promise<void>((resolve, reject) => {
                reserve.close((error) => (error ? reject(error) : resolve()));
            });
            if (withEnv) {
                writeFileSync(
                    join(dirs.root, '.env'),
                    `BACKEND_PORT=${port}\nBACKEND_HOST=127.0.0.1\n`,
                );
            }
            const grouped = process.platform !== 'win32';
            const child = spawn(
                process.execPath,
                ['--watch', join(dirs.src, 'main.ts')],
                {
                    cwd: dirs.other,
                    env: childEnv(
                        withEnv ? {} : { BACKEND_PORT: String(port) },
                    ),
                    stdio: ['ignore', 'pipe', 'pipe'],
                    detached: grouped,
                },
            );
            const exit = once(child, 'exit');
            void exit.catch(() => {});
            const kill = (signal: NodeJS.Signals) => {
                try {
                    if (grouped && child.pid) process.kill(-child.pid, signal);
                    else child.kill(signal);
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
                        throw error;
                    }
                }
            };
            t.after(async () => {
                kill('SIGTERM');
                const timer = setTimeout(() => kill('SIGKILL'), 1500);
                try {
                    await exit;
                } finally {
                    clearTimeout(timer);
                    rmSync(dirs.root, { recursive: true, force: true });
                }
            });
            let output = '';
            let errors = '';
            child.stderr.on('data', (data) => {
                errors += String(data);
            });
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error(`Sem início: ${output} ${errors}`)),
                    7000,
                );
                child.stdout.on('data', (data) => {
                    output += String(data);
                    if (
                        output.includes(
                            `Backend: http://127.0.0.1:${port}/health`,
                        )
                    ) {
                        clearTimeout(timer);
                        resolve();
                    }
                });
                child.once('error', (error) => {
                    clearTimeout(timer);
                    reject(error);
                });
                child.once('exit', () => {
                    clearTimeout(timer);
                    reject(new Error(`Backend encerrou: ${output} ${errors}`));
                });
            });
            const response = await fetch(`http://127.0.0.1:${port}/health`);
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), {
                status: 'ok',
                service: 'duelo-3d-backend',
            });
            assert.doesNotMatch(errors, /ENOENT/);
        },
    );
}
