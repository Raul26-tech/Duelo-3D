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
    return {
        root,
        envDir,
        base: './',
        server: {
            host: '127.0.0.1',
            strictPort: true,
            port: resolveFrontendPort(
                process.env.FRONTEND_PORT ?? env.FRONTEND_PORT,
            ),
        },
    };
}

export default defineConfig(({ mode }) => createFrontendConfig(mode));
