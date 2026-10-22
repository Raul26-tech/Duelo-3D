import { createBackendServer, getBackendConfig } from './server.ts';
import { loadOptionalEnv } from './environment.ts';

loadOptionalEnv();
const { port, host } = getBackendConfig();
const mode = process.env.DUEL_MODE ?? 'simulation';
if (!['simulation', 'observation', 'real'].includes(mode))
    throw new Error('Invalid DUEL_MODE');
if (mode !== 'real' && process.env.TIKTOK_REAL_ENABLED === 'true')
    throw new Error('Real scoring requires DUEL_MODE=real');
let adminConfig: ReturnType<
    typeof import('./admin/server.ts').readAdministrationConfig
> = null;
if (
    process.env.ADMIN_ENABLED !== undefined &&
    process.env.ADMIN_ENABLED !== 'false'
) {
    const { readAdministrationConfig } = await import('./admin/server.ts');
    adminConfig = readAdministrationConfig();
}
let administration:
    | ReturnType<typeof import('./admin/server.ts').createAdministrationServer>
    | undefined;
const server = createBackendServer(
    mode as 'simulation' | 'observation' | 'real',
);
server.on('error', (error) => {
    console.error('Falha ao iniciar backend:', error.message);
    process.exitCode = 1;
    void stop();
});
let realtime: { close(): void | Promise<void> } | undefined;
if (
    mode === 'simulation' &&
    process.env.NODE_ENV === 'development' &&
    process.env.SIMULATION_MODE === 'true'
) {
    const { readSimulationConfig } = await import('./realtime/config.ts');
    const { attachRealtime } = await import('./realtime/server.ts');
    const config = readSimulationConfig();
    realtime = attachRealtime(server, config);
    console.log('SIMULAÇÃO LOCAL: autorize a arena com a chave do operador.');
    if (config.generatedToken)
        console.log('Chave temporária da simulação:', config.token);
    else console.log('Use a SIMULATION_TOKEN configurada no .env/terminal.');
}
if (mode === 'real' || mode === 'observation') {
    // Dynamic imports keep the default simulation and health entrypoints independent of the SDK.
    const { createProviderFactory } = await import('./tiktok/provider.ts');
    const { readDiagnosticConfig } = await import('./tiktok/config.ts');
    const write = (line: string) => {
        if (process.stdout.writableLength < 65536)
            process.stdout.write(line + '\n');
    };
    if (mode === 'real') {
        const { readRealConfig } = await import('./integration/config.ts');
        const { startRealRuntime } = await import('./integration/runtime.ts');
        const config = readRealConfig();
        const factory = await createProviderFactory({
            enabled: true,
            username: config.username,
            signApiKey: config.signApiKey,
        });
        const { resolvePort } = await import('./server.ts');
        const frontendPort = resolvePort(process.env.FRONTEND_PORT ?? '5173');
        if (
            adminConfig &&
            (adminConfig.port === port || adminConfig.port === frontendPort)
        )
            throw new Error('ADMIN_PORT deve ser distinta das portas públicas');
        const runtime = startRealRuntime({
            server,
            origin: `http://127.0.0.1:${frontendPort}`,
            config,
            factory,
            writeDiagnostic: write,
        });
        realtime = runtime;
        if (adminConfig) {
            const {
                createAdministrationServer,
                loadAdministrationAssets,
                ADMIN_HOST,
            } = await import('./admin/server.ts');
            let assets: ReturnType<typeof loadAdministrationAssets> | undefined;
            administration = createAdministrationServer({
                credential: adminConfig.credential,
                service: runtime.administration,
                gifts: config.gifts,
                connection: runtime.state,
                assets: () => (assets ??= loadAdministrationAssets()),
            });
            administration.server.on('error', () => {
                process.exitCode = 1;
                void stop();
            });
            administration.server.listen(adminConfig.port, ADMIN_HOST, () =>
                console.log(
                    `Administração local: http://${ADMIN_HOST}:${adminConfig.port}/admin/`,
                ),
            );
        }
        console.log(
            'REAL: arena somente leitura; fonte TikTok e disputa persistida vinculadas.',
        );
    } else {
        const config = readDiagnosticConfig();
        if (!config.enabled)
            throw new Error(
                'Observation requires TIKTOK_DIAGNOSTIC_ENABLED=true',
            );
        const { createDiagnosticClient } = await import('./tiktok/client.ts');
        const { createDiagnosticLogger, createEventObserver } =
            await import('./tiktok/diagnostics.ts');
        const logger = createDiagnosticLogger(write);
        const observer = createEventObserver(logger);
        const client = createDiagnosticClient({
            enabled: true,
            factory: await createProviderFactory(config),
            logger,
            observer,
        });
        const timer = setInterval(() => observer.tick(), 1000);
        client.start();
        realtime = {
            async close() {
                clearInterval(timer);
                await client.stop();
            },
        };
    }
}
server.listen(port, host, () => {
    const address = host === '::1' ? '[::1]' : host;
    console.log(`Backend: http://${address}:${port}/health`);
});
let stopping = false;
async function stop() {
    if (stopping) return;
    stopping = true;
    administration?.close();
    await realtime?.close();
    server.close((error) => {
        if (error) {
            console.error(error.message);
            process.exitCode = 1;
        }
    });
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
