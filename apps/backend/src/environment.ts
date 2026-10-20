import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// src/ e dist/ ocupam a mesma profundidade dentro do workspace.
export function resolveRootEnvPath(moduleUrl: string | URL = import.meta.url) {
    return fileURLToPath(new URL('../../../.env', moduleUrl));
}

export function loadOptionalEnv(path = resolveRootEnvPath()): void {
    try {
        // Runtime: .env ausente não é passado à CLI nem ao watcher.
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
