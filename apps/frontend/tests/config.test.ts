import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer as createNetServer } from 'node:net';
import { createServer as createViteServer } from 'vite';
import { createFrontendConfig, resolveFrontendPort } from '../vite.config.ts';

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'duelo-vite-'));
    const frontend = join(root, 'apps/frontend');
    mkdirSync(frontend, { recursive: true });
    return {
        root,
        frontend,
        configUrl: pathToFileURL(join(frontend, 'vite.config.ts')),
    };
}

test('FRONTEND_PORT tem padrão 5173 e aceita somente inteiros de 1 a 65535', () => {
    assert.equal(resolveFrontendPort(undefined), 5173);
    for (const value of ['1', '5175', '65535']) {
        assert.equal(resolveFrontendPort(value), Number(value));
    }
    for (const value of ['', ' ', '0', '-1', '1.5', '1e3', '65536', 'abc']) {
        assert.throws(() => resolveFrontendPort(value), /FRONTEND_PORT/);
    }
});

test('sem .env central, preserva defaults, base, strictPort e diretórios', () => {
    const dirs = fixture();
    const original = process.env.FRONTEND_PORT;
    try {
        delete process.env.FRONTEND_PORT;
        const config = createFrontendConfig('development', dirs.configUrl);
        assert.equal(config.base, './');
        assert.equal(config.root, fileURLToPath(new URL('.', dirs.configUrl)));
        assert.equal(
            config.envDir,
            fileURLToPath(new URL('../../', dirs.configUrl)),
        );
        assert.equal(config.server?.host, '127.0.0.1');
        assert.equal(config.server?.strictPort, true);
        assert.equal(config.server?.port, 5173);
        assert.ok(config.server?.proxy?.['/realtime']);
        assert.equal(config.envPrefix, undefined);
        assert.equal(config.define, undefined);
    } finally {
        if (original === undefined) delete process.env.FRONTEND_PORT;
        else process.env.FRONTEND_PORT = original;
        rmSync(dirs.root, { recursive: true, force: true });
    }
});

test('loadEnv lê raiz, ignora workspace e preserva prioridade do terminal', () => {
    const dirs = fixture();
    const original = process.env.FRONTEND_PORT;
    try {
        delete process.env.FRONTEND_PORT;
        writeFileSync(
            join(dirs.root, '.env'),
            'FRONTEND_PORT=5201\nBACKEND_PORT=3201\nPRIVATE_TOKEN=sentinela\n',
        );
        writeFileSync(join(dirs.frontend, '.env'), 'FRONTEND_PORT=9999\n');
        const config = createFrontendConfig('development', dirs.configUrl);
        assert.equal(config.server?.port, 5201);
        assert.doesNotMatch(JSON.stringify(config), /sentinela/);
        process.env.FRONTEND_PORT = '5203';
        assert.equal(
            createFrontendConfig('development', dirs.configUrl).server?.port,
            5203,
        );
        process.env.FRONTEND_PORT = 'invalid';
        assert.throws(
            () => createFrontendConfig('development', dirs.configUrl),
            /FRONTEND_PORT/,
        );
    } finally {
        if (original === undefined) delete process.env.FRONTEND_PORT;
        else process.env.FRONTEND_PORT = original;
        rmSync(dirs.root, { recursive: true, force: true });
    }
});

test('frontend resolve raiz pelo módulo mesmo com cwd no workspace ou fora dele', () => {
    const dirs = fixture();
    const originalPort = process.env.FRONTEND_PORT;
    const originalCwd = process.cwd();
    try {
        delete process.env.FRONTEND_PORT;
        writeFileSync(join(dirs.root, '.env'), 'FRONTEND_PORT=5204\n');
        for (const cwd of [dirs.root, dirs.frontend, tmpdir()]) {
            process.chdir(cwd);
            const config = createFrontendConfig('development', dirs.configUrl);
            assert.equal(config.server?.port, 5204);
            assert.equal(
                config.envDir,
                fileURLToPath(new URL('../../', dirs.configUrl)),
            );
        }
    } finally {
        process.chdir(originalCwd);
        if (originalPort === undefined) delete process.env.FRONTEND_PORT;
        else process.env.FRONTEND_PORT = originalPort;
        rmSync(dirs.root, { recursive: true, force: true });
    }
});

test('Vite rejeita porta ocupada sem escolher a próxima', async (t) => {
    const dirs = fixture();
    t.after(() => rmSync(dirs.root, { recursive: true, force: true }));
    const occupied = createNetServer();
    await new Promise<void>((resolve, reject) => {
        occupied.once('error', reject);
        occupied.listen(0, '127.0.0.1', resolve);
    });
    t.after(
        () =>
            new Promise<void>((resolve, reject) => {
                occupied.close((error) => (error ? reject(error) : resolve()));
            }),
    );
    const address = occupied.address();
    assert.ok(address && typeof address !== 'string');
    // A porta é reservada pelo SO; o teste não depende da configuração local.
    const vite = await createViteServer({
        base: './',
        configFile: false,
        root: dirs.frontend,
        envDir: dirs.root,
        logLevel: 'silent',
        server: {
            host: '127.0.0.1',
            strictPort: true,
            port: address.port,
            hmr: false,
        },
    });
    t.after(() => vite.close());
    await assert.rejects(() => vite.listen(), /already in use/);
});
