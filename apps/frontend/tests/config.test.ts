import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { createServer as createViteServer } from 'vite';
import { createFrontendConfig, resolveFrontendPort } from '../vite.config.ts';

test('FRONTEND_PORT tem padrão 5173 e aceita somente inteiros de 1 a 65535', () => {
    assert.equal(resolveFrontendPort(undefined), 5173);
    for (const value of ['1', '5175', '65535']) {
        assert.equal(resolveFrontendPort(value), Number(value));
    }
    for (const value of ['', ' ', '0', '-1', '1.5', '1e3', '65536', 'abc']) {
        assert.throws(() => resolveFrontendPort(value), /FRONTEND_PORT/);
    }
});

test('configuração sem .env preserva base, loopback, strictPort e porta padrão', () => {
    const dir = mkdtempSync(join(tmpdir(), 'duelo-vite-'));
    const original = process.env.FRONTEND_PORT;
    try {
        delete process.env.FRONTEND_PORT;
        const config = createFrontendConfig('development', dir);
        assert.equal(config.base, './');
        assert.deepEqual(config.server, {
            host: '127.0.0.1',
            strictPort: true,
            port: 5173,
        });
    } finally {
        if (original === undefined) delete process.env.FRONTEND_PORT;
        else process.env.FRONTEND_PORT = original;
        rmSync(dir, { recursive: true, force: true });
    }
});

test('loadEnv respeita arquivos por modo e prioridade do terminal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'duelo-vite-'));
    const original = process.env.FRONTEND_PORT;
    try {
        delete process.env.FRONTEND_PORT;
        writeFileSync(join(dir, '.env'), 'FRONTEND_PORT=5201\n');
        assert.equal(createFrontendConfig('development', dir).server?.port, 5201);
        writeFileSync(join(dir, '.env.development'), 'FRONTEND_PORT=5202\n');
        assert.equal(createFrontendConfig('development', dir).server?.port, 5202);
        process.env.FRONTEND_PORT = '5203';
        assert.equal(createFrontendConfig('development', dir).server?.port, 5203);
        process.env.FRONTEND_PORT = 'invalid';
        assert.throws(() => createFrontendConfig('development', dir), /FRONTEND_PORT/);
    } finally {
        if (original === undefined) delete process.env.FRONTEND_PORT;
        else process.env.FRONTEND_PORT = original;
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Vite rejeita porta ocupada sem escolher a próxima', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'duelo-vite-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const occupied = createNetServer();
    await new Promise<void>((resolve, reject) => {
        occupied.once('error', reject);
        occupied.listen(0, '127.0.0.1', resolve);
    });
    t.after(() => new Promise<void>((resolve, reject) => {
        occupied.close((error) => error ? reject(error) : resolve());
    }));
    const address = occupied.address();
    assert.ok(address && typeof address !== 'string');
    const config = createFrontendConfig('development', dir);
    const vite = await createViteServer({
        ...config,
        configFile: false,
        root: dir,
        logLevel: 'silent',
        server: { ...config.server, port: address.port, hmr: false },
    });
    t.after(() => vite.close());
    await assert.rejects(() => vite.listen(), /already in use/);
});
