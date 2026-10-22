import { parseReviewedCatalog, type ReviewedGift } from './gift-policy.ts';
export { parseReviewedCatalog, type ReviewedGift } from './gift-policy.ts';
import { parseExperimentManifest } from '../catalog-tools/experiment.ts';
import { readLocalJson } from '../local-json.ts';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerId } from '../tiktok/normalize.ts';
import { readDiagnosticConfig } from '../tiktok/config.ts';

export type OperationMode = 'simulation' | 'observation' | 'real';
export type RealConfig = Readonly<{
    mode: 'real';
    username: string;
    signApiKey?: string;
    roomId: string;
    filename: string;
    action: 'create' | 'resume';
    gifts: readonly ReviewedGift[];
    sourcePolicy: string;
    experiment?: Readonly<{ digest: string }>;
    runtimeReport?: Readonly<{ filename: string; durationMs: number }>;
}>;
const root = fileURLToPath(new URL('../../../../', import.meta.url));

export function readOperationMode(
    env: NodeJS.ProcessEnv = process.env,
): OperationMode {
    const mode = env.DUEL_MODE ?? 'simulation';
    if (!['simulation', 'observation', 'real'].includes(mode))
        throw new Error('DUEL_MODE must be simulation, observation or real');
    if (mode !== 'real' && env.TIKTOK_REAL_ENABLED === 'true')
        throw new Error('Real scoring requires DUEL_MODE=real');
    return mode as OperationMode;
}
export function readRealConfig(
    env: NodeJS.ProcessEnv = process.env,
): RealConfig {
    if (readOperationMode(env) !== 'real' || env.TIKTOK_REAL_ENABLED !== 'true')
        throw new Error(
            'Real scoring requires explicit DUEL_MODE=real and TIKTOK_REAL_ENABLED=true',
        );
    if (env.TIKTOK_DIAGNOSTIC_ENABLED === 'true')
        throw new Error('Choose real OR diagnostic observation');
    if (env.TIKTOK_IDENTITY_REVIEWED !== 'true')
        throw new Error(
            'Review occurrence identity for the pinned connector before real scoring',
        );
    const provider = readDiagnosticConfig({
        ...env,
        TIKTOK_DIAGNOSTIC_ENABLED: 'true',
    });
    const roomId = providerId(env.TIKTOK_ROOM_ID);
    if (!roomId)
        throw new Error(
            'TIKTOK_ROOM_ID must identify the reviewed transmission',
        );
    const action = env.TIKTOK_SESSION_ACTION;
    if (action !== 'create' && action !== 'resume')
        throw new Error(
            'TIKTOK_SESSION_ACTION must be create or resume explicitly',
        );
    if (!env.TIKTOK_DATABASE || !env.TIKTOK_DATABASE.startsWith('/'))
        throw new Error(
            'TIKTOK_DATABASE must be an absolute path outside the repository',
        );
    const experimental = env.TIKTOK_EXPERIMENTAL_ENABLED ?? 'false';
    if (experimental !== 'false' && experimental !== 'true')
        throw new Error('TIKTOK_EXPERIMENTAL_ENABLED must be true or false');
    if (experimental !== 'true' && env.TIKTOK_EXPERIMENT_MANIFEST)
        throw new Error(
            'Experimental manifest requires explicit experimental opt-in',
        );
    if (
        experimental === 'true' &&
        (!env.TIKTOK_EXPERIMENT_MANIFEST || env.TIKTOK_GIFT_CATALOG)
    )
        throw new Error(
            'Choose experimental manifest OR validated catalog explicitly',
        );
    let experiment: RealConfig['experiment'];
    let gifts: readonly ReviewedGift[] = Object.freeze([]);
    if (experimental === 'true') {
        const path = env.TIKTOK_EXPERIMENT_MANIFEST!;
        if (!path.startsWith('/'))
            throw new Error(
                'Experimental manifest must be an explicit absolute path',
            );
        const checked = parseExperimentManifest(readLocalJson(path));
        gifts = checked.manifest.rules;
        experiment = Object.freeze({ digest: checked.digest });
    }
    let runtimeReport: RealConfig['runtimeReport'];
    if (env.TIKTOK_RUNTIME_REPORT) {
        const minutes = env.TIKTOK_RUNTIME_REPORT_MINUTES ?? '35';
        if (
            !/^[0-9]+$/u.test(minutes) ||
            Number(minutes) < 1 ||
            Number(minutes) > 35 ||
            !env.TIKTOK_RUNTIME_REPORT.startsWith('/') ||
            !env.TIKTOK_RUNTIME_REPORT.endsWith('.json')
        )
            throw new Error(
                'Runtime report requires an external new JSON file and duration 1–35 minutes',
            );
        runtimeReport = Object.freeze({
            filename: env.TIKTOK_RUNTIME_REPORT,
            durationMs: Number(minutes) * 60000,
        });
    } else if (env.TIKTOK_RUNTIME_REPORT_MINUTES)
        throw new Error('Runtime report duration requires an output file');
    if (env.TIKTOK_GIFT_CATALOG) {
        const path = resolve(root, env.TIKTOK_GIFT_CATALOG);
        if (statSync(path).size > 65536)
            throw new Error('Gift catalog exceeds 64 KiB');
        gifts = parseReviewedCatalog(JSON.parse(readFileSync(path, 'utf8')));
    }
    const sourcePolicy = createHash('sha256')
        .update(
            JSON.stringify({
                provider: 'tiktok-live-connector@2.5.0',
                profile: gifts.some((gift) => gift.match !== undefined)
                    ? 'hybrid-v1-literal'
                    : 'v3-reviewed-identity-v1',
                username: provider.username,
                roomId,
                gifts,
                ...(experiment ? { experimental: experiment.digest } : {}),
            }),
        )
        .digest('hex');
    return Object.freeze({
        mode: 'real',
        username: provider.username,
        signApiKey: provider.signApiKey,
        roomId,
        filename: env.TIKTOK_DATABASE,
        action,
        gifts,
        sourcePolicy,
        ...(experiment ? { experiment } : {}),
        ...(runtimeReport ? { runtimeReport } : {}),
    });
}
