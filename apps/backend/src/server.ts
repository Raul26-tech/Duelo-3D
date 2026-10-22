import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from 'node:http';

export function createBackendServer(
    mode: 'simulation' | 'observation' | 'real' = 'simulation',
    fallback?: (request: IncomingMessage, response: ServerResponse) => boolean,
) {
    return createServer((request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (request.method === 'GET' && request.url === '/arena/mode') {
            response.setHeader('Cache-Control', 'no-store');
            response.writeHead(200);
            response.end(JSON.stringify({ mode }));
            return;
        }
        if (request.method === 'GET' && request.url === '/health') {
            response.writeHead(200);
            response.end(
                JSON.stringify({
                    status: 'ok',
                    service: 'duelo-3d-backend',
                }),
            );
            return;
        }
        if (fallback?.(request, response)) return;
        response.writeHead(404);
        response.end(JSON.stringify({ error: 'not_found' }));
    });
}

export function resolvePort(value: string | undefined): number {
    if (value === undefined) return 3000;
    if (!/^[0-9]+$/.test(value)) {
        throw new RangeError(
            'BACKEND_PORT deve ser um inteiro entre 1 e 65535.',
        );
    }
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new RangeError(
            'BACKEND_PORT deve ser um inteiro entre 1 e 65535.',
        );
    }
    return port;
}

export function resolveBackendHost(value: string | undefined): string {
    const host = value ?? '127.0.0.1';
    if (host !== '127.0.0.1' && host !== '::1') {
        throw new RangeError(
            'BACKEND_HOST deve ser 127.0.0.1 ou ::1 (somente loopback).',
        );
    }
    return host;
}

export function getBackendConfig(env: NodeJS.ProcessEnv = process.env) {
    return {
        port: resolvePort(env.BACKEND_PORT),
        host: resolveBackendHost(env.BACKEND_HOST),
    };
}
