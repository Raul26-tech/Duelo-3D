import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import {
    createBackendServer,
    getBackendConfig,
    resolveBackendHost,
    resolvePort,
} from '../src/server.ts';

test('GET /health responde 200 com o contrato técnico em loopback', async (t) => {
    assert.equal(resolvePort(undefined), 3000);
    assert.equal(resolvePort('3001'), 3001);
    for (const value of ['', '0', '-1', '3.5', '65536', 'abc']) {
        assert.throws(() => resolvePort(value), RangeError);
    }
    const server = createBackendServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(
        () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    );
    const address = server.address() as AddressInfo;
    assert.equal(address.address, '127.0.0.1');
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await response.json(), {
        status: 'ok',
        service: 'duelo-3d-backend',
    });
    for (const [path, method] of [
        ['/missing', 'GET'],
        ['/health', 'POST'],
    ]) {
        const missing = await fetch(base + path, { method });
        assert.equal(missing.status, 404);
        await missing.text();
    }
});

test('configuração backend valida BACKEND_PORT e permite só hosts loopback', () => {
    assert.deepEqual(getBackendConfig({}), {
        port: 3000,
        host: '127.0.0.1',
    });
    assert.deepEqual(
        getBackendConfig({ BACKEND_PORT: '3001', BACKEND_HOST: '::1' }),
        { port: 3001, host: '::1' },
    );
    assert.equal(getBackendConfig({ PORT: '9999' }).port, 3000);
    assert.equal(resolveBackendHost(undefined), '127.0.0.1');
    for (const host of ['', '0.0.0.0', '::', 'localhost', '192.168.1.1']) {
        assert.throws(() => resolveBackendHost(host), /BACKEND_HOST/);
    }
    for (const port of ['', '0', '65536', '1.5', 'invalid']) {
        assert.throws(
            () => getBackendConfig({ BACKEND_PORT: port }),
            /BACKEND_PORT/,
        );
    }
});
