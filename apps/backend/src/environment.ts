import { loadEnvFile } from 'node:process';

export function loadOptionalEnv(path = '.env'): void {
    try {
        // Carregamento em runtime: não registra .env como alvo do --watch.
        // A API nativa preserva variáveis já definidas no terminal.
        loadEnvFile(path);
    } catch (error) {
        if (
            !(error instanceof Error) ||
            !('code' in error) ||
            error.code !== 'ENOENT'
        ) {
            throw error;
        }
    }
}
