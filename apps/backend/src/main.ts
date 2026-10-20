import { createBackendServer, getBackendConfig } from './server.ts';
import { loadOptionalEnv } from './environment.ts';

loadOptionalEnv();
const { port, host } = getBackendConfig();
const server = createBackendServer();
server.on('error', (error) => {
    console.error('Falha ao iniciar backend:', error.message);
    process.exitCode = 1;
});
let realtime: { close(): void } | undefined;
if (process.env.NODE_ENV === 'development' && process.env.SIMULATION_MODE === 'true') {
    const { readSimulationConfig } = await import('./realtime/config.ts');
    const { attachRealtime } = await import('./realtime/server.ts');
    const config = readSimulationConfig();
    realtime = attachRealtime(server, config);
    console.log('SIMULAÇÃO LOCAL: autorize a arena com a chave do operador.');
    if (config.generatedToken) console.log('Chave temporária da simulação:', config.token);
    else console.log('Use a SIMULATION_TOKEN configurada no .env/terminal.');
}
server.listen(port, host, () => {
    const address = host === '::1' ? '[::1]' : host;
    console.log(`Backend: http://${address}:${port}/health`);
});
let stopping = false;
function stop() {
    if (stopping) return;
    stopping = true;
    realtime?.close();
    server.close((error) => {
        if (error) {
            console.error(error.message);
            process.exitCode = 1;
        }
    });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
