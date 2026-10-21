import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type UserConfig } from 'vite';

export function resolveFrontendPort(value: string | undefined): number {
    if (value === undefined) return 5173;
    if (!/^[0-9]+$/.test(value)) {
        throw new RangeError(
            'FRONTEND_PORT deve ser um inteiro entre 1 e 65535.',
        );
    }
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new RangeError(
            'FRONTEND_PORT deve ser um inteiro entre 1 e 65535.',
        );
    }
    return port;
}

export function createFrontendConfig(
    mode: string,
    configUrl: string | URL = import.meta.url,
): UserConfig {
    const root = fileURLToPath(new URL('.', configUrl));
    const envDir = fileURLToPath(new URL('../../', configUrl));
    const env = loadEnv(mode, envDir, 'FRONTEND_');
    const backend = loadEnv(mode, envDir, 'BACKEND_');
    const backendPort =
        process.env.BACKEND_PORT ?? backend.BACKEND_PORT ?? '3000';
    const backendHost =
        process.env.BACKEND_HOST ?? backend.BACKEND_HOST ?? '127.0.0.1';
    if (
        !/^[0-9]+$/.test(backendPort) ||
        Number(backendPort) < 1 ||
        Number(backendPort) > 65535
    ) {
        throw new Error('BACKEND_PORT inválida para proxy local.');
    }
    if (!['127.0.0.1', '::1'].includes(backendHost))
        throw new Error('BACKEND_HOST deve ser loopback.');
    const target = `http://${backendHost === '::1' ? '[::1]' : backendHost}:${backendPort}`;
    const proxy = {
        '/realtime': { target, ws: true, rewriteWsOrigin: false },
        '/arena': { target, ws: true, rewriteWsOrigin: false },
    };
    return {
        root,
        envDir,
        base: './',
        server: {
            host: '127.0.0.1',
            strictPort: true,
            proxy,
            port: resolveFrontendPort(
                process.env.FRONTEND_PORT ?? env.FRONTEND_PORT,
            ),
        },
    };
}

export default defineConfig(({ mode }) => createFrontendConfig(mode));
