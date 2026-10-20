import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'node:net';

const environmentUrl = new URL('../src/environment.ts', import.meta.url).href;
const serverUrl = new URL('../src/server.ts', import.meta.url).href;

function probe(dir: string, port?: string, path = '.env') {
    const env = { ...process.env };
    delete env.PORT;
    if (port !== undefined) env.PORT = port;
    return spawnSync(process.execPath, [
        '--input-type=module',
        '--eval',
        `import { loadOptionalEnv } from ${JSON.stringify(environmentUrl)};
         import { resolvePort } from ${JSON.stringify(serverUrl)};
         loadOptionalEnv(${JSON.stringify(path)});
         console.log(resolvePort(process.env.PORT));`,
    ], { cwd: dir, env, encoding: 'utf8', timeout: 5000 });
}

test('backend sem .env mantém porta padrão e não cria arquivo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'duelo-env-'));
    try {
        const result = probe(dir);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), '3000');
        assert.equal(existsSync(join(dir, '.env')), false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('backend carrega .env opcional sem sobrescrever PORT do terminal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'duelo-env-'));
    try {
        writeFileSync(join(dir, '.env'), 'PORT=3201\n');
        const fromFile = probe(dir);
        assert.equal(fromFile.status, 0, fromFile.stderr);
        assert.equal(fromFile.stdout.trim(), '3201');
        const fromTerminal = probe(dir, '3202');
        assert.equal(fromTerminal.status, 0, fromTerminal.stderr);
        assert.equal(fromTerminal.stdout.trim(), '3202');
        writeFileSync(join(dir, 'not-a-directory'), 'arquivo');
        const invalidPath = probe(dir, undefined, 'not-a-directory/.env');
        assert.notEqual(invalidPath.status, 0);
        assert.match(invalidPath.stderr, /ENOTDIR/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('node --watch inicia backend e /health sem .env', { timeout: 12000 }, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'duelo-watch-'));
    const reserve = createServer();
    await new Promise<void>((resolve, reject) => {
        reserve.once('error', reject);
        reserve.listen(0, '127.0.0.1', resolve);
    });
    const address = reserve.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    await new Promise<void>((resolve, reject) => {
        reserve.close((error) => error ? reject(error) : resolve());
    });
    const grouped = process.platform !== 'win32';
    const child = spawn(process.execPath, [
        '--watch', fileURLToPath(new URL('../src/main.ts', import.meta.url)),
    ], {
        cwd: dir,
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: grouped,
    });
    const exit = once(child, 'exit');
    void exit.catch(() => {});
    const kill = (signal: NodeJS.Signals) => {
        try {
            if (grouped && child.pid) process.kill(-child.pid, signal);
            else child.kill(signal);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
    };
    t.after(async () => {
        kill('SIGTERM');
        const timer = setTimeout(() => kill('SIGKILL'), 1500);
        try { await exit; } finally {
            clearTimeout(timer);
            rmSync(dir, { recursive: true, force: true });
        }
    });
    let output = '';
    let errors = '';
    child.stderr.on('data', (data) => { errors += String(data); });
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Backend não iniciou: ${output} ${errors}`)),
            7000,
        );
        child.stdout.on('data', (data) => {
            output += String(data);
            if (output.includes(`Backend: http://127.0.0.1:${port}/health`)) {
                clearTimeout(timer);
                resolve();
            }
        });
        child.once('error', (error) => { clearTimeout(timer); reject(error); });
        child.once('exit', () => {
            clearTimeout(timer);
            reject(new Error(`Backend encerrou: ${output} ${errors}`));
        });
    });
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        status: 'ok', service: 'duelo-3d-backend',
    });
    assert.doesNotMatch(errors, /ENOENT/);
});
