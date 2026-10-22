import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { record, exact } from '../scoring/validation.ts';
import {
    readCredential,
    verifyCredential,
    type Credential,
} from './credentials.ts';
import type { createAdministrationService } from './service.ts';
import { giftRuleKey } from '../scoring/catalog.ts';
import type { ReviewedGift } from '../integration/config.ts';
import { resolvePort } from '../server.ts';
export const ADMIN_HOST = '127.0.0.2';
export function readAdministrationConfig(env: NodeJS.ProcessEnv = process.env) {
    if (env.ADMIN_ENABLED === undefined || env.ADMIN_ENABLED === 'false')
        return null;
    if (
        env.ADMIN_ENABLED !== 'true' ||
        env.DUEL_MODE !== 'real' ||
        env.TIKTOK_REAL_ENABLED !== 'true' ||
        !env.ADMIN_CREDENTIAL_FILE
    )
        throw new Error(
            'Administração exige modo real explícito e credencial privada',
        );
    return {
        port: resolvePort(env.ADMIN_PORT ?? '3001'),
        credential: readCredential(env.ADMIN_CREDENTIAL_FILE),
    };
}
const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
const equal = (a: unknown, b: string) =>
    typeof a === 'string' &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(request: IncomingMessage) {
    if (request.headers['content-type'] !== 'application/json')
        throw new Error('INVALID_REQUEST');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const data = Buffer.from(chunk);
        size += data.length;
        if (size > 8192) throw new Error('INVALID_REQUEST');
        chunks.push(data);
    }
    try {
        return JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(
                Buffer.concat(chunks),
            ),
        );
    } catch {
        throw new Error('INVALID_REQUEST');
    }
}
export function loadAdministrationAssets() {
    const directory = new URL(
        '../../../../apps/frontend/admin-dist/',
        import.meta.url,
    );
    const files = new Map<string, { type: string; data: Buffer }>();
    for (const filename of [
        'index.html',
        'login.html',
        ...readdirSync(new URL('assets/', directory)).map(
            (name) => 'assets/' + name,
        ),
    ]) {
        if (
            !/^((index|login)\.html|assets\/[a-zA-Z0-9_.-]+\.(js|css))$/u.test(
                filename,
            )
        )
            continue;
        files.set(filename, {
            type: filename.endsWith('.html')
                ? 'text/html; charset=utf-8'
                : filename.endsWith('.js')
                  ? 'text/javascript; charset=utf-8'
                  : 'text/css; charset=utf-8',
            data: readFileSync(new URL(filename, directory)),
        });
    }
    return files;
}
export function createAdministrationServer(options: {
    credential: Credential;
    service: ReturnType<typeof createAdministrationService>;
    gifts: readonly ReviewedGift[];
    connection: () => string;
    assets:
        | ReturnType<typeof loadAdministrationAssets>
        | (() => ReturnType<typeof loadAdministrationAssets>);
    now?: () => number;
}) {
    const sessions = new Map<
        string,
        { operator: string; csrf: string; created: number; last: number }
    >();
    const now = options.now ?? Date.now;
    let loginWindow = 0,
        attempts = 0,
        busy = false;
    const server = createServer((req, res) => {
        void handle(req, res).catch(() => {
            if (!res.headersSent) send(res, 400, { error: 'INVALID_REQUEST' });
            else res.destroy();
        });
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.maxHeadersCount = 32;
    server.on('clientError', (_error, socket) =>
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'),
    );
    const cookie = (token: string, expire = false) =>
        `duelo_admin=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${expire ? 0 : 7200}`;
    function send(res: ServerResponse, code: number, value: unknown) {
        res.writeHead(code, {
            'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify(value));
    }
    async function handle(req: IncomingMessage, res: ServerResponse) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader(
            'Content-Security-Policy',
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        );
        const address = server.address();
        if (!address || typeof address === 'string') {
            send(res, 503, { error: 'UNAVAILABLE' });
            return;
        }
        const origin = `http://${ADMIN_HOST}:${address.port}`;
        if (
            req.headers.host !== `${ADMIN_HOST}:${address.port}` ||
            ![
                '127.0.0.1',
                '127.0.0.2',
                '::ffff:127.0.0.1',
                '::ffff:127.0.0.2',
            ].includes(req.socket.remoteAddress ?? '') ||
            (req.headers.origin !== undefined &&
                req.headers.origin !== origin) ||
            req.headers['sec-fetch-site'] === 'cross-site'
        ) {
            send(res, 403, { error: 'ORIGIN_DENIED' });
            return;
        }
        const time = now();
        for (const [key, value] of sessions)
            if (time - value.last > 600000 || time - value.created > 7200000)
                sessions.delete(key);
        const token = (req.headers.cookie ?? '')
            .split(';')
            .map((part) => part.trim())
            .find((part) => part.startsWith('duelo_admin='))
            ?.slice('duelo_admin='.length);
        const session =
            token && /^[a-zA-Z0-9_-]{43}$/u.test(token)
                ? sessions.get(hash(token))
                : undefined;
        const url = new URL(req.url ?? '/', origin);
        if (!url.pathname.startsWith('/admin/')) {
            send(res, 404, { error: 'NOT_FOUND' });
            return;
        }
        // The login shell carries no state/secrets. The panel is mounted only after session check.
        if (
            req.method === 'GET' &&
            (url.pathname === '/admin/' ||
                url.pathname.startsWith('/admin/assets/'))
        ) {
            const key =
                url.pathname === '/admin/'
                    ? session
                        ? 'index.html'
                        : 'login.html'
                    : url.pathname.slice('/admin/'.length);
            let asset;
            try {
                asset = (
                    typeof options.assets === 'function'
                        ? options.assets()
                        : options.assets
                ).get(key);
            } catch {
                send(res, 503, { error: 'BUILD_ADMIN_REQUIRED' });
                return;
            }
            if (!asset) {
                send(res, 404, { error: 'NOT_FOUND' });
                return;
            }
            res.writeHead(200, { 'Content-Type': asset.type });
            res.end(asset.data);
            return;
        }
        if (
            !url.pathname.startsWith('/admin/api/') ||
            req.headers['x-admin-request'] !== '1'
        ) {
            send(res, 403, { error: 'ADMIN_REQUEST_REQUIRED' });
            return;
        }
        if (req.method !== 'GET' && req.headers.origin !== origin) {
            send(res, 403, { error: 'ORIGIN_DENIED' });
            return;
        }
        try {
            if (req.url === '/admin/api/login' && req.method === 'POST') {
                if (time - loginWindow >= 60000) {
                    loginWindow = time;
                    attempts = 0;
                }
                if (++attempts > 5 || busy) {
                    send(res, 429, { error: 'LOGIN_RATE_LIMIT' });
                    return;
                }
                const input = await body(req);
                if (!record(input) || !exact(input, ['operator', 'password'])) {
                    send(res, 400, { error: 'INVALID_REQUEST' });
                    return;
                }
                if (busy) {
                    send(res, 429, { error: 'LOGIN_RATE_LIMIT' });
                    return;
                }
                busy = true;
                let valid = false;
                try {
                    valid = await verifyCredential(
                        options.credential,
                        input.operator,
                        input.password,
                    );
                } finally {
                    busy = false;
                }
                if (!valid) {
                    send(res, 401, { error: 'INVALID_CREDENTIALS' });
                    return;
                }
                const token = randomBytes(32).toString('base64url'),
                    csrf = randomBytes(32).toString('base64url');
                while (sessions.size >= 16)
                    sessions.delete(sessions.keys().next().value!);
                sessions.set(hash(token), {
                    operator: options.credential.operator,
                    csrf,
                    created: time,
                    last: time,
                });
                res.setHeader('Set-Cookie', cookie(token));
                send(res, 200, { operator: options.credential.operator, csrf });
                return;
            }
            if (!session) {
                send(res, 401, { error: 'AUTHENTICATION_REQUIRED' });
                return;
            }
            session.last = time;
            if (
                req.method !== 'GET' &&
                !equal(req.headers['x-csrf-token'], session.csrf)
            ) {
                send(res, 403, { error: 'CSRF_DENIED' });
                return;
            }
            if (req.url === '/admin/api/logout' && req.method === 'POST') {
                sessions.delete(hash(token!));
                res.setHeader('Set-Cookie', cookie('', true));
                send(res, 200, { ok: true });
                return;
            }
            if (req.url === '/admin/api/session' && req.method === 'GET') {
                send(res, 200, {
                    operator: session.operator,
                    csrf: session.csrf,
                });
                return;
            }
            if (url.pathname === '/admin/api/state' && req.method === 'GET') {
                const page = Number(url.searchParams.get('page') ?? '0');
                if (!Number.isSafeInteger(page) || page < 0 || page > 10000) {
                    send(res, 400, { error: 'INVALID_PAGE' });
                    return;
                }
                const view = options.service.view();
                const rows = [...view.operations].reverse();
                send(res, 200, {
                    state: view.state,
                    connection: options.connection(),
                    rules: options.gifts.map((rule) => ({
                        ruleId: giftRuleKey(rule),
                        name: rule.name,
                        candidate: rule.candidate,
                        points: rule.points,
                    })),
                    history: rows.slice(page * 50, page * 50 + 50),
                    possibleDuplicates: rows
                        .filter(
                            (row) =>
                                row.type === 'admin.award' &&
                                row.state === 'applied' &&
                                row.ruleId === url.searchParams.get('ruleId') &&
                                row.quantity ===
                                    Number(url.searchParams.get('quantity')),
                        )
                        .slice(0, 20),
                    total: rows.length,
                    page,
                });
                return;
            }
            if (
                (req.url === '/admin/api/award' ||
                    req.url === '/admin/api/reversal') &&
                req.method === 'POST'
            ) {
                const decision = options.service.execute(
                    session.operator,
                    req.url.endsWith('/award') ? 'award' : 'reversal',
                    await body(req),
                );
                send(res, decision.status === 'rejected' ? 409 : 200, {
                    decision,
                });
                return;
            }
            send(res, 404, { error: 'NOT_FOUND' });
        } catch (error) {
            const code = error instanceof Error ? error.message : '';
            if (['INVALID_REQUEST', 'SESSION_MISMATCH'].includes(code))
                send(res, 400, { error: code });
            else send(res, 503, { error: 'ADMIN_UNAVAILABLE' }); // Never return SQL, paths, payloads or credentials.
        }
    }
    return {
        server,
        close() {
            sessions.clear();
            server.close();
            server.closeAllConnections();
        },
    };
}
