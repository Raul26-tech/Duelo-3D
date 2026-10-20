import { createServer } from 'node:http';

export function createBackendServer() {
    return createServer((request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (request.method === 'GET' && request.url === '/health') {
            response.writeHead(200);
            response.end(JSON.stringify({
                status: 'ok',
                service: 'duelo-3d-backend',
            }));
            return;
        }
        response.writeHead(404);
        response.end(JSON.stringify({ error: 'not_found' }));
    });
}

export function resolvePort(value: string | undefined): number {
    if (value === undefined) return 3000;
    if (!/^[0-9]+$/.test(value)) {
        throw new RangeError('PORT deve ser um inteiro entre 1 e 65535.');
    }
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new RangeError('PORT deve ser um inteiro entre 1 e 65535.');
    }
    return port;
}
