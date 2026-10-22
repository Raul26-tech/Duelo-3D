import { protectTemporaryDirectory } from '../private-files.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { ProviderClient } from '../tiktok/contracts.ts';
import { startRealRuntime } from '../integration/runtime.ts';
import { parseReviewedCatalog } from '../integration/config.ts';
import { createBackendServer } from '../server.ts';
import { readCredential } from './credentials.ts';
import {
    ADMIN_HOST,
    createAdministrationServer,
    loadAdministrationAssets,
} from './server.ts';
import { loadHomologationArena } from './homologation-assets.ts';

const ROOM = '9000000000000000001';
// Synthetic fixtures only: never import or promote the operator's gift catalog.
const gifts = parseReviewedCatalog([
    {
        giftId: '90001',
        name: 'Homologação Lula (sintético)',
        candidate: 'lula',
        points: 2,
        delivery: 'single',
    },
    {
        giftId: '90002',
        name: 'Homologação Flávio (sintético)',
        candidate: 'flavio',
        points: 2,
        delivery: 'single',
    },
]);

/** No event emitter, SDK, URL, sockets, retries or external event injection. */
export function createHomologationProvider(): ProviderClient {
    return Object.freeze({
        on() {},
        off() {},
        async connect() {
            return { roomId: ROOM };
        },
        async disconnect() {},
    });
}

export function assertHomologationIsolation(
    isolated: boolean,
    env: NodeJS.ProcessEnv,
) {
    if (!isolated)
        throw new Error(
            'Homologação exige --isolated e credencial de teste externa explícita',
        );
    const forbidden = Object.keys(env).filter(
        (key) =>
            key.startsWith('TIKTOK_') ||
            key.startsWith('ADMIN_') ||
            key.startsWith('VITE_') ||
            key === 'DUEL_MODE' ||
            ['FRONTEND_PORT', 'BACKEND_PORT', 'BACKEND_HOST'].includes(key),
    );
    if (
        forbidden.length ||
        env.NODE_ENV === 'production' ||
        env.NODE_OPTIONS ||
        process.execArgv.some(
            (arg) =>
                arg === '-r' ||
                /--(env-file|import|require|loader|experimental-loader)/u.test(
                    arg,
                ),
        )
    )
        throw new Error(
            'Ambiente não isolado: remova configurações operacionais e preloads antes de executar a homologação',
        );
}

function listen(server: Server, port: number, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const error = () =>
            reject(new Error(`Porta local indisponível: ${host}:${port}`));
        server.once('error', error);
        server.listen(port, host, () => {
            server.off('error', error);
            const address = server.address();
            if (!address || typeof address === 'string')
                return reject(new Error('Endereço local inválido'));
            resolve(address.port);
        });
    });
}
function closeServer(server: Server) {
    return new Promise<void>((resolve, reject) => {
        server.close((error) =>
            error &&
            (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING'
                ? reject(error)
                : resolve(),
        );
        server.closeAllConnections();
    });
}

/** One owned disposable dispute. No caller-supplied database, catalog, provider or host. */
export async function startAdministrationHomologation(options: {
    isolated: boolean;
    credentialFile: string;
    /** Ephemeral ports for integration tests only; the CLI always uses 5173/3001. */
    testPorts?: { arena: number; administration: number };
}) {
    assertHomologationIsolation(options.isolated, process.env);
    if (options.testPorts && process.env.NODE_ENV !== 'test')
        throw new Error('Portas de teste exigem NODE_ENV=test');
    const credential = readCredential(options.credentialFile);
    // Read only the compiled, non-operational bundles; fail before creating a database.
    const assets = loadAdministrationAssets();
    const arenaAssets = loadHomologationArena();
    const directory = mkdtempSync(join(tmpdir(), 'duelo-admin-homologation-'));
    try {
        protectTemporaryDirectory(directory);
    } catch (error) {
        rmSync(directory, { recursive: true, force: true });
        throw error;
    }
    const filename = join(directory, 'homologation.sqlite');
    let publicServer: Server | undefined;
    let admin: ReturnType<typeof createAdministrationServer> | undefined;
    let runtime: ReturnType<typeof startRealRuntime> | undefined;
    let arenaPort = options.testPorts?.arena ?? 5173;
    let adminPort = options.testPorts?.administration ?? 3001;
    let sessionId: string | undefined;
    let closing = false;
    let queue: Promise<unknown> = Promise.resolve();
    let closePromise: Promise<void> | undefined;
    async function stop() {
        const a = admin,
            r = runtime,
            s = publicServer;
        admin = undefined;
        runtime = undefined;
        publicServer = undefined;
        // Clear sessions and finish HTTP writes before closing the SQLite authority.
        try {
            await a?.close();
        } finally {
            try {
                await r?.close();
            } finally {
                if (s) await closeServer(s);
            }
        }
    }
    async function start(action: 'create' | 'resume') {
        try {
            publicServer = createBackendServer('real', (request, response) => {
                response.setHeader('X-Duelo-Homologation', 'isolated');
                if (
                    request.headers.host !== `127.0.0.1:${arenaPort}` ||
                    (request.headers.origin &&
                        request.headers.origin !==
                            `http://127.0.0.1:${arenaPort}`)
                ) {
                    response.writeHead(403);
                    response.end();
                    return true;
                }
                return arenaAssets(request, response);
            });
            arenaPort = await listen(publicServer, arenaPort, '127.0.0.1');
            runtime = startRealRuntime({
                server: publicServer,
                origin: `http://127.0.0.1:${arenaPort}`,
                config: {
                    mode: 'real',
                    username: 'homologation_synthetic_only',
                    roomId: ROOM,
                    filename,
                    action,
                    gifts,
                    sourcePolicy: 'homologation-only-admin-v1',
                },
                factory: createHomologationProvider,
            });
            const recovered = runtime.snapshot().sessionId;
            if (sessionId && recovered !== sessionId)
                throw new Error('Identidade da homologação divergente');
            sessionId = recovered;
            const current = runtime;
            admin = createAdministrationServer({
                credential,
                service: current.administration,
                gifts,
                connection: () =>
                    `HOMOLOGAÇÃO ISOLADA — provedor sintético (${current.state()})`,
                assets,
            });
            adminPort = await listen(admin.server, adminPort, ADMIN_HOST);
        } catch (error) {
            await stop();
            throw error;
        }
    }
    try {
        await start('create');
    } catch (error) {
        rmSync(directory, { recursive: true, force: true });
        throw error;
    }
    return {
        directory,
        filename,
        get arenaUrl() {
            return `http://127.0.0.1:${arenaPort}`;
        },
        get administrationUrl() {
            return `http://${ADMIN_HOST}:${adminPort}/admin/`;
        },
        recover() {
            if (closing)
                return Promise.reject(new Error('Homologação encerrada'));
            const next = queue.then(async () => {
                if (closing) throw new Error('Homologação encerrada');
                try {
                    await stop();
                    await start('resume');
                } catch (error) {
                    closing = true;
                    throw error;
                }
                // Same context/session; recovery errors never create a zeroed dispute.
            });
            queue = next.catch(() => {});
            return next;
        },
        close() {
            closing = true;
            closePromise ??= queue.then(async () => {
                try {
                    await stop();
                } finally {
                    rmSync(directory, { recursive: true, force: true });
                }
            });
            return closePromise;
        },
    };
}
