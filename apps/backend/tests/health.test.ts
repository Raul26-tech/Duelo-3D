import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createBackendServer, resolvePort } from '../src/server.ts';

test('GET /health responde 200 com o contrato técnico em loopback', async (t) => {
    assert.equal(resolvePort(undefined), 3000);
    assert.equal(resolvePort('3001'), 3001);
    for (const value of ['', '0', '-1', '3.5', '65536', 'abc']) {
        assert.throws(() => resolvePort(value), RangeError);
    }
    const server = createBackendServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    }));
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
    for (const [path, method] of [['/missing', 'GET'], ['/health', 'POST']]) {
        const missing = await fetch(base + path, { method });
        assert.equal(missing.status, 404);
        await missing.text();
    }
});
