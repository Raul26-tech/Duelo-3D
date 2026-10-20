import { createBackendServer, resolvePort } from './server.ts';

const port = resolvePort(process.env.PORT);
const server = createBackendServer();
server.on('error', (error) => {
    console.error('Falha ao iniciar backend:', error.message);
    process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
    console.log(`Backend: http://127.0.0.1:${port}/health`);
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
