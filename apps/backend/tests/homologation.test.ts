import test, { before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
    mkdtempSync,
    rmSync,
    writeFileSync,
    existsSync,
    statSync,
    readFileSync,
    readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request, createServer } from 'node:http';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import { makeCredential } from '../src/admin/credentials.ts';
import {
    assertHomologationIsolation,
    createHomologationProvider,
    startAdministrationHomologation,
} from '../src/admin/homologation.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const password = 'synthetic-homologation-password-only';
let directory: string, credentialFile: string;
before(() => {
    process.env.NODE_ENV = 'test';
    directory = mkdtempSync(join(tmpdir(), 'duelo-homologation-test-'));
    credentialFile = join(directory, 'test-credential.json');
    writeFileSync(
        credentialFile,
        JSON.stringify(makeCredential('homologacao', password)),
        { mode: 0o600 },
    );
    // Tests work on a fresh npm ci, using the actual compiled UI, not a mock page.
    const result = spawnSync('npm', ['run', 'build:homologation'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 60000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
});
after(() => rmSync(directory, { recursive: true, force: true }));

function http(
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
): Promise<{
    status: number;
    headers: import('node:http').IncomingHttpHeaders;
    text: string;
    data: Buffer;
}> {
    return new Promise((resolve, reject) => {
        const req = request(
            url,
            {
                agent: false,
                method: body === undefined ? 'GET' : 'POST',
                headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                res.on('end', () => {
                    const data = Buffer.concat(chunks);
                    resolve({
                        status: res.statusCode!,
                        headers: res.headers,
                        text: data.toString(),
                        data,
                    });
                });
                res.on('error', reject);
            },
        );
        req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout')));
        req.on('error', reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
    });
}
async function rig(t: TestContext) {
    const app = await startAdministrationHomologation({
        isolated: true,
        credentialFile,
        testPorts: { arena: 0, administration: 0 },
    });
    t.after(() => app.close());
    return app;
}
async function authenticated(base: string) {
    const origin = new URL(base).origin;
    const result = await http(
        base + 'api/login',
        { operator: 'homologacao', password },
        {
            Origin: origin,
            'Content-Type': 'application/json',
            'X-Admin-Request': '1',
        },
    );
    assert.equal(result.status, 200);
    const cookie = result.headers['set-cookie']![0].split(';')[0],
        csrf = JSON.parse(result.text).csrf;
    return (path: string, body?: unknown) =>
        http(base + 'api/' + path, body, {
            Cookie: cookie,
            Origin: origin,
            'Content-Type': 'application/json',
            'X-Admin-Request': '1',
            'X-CSRF-Token': csrf,
        });
}
function award(sessionId: string, quantity = 13) {
    return {
        operationId: randomUUID(),
        sessionId,
        candidate: 'lula',
        ruleId: '90001',
        quantity,
        justification: 'Homologação visual sintética',
        link: null,
        correctionOf: null,
        reconciliationConfirmed: true,
    };
}

test('homologação: rejeita ausência de consentimento e configurações operacionais antes de ler credenciais', async () => {
    assert.throws(() => assertHomologationIsolation(false, {}), /--isolated/);
    for (const key of [
        'TIKTOK_DATABASE',
        'TIKTOK_GIFT_CATALOG',
        'TIKTOK_USERNAME',
        'ADMIN_CREDENTIAL_FILE',
        'ADMIN_ENABLED',
        'DUEL_MODE',
        'BACKEND_HOST',
        'BACKEND_PORT',
        'FRONTEND_PORT',
        'VITE_SECRET',
        'NODE_OPTIONS',
    ])
        assert.throws(
            () => assertHomologationIsolation(true, { [key]: 'operational' }),
            /não isolado/,
        );
    assert.throws(
        () => assertHomologationIsolation(true, { NODE_ENV: 'production' }),
        /não isolado/,
    );
    assert.doesNotThrow(() => assertHomologationIsolation(true, {}));
    await assert.rejects(
        startAdministrationHomologation({
            isolated: false,
            credentialFile: '/not-read',
        }),
        /--isolated/,
    );
    await assert.rejects(
        startAdministrationHomologation({
            isolated: true,
            credentialFile: '/absent-test-credential',
        }),
        /ENOENT/,
    );
});

test('homologação: ProviderClient sintético não emite eventos nem importa SDK/conecta rede', async (t) => {
    const { Socket } = await import('node:net');
    t.mock.method(Socket.prototype, 'connect', () => {
        throw new Error('Outbound network forbidden');
    });
    const provider = createHomologationProvider();
    let emitted = false;
    provider.on('gift', () => {
        emitted = true;
    });
    assert.deepEqual(await provider.connect(), {
        roomId: '9000000000000000001',
    });
    await provider.disconnect();
    assert.equal(emitted, false);
});

test('homologação: banco temporário privado, autoridade isolada e limpeza idempotente', async (t) => {
    const app = await rig(t);
    assert.ok(app.filename.startsWith(app.directory + '/'));
    assert.equal(app.filename, join(app.directory, 'homologation.sqlite'));
    assert.ok(!app.directory.startsWith(root));
    assert.equal(statSync(app.directory).mode & 0o777, 0o700);
    assert.equal(statSync(app.filename).mode & 0o077, 0);
    assert.ok(
        !app.filename.includes('live-fase54-tuneldotempodjtim-01.sqlite'),
    );
    assert.ok(existsSync(app.filename + '.authority.lock'));
    const db = new Database(app.filename, { readonly: true });
    assert.equal(
        (db.prepare('SELECT domain FROM dispute').get() as { domain: string })
            .domain,
        'real',
    );
    db.close();
    await Promise.all([app.close(), app.close()]);
    assert.equal(existsSync(app.directory), false);
    await assert.rejects(app.recover(), /encerrada/);
});

test('homologação: bundle administrativo real protegido e arena separada com seis vídeos íntegros', async (t) => {
    const app = await rig(t);
    const login = await http(app.administrationUrl);
    assert.equal(login.status, 200);
    assert.ok(login.text.includes('type="password"'));
    const origin = new URL(app.administrationUrl).origin;
    const signedIn = await http(
        app.administrationUrl + 'api/login',
        { operator: 'homologacao', password },
        {
            Origin: origin,
            'Content-Type': 'application/json',
            'X-Admin-Request': '1',
        },
    );
    assert.equal(signedIn.status, 200);
    const panel = await http(app.administrationUrl, undefined, {
        Cookie: signedIn.headers['set-cookie']![0].split(';')[0],
    });
    assert.ok(panel.text.includes('id="panel"'));
    assert.equal(
        (
            await http(
                app.administrationUrl + 'api/login',
                { operator: 'homologacao', password: 'wrong' },
                {
                    Origin: origin,
                    'Content-Type': 'application/json',
                    'X-Admin-Request': '1',
                },
            )
        ).status,
        401,
    );
    assert.equal(
        (
            await http(app.administrationUrl + 'api/state', undefined, {
                'X-Admin-Request': '1',
            })
        ).status,
        401,
    );
    assert.equal((await http(app.arenaUrl + '/admin/api/state')).status, 404);
    assert.equal((await http(app.arenaUrl + '/.env')).status, 404);
    assert.equal(
        (
            await http(app.arenaUrl + '/', undefined, {
                Host: 'external.example',
            })
        ).status,
        403,
    );
    assert.equal((await http(app.arenaUrl + '/health')).status, 200);
    assert.equal(
        JSON.parse((await http(app.arenaUrl + '/arena/mode')).text).mode,
        'real',
    );
    const html = (await http(app.arenaUrl + '/')).text;
    assert.ok(html.includes('fighter-a'));
    const script = html.match(/src="(\.\/assets\/[^"]+\.js)"/u)![1];
    assert.equal(
        (await http(app.arenaUrl + '/' + script.slice(2))).status,
        200,
    );
    for (const name of readdirSync(join(root, 'apps/frontend/public/videos'))) {
        const video = await http(app.arenaUrl + '/videos/' + name);
        assert.equal(video.status, 200);
        assert.equal(
            createHash('sha256').update(video.data).digest('hex'),
            createHash('sha256')
                .update(
                    readFileSync(
                        join(root, 'apps/frontend/public/videos', name),
                    ),
                )
                .digest('hex'),
        );
        const range = await http(app.arenaUrl + '/videos/' + name, undefined, {
            Range: 'bytes=0-31',
        });
        assert.equal(range.status, 206);
        assert.deepEqual(range.data, video.data.subarray(0, 32));
    }
    assert.equal(
        (
            await http(app.arenaUrl + '/videos/lula-feliz.webm', undefined, {
                Range: 'bytes=999999999999-',
            })
        ).status,
        416,
    );
    const api = await authenticated(app.administrationUrl);
    const state = JSON.parse((await api('state')).text);
    assert.equal(state.rules.length, 2);
    assert.ok(
        state.rules.every((rule: { name: string }) =>
            rule.name.includes('sintético'),
        ),
    );
    assert.ok(state.connection.includes('HOMOLOGAÇÃO ISOLADA'));
});

test('homologação: lançamento, idempotência, histórico, estorno, correção e recuperação pela mesma sessão', async (t) => {
    const app = await rig(t);
    let api = await authenticated(app.administrationUrl);
    const view = JSON.parse((await api('state')).text);
    const body = award(view.state.sessionId);
    const ws = new WebSocket(app.arenaUrl.replace('http:', 'ws:') + '/arena', {
        origin: app.arenaUrl,
        agent: false,
    });
    t.after(() => ws.terminate());
    const [initial] = await once(ws, 'message');
    assert.equal(JSON.parse(initial.toString()).state.scores.a, 0);
    const update = once(ws, 'message');
    assert.equal((await api('award', body)).status, 200);
    assert.equal(JSON.parse((await update)[0].toString()).state.scores.a, 26);
    assert.equal(
        JSON.parse((await api('award', body)).text).decision.status,
        'duplicate',
    );
    assert.equal(
        (await api('award', { ...award(body.sessionId), ruleId: '5655' }))
            .status,
        409,
    );
    const reversal = {
        operationId: randomUUID(),
        sessionId: body.sessionId,
        targetOperationId: body.operationId,
        justification: 'Estorno sintético',
    };
    assert.equal((await api('reversal', reversal)).status, 200);
    assert.equal(
        (
            await api('award', {
                ...award(body.sessionId, 3),
                correctionOf: body.operationId,
            })
        ).status,
        200,
    );
    const before = JSON.parse((await api('state')).text);
    assert.equal(before.state.scores.lula, 6);
    assert.equal(before.history.length, 3);
    assert.ok(
        before.history.some(
            (row: { state: string }) => row.state === 'reversed',
        ),
    );
    const disconnected = once(ws, 'close');
    await app.recover();
    await disconnected;
    assert.equal((await api('state')).status, 401); // Recovery invalidates the old cookie/session.
    api = await authenticated(app.administrationUrl);
    const recovered = JSON.parse((await api('state')).text);
    assert.deepEqual(recovered.state, before.state);
    assert.deepEqual(recovered.history, before.history);
    assert.equal(
        JSON.parse((await api('award', body)).text).decision.status,
        'duplicate',
    );
    const after = new WebSocket(
        app.arenaUrl.replace('http:', 'ws:') + '/arena',
        { origin: app.arenaUrl, agent: false },
    );
    t.after(() => after.terminate());
    const [snapshot] = await once(after, 'message');
    assert.equal(JSON.parse(snapshot.toString()).state.scores.a, 6);
});

test('homologação: recuperação inconsistente bloqueia sem criar outra disputa', async (t) => {
    const app = await rig(t);
    const api = await authenticated(app.administrationUrl);
    const body = award(JSON.parse((await api('state')).text).state.sessionId);
    await api('award', body);
    const db = new Database(app.filename);
    db.exec('UPDATE dispute SET lula=lula+1');
    db.close();
    await assert.rejects(app.recover());
    await assert.rejects(app.recover(), /encerrada/);
    const check = new Database(app.filename, { readonly: true });
    assert.equal(
        (check.prepare('SELECT lula FROM dispute').get() as { lula: number })
            .lula,
        27,
    );
    check.close();
    await app.close();
});

test('homologação: porta ocupada falha sem alternar portas nem deixar autoridade/servidor aberto', async (t) => {
    const before = readdirSync(tmpdir()).filter((name) =>
        name.startsWith('duelo-admin-homologation-'),
    );
    const occupied = createServer();
    occupied.listen(0, '127.0.0.2');
    await once(occupied, 'listening');
    t.after(
        () => new Promise<void>((resolve) => occupied.close(() => resolve())),
    );
    const address = occupied.address();
    assert.ok(address && typeof address !== 'string');
    await assert.rejects(
        startAdministrationHomologation({
            isolated: true,
            credentialFile,
            testPorts: { arena: 0, administration: address.port },
        }),
        /Porta local indisponível/,
    );
    assert.deepEqual(
        readdirSync(tmpdir()).filter((name) =>
            name.startsWith('duelo-admin-homologation-'),
        ),
        before,
    );
});

test(
    'homologação CLI: nenhum SDK/env/rede de saída; credencial explícita, recuperação e SIGINT limpam banco/portas',
    { timeout: 30000 },
    async (t) => {
        const cli = new URL('../src/admin/homologation-cli.ts', import.meta.url)
            .href;
        // Guard the actual entrypoint for its whole lifetime, including recovery.
        const code = `
        import { Socket } from 'node:net';
        import { registerHooks } from 'node:module';
        void process.stdout; void process.stderr;
        Socket.prototype.connect = function() { throw new Error('OUTBOUND_FORBIDDEN'); };
        process.loadEnvFile = () => { throw new Error('ENV_FORBIDDEN'); };
        globalThis.fetch = () => { throw new Error('OUTBOUND_FORBIDDEN'); };
        registerHooks({ resolve(specifier, context, next) { if (specifier.startsWith('tiktok-live-connector')) throw new Error('SDK_FORBIDDEN'); return next(specifier, context); } });
        const { runHomologation } = await import(${JSON.stringify(cli)});
        await runHomologation(['--isolated', '--credential', ${JSON.stringify(credentialFile)}]);
    `;
        const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
        delete env.FORCE_COLOR;
        const child = spawn(
            process.execPath,
            ['--input-type=module', '-e', code],
            { cwd: tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] },
        );
        let output = '',
            errors = '';
        child.stdout.on('data', (data) => {
            output += data.toString();
        });
        child.stderr.on('data', (data) => {
            errors += data.toString();
        });
        t.after(() => {
            if (child.exitCode === null) child.kill('SIGKILL');
        });
        const waitFor = async (text: string) => {
            const until = Date.now() + 15000;
            while (!output.includes(text)) {
                if (child.exitCode !== null || Date.now() > until)
                    assert.fail('CLI não disponível: ' + output + errors);
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
        };
        await waitFor('r + Enter');
        assert.ok(output.includes('http://127.0.0.2:3001/admin/'));
        assert.ok(output.includes('http://127.0.0.1:5173/'));
        const temporary = output.match(/Banco descartável: (.+)/u)![1].trim();
        const api = await authenticated('http://127.0.0.2:3001/admin/');
        const state = JSON.parse((await api('state')).text);
        await api('award', award(state.state.sessionId));
        child.stdin.write('r\n');
        await waitFor('Recuperação concluída');
        const next = await authenticated('http://127.0.0.2:3001/admin/');
        assert.equal(
            JSON.parse((await next('state')).text).state.scores.lula,
            26,
        );
        const exited = once(child, 'exit');
        child.kill('SIGINT');
        assert.equal((await exited)[0], 0, errors);
        assert.equal(existsSync(temporary), false);
        await assert.rejects(http('http://127.0.0.2:3001/admin/'));
        await assert.rejects(http('http://127.0.0.1:5173/health'));
        assert.ok(!output.includes(password));
        assert.ok(!output.includes('duelo_admin='));
        assert.ok(!errors.includes('FORBIDDEN'), errors);
    },
);

test(
    'homologação: comando npm raiz encerra todo o grupo por SIGINT e limpa o SQLite',
    { timeout: 30000, skip: process.platform === 'win32' },
    async (t) => {
        const child = spawn(
            'npm',
            [
                'run',
                'homologate:admin',
                '--',
                '--isolated',
                '--credential',
                credentialFile,
            ],
            {
                cwd: root,
                env: { ...process.env, NO_COLOR: '1' },
                detached: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            },
        );
        let output = '',
            errors = '';
        child.stdout.on('data', (data) => {
            output += data.toString();
        });
        child.stderr.on('data', (data) => {
            errors += data.toString();
        });
        t.after(() => {
            try {
                process.kill(-child.pid!, 'SIGKILL');
            } catch {
                /* The whole group has already exited. */
            }
        });
        const until = Date.now() + 15000;
        while (!output.includes('r + Enter')) {
            if (
                child.exitCode !== null ||
                child.signalCode !== null ||
                Date.now() > until
            )
                assert.fail('npm não iniciou: ' + output + errors);
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const temporary = output.match(/Banco descartável: (.+)/u)![1].trim();
        assert.equal((await http('http://127.0.0.2:3001/admin/')).status, 200);
        assert.equal((await http('http://127.0.0.1:5173/health')).status, 200);
        const exited = once(child, 'exit');
        process.kill(-child.pid!, 'SIGINT');
        await exited;
        for (let i = 0; existsSync(temporary) && i < 100; i++)
            await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(existsSync(temporary), false);
        await assert.rejects(http('http://127.0.0.2:3001/admin/'));
        await assert.rejects(http('http://127.0.0.1:5173/health'));
    },
);
