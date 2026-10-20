import { loadOptionalEnv } from './environment.ts';

loadOptionalEnv();
// Entrypoint explícito de desenvolvimento; .env/terminal podem desabilitar.
process.env.NODE_ENV ??= 'development';
process.env.SIMULATION_MODE ??= 'true';
await import('./main.ts');
