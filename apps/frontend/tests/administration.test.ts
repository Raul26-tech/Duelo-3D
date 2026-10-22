import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mountAdministration } from '../admin/ui.ts';
const html = readFileSync(
    new URL('../admin/index.html', import.meta.url),
    'utf8',
);
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const view = {
    state: {
        sessionId: 'session',
        version: 1,
        scores: { lula: 26, flavio: 2 },
    },
    connection: 'reconnecting',
    rules: [{ ruleId: '5655', name: 'Rose', candidate: 'lula', points: 2 }],
    history: [],
    total: 0,
    possibleDuplicates: [],
};
const drain = async () => {
    for (let i = 0; i < 8; i++)
        await new Promise<void>((resolve) => setImmediate(resolve));
};
function response(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
test('painel autentica antes de mostrar dados, calcula zero pontos localmente e usa UUID na operação', async (t) => {
    const dom = new JSDOM(html, { url: 'http://127.0.0.1:3001/admin/' }),
        doc = dom.window.document;
    const calls: {
        path: string;
        body: Record<string, unknown>;
        headers: Record<string, string>;
    }[] = [];
    const transport = (async (path, init) => {
        const text = String(path);
        if (text.endsWith('/session')) return response({}, 401);
        if (text.endsWith('/login'))
            return response({ operator: 'operador', csrf: 'csrf-test' });
        if (text.includes('/state')) return response(view);
        if (text.endsWith('/award')) {
            calls.push({
                path: text,
                body: JSON.parse(String(init?.body)),
                headers: init?.headers as Record<string, string>,
            });
            return response({ decision: { status: 'applied' } });
        }
        return response({});
    }) as typeof fetch;
    const panel = mountAdministration(doc, transport, () => operationId);
    t.after(() => {
        panel.close();
        dom.window.close();
    });
    const input = (id: string) => doc.getElementById(id) as HTMLInputElement;
    await drain();
    assert.equal(doc.getElementById('panel')!.hidden, true);
    input('operator').value = 'operador';
    input('password').value = 'private-test-password';
    doc.getElementById('login-form')!.dispatchEvent(
        new dom.window.Event('submit', { cancelable: true }),
    );
    await drain();
    assert.equal(doc.getElementById('panel')!.hidden, false);
    assert.equal(doc.getElementById('lula')!.textContent, '26');
    assert.equal(input('password').value, '');
    input('quantity').value = '13';
    input('justification').value = 'Reconciliação sintética pelo operador';
    input('reconciled').checked = true;
    doc.getElementById('award-form')!.dispatchEvent(
        new dom.window.Event('submit', { cancelable: true }),
    );
    await drain();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.operationId, operationId);
    assert.equal(calls[0].body.ruleId, '5655');
    assert.equal(calls[0].body.quantity, 13);
    assert.equal(Object.hasOwn(calls[0].body, 'points'), false);
    assert.equal(Object.hasOwn(calls[0].body, 'operatorId'), false);
    assert.equal(calls[0].headers['X-CSRF-Token'], 'csrf-test');
});
test('painel preserva mesma operação na falha de rede; retry explícito não fabrica outro ID', async (t) => {
    const dom = new JSDOM(html),
        doc = dom.window.document;
    let posts = 0;
    const requests: string[] = [];
    const transport = (async (path, init) => {
        if (String(path).endsWith('/session'))
            return response({ operator: 'operador', csrf: 'csrf' });
        if (String(path).includes('/state')) return response(view);
        if (String(path).endsWith('/award')) {
            requests.push(String(init?.body));
            if (++posts === 1) throw new Error('network');
            return response({ decision: { status: 'duplicate' } });
        }
        return response({});
    }) as typeof fetch;
    const panel = mountAdministration(doc, transport, () => operationId);
    t.after(() => {
        panel.close();
        dom.window.close();
    });
    await drain();
    (doc.getElementById('reconciled') as HTMLInputElement).checked = true;
    doc.getElementById('award-form')!.dispatchEvent(
        new dom.window.Event('submit', { cancelable: true }),
    );
    await drain();
    assert.equal(doc.getElementById('uncertain')!.hidden, false);
    doc.getElementById('retry')!.click();
    await drain();
    assert.equal(requests[0], requests[1]);
    assert.equal(doc.getElementById('uncertain')!.hidden, true);
});
test('histórico usa texto seguro, indica estorno e oferece correção vinculada, sem editar totais', async (t) => {
    const dom = new JSDOM(html),
        doc = dom.window.document;
    const transport = (async (path) =>
        String(path).endsWith('/session')
            ? response({ operator: 'operador', csrf: 'csrf' })
            : response({
                  ...view,
                  history: [
                      {
                          operationId,
                          operatorId: 'operador',
                          at: '2026-10-22T12:00:00.000Z',
                          type: 'admin.award',
                          candidate: 'lula',
                          ruleId: '5655',
                          quantity: 13,
                          points: 26,
                          justification: '<img src=x onerror=alert(1)>',
                          reference: null,
                          link: null,
                          state: 'reversed',
                      },
                  ],
                  total: 1,
              })) as typeof fetch;
    const panel = mountAdministration(doc, transport);
    t.after(() => {
        panel.close();
        dom.window.close();
    });
    await drain();
    assert.equal(doc.querySelector('#history img'), null);
    assert.ok(doc.getElementById('history')!.textContent!.includes('<img'));
    assert.ok(
        doc.getElementById('history')!.textContent!.includes('ESTORNADA'),
    );
    (doc.querySelector('#history button') as HTMLButtonElement).click();
    assert.equal(
        (doc.getElementById('correction') as HTMLInputElement).value,
        operationId,
    );
    assert.equal(doc.getElementById('lula')!.textContent, '26');
});

test('Vite público não entrega painel, bundle administrativo ou arquivos via @fs', async (t) => {
    const { createServer } = await import('vite');
    const { createFrontendConfig } = await import('../vite.config.ts');
    const config = createFrontendConfig('development');
    const server = await createServer({
        ...config,
        configFile: false,
        server: { ...config.server, port: 0, strictPort: false },
    });
    await server.listen();
    t.after(() => server.close());
    const address = server.httpServer!.address();
    assert.ok(address && typeof address !== 'string');
    for (const path of [
        '/admin/',
        '/admin-dist/index.html',
        '/@fs' + new URL('../admin/index.html', import.meta.url).pathname,
    ]) {
        const result: Response = await fetch(
            `http://127.0.0.1:${address.port}${path}`,
        );
        assert.ok([403, 404].includes(result.status), path);
    }
});
