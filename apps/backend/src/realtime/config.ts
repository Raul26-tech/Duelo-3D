import { randomBytes } from 'node:crypto';

export function readSimulationConfig(env: NodeJS.ProcessEnv = process.env) {
    const enabled = env.NODE_ENV === 'development' && env.SIMULATION_MODE === 'true';
    const rawPort = env.FRONTEND_PORT ?? '5173';
    if (!/^[0-9]+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
        throw new Error('FRONTEND_PORT inválida para a origem da simulação.');
    }
    const configured = env.SIMULATION_TOKEN;
    if (configured !== undefined && !/^[A-Za-z0-9_-]{32,128}$/.test(configured)) {
        throw new Error('SIMULATION_TOKEN deve conter 32 a 128 caracteres alfanuméricos, _ ou -.');
    }
    return {
        enabled,
        origin: `http://127.0.0.1:${Number(rawPort)}`,
        token: configured ?? randomBytes(32).toString('base64url'),
        generatedToken: configured === undefined,
    };
}
