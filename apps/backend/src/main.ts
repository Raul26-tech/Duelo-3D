import { createBackendServer, getBackendConfig } from './server.ts';
import { loadOptionalEnv } from './environment.ts';

loadOptionalEnv();
const { port, host } = getBackendConfig();
const server = createBackendServer();
server.on('error', (error) => {
    console.error('Falha ao iniciar backend:', error.message);
    process.exitCode = 1;
});
server.listen(port, host, () => {
    const address = host === '::1' ? '[::1]' : host;
    console.log(`Backend: http://${address}:${port}/health`);
});
let stopping = false;
function stop() {
    if (stopping) return;
    stopping = true;
    server.close((error) => {
        if (error) {
            console.error(error.message);
            process.exitCode = 1;
        }
    });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
