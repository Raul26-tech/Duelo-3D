import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGiftCatalog, giftRuleKey } from '../scoring/catalog.ts';
import type { CatalogGiftRule } from '../scoring/contracts.ts';
import { record } from '../scoring/validation.ts';
import { providerId } from '../tiktok/normalize.ts';
import { readDiagnosticConfig } from '../tiktok/config.ts';

export type OperationMode = 'simulation' | 'observation' | 'real';
export type ReviewedGift = CatalogGiftRule &
    Readonly<{ delivery: 'single' | 'cumulative-final' }>;
export type RealConfig = Readonly<{
    mode: 'real';
    username: string;
    signApiKey?: string;
    roomId: string;
    filename: string;
    action: 'create' | 'resume';
    gifts: readonly ReviewedGift[];
    sourcePolicy: string;
}>;
const root = fileURLToPath(new URL('../../../../', import.meta.url));

export function parseReviewedCatalog(value: unknown): readonly ReviewedGift[] {
    if (!Array.isArray(value) || value.length > 1000)
        throw new Error('Invalid reviewed gift catalog');
    const stripped = value.map((entry: unknown) => {
        if (
            !record(entry) ||
            (entry.delivery !== 'single' &&
                entry.delivery !== 'cumulative-final')
        )
            throw new Error('Each gift needs reviewed delivery');
        const { delivery: _delivery, ...rule } = entry;
        if (
            rule.match !== 'exact-name' &&
            (typeof rule.giftId !== 'string' || !providerId(rule.giftId))
        )
            throw new Error('Each ID gift needs a real decimal ID');
        return rule;
    });
    if (new Set(stripped.map((rule) => rule.name)).size !== stripped.length)
        throw new Error('Ambiguous duplicate gift names');
    const catalog = createGiftCatalog(stripped);
    return Object.freeze(
        value
            .map(
                (entry, index) =>
                    Object.freeze({
                        ...catalog.get(
                            giftRuleKey(stripped[index] as CatalogGiftRule),
                        )!,
                        delivery: entry.delivery,
                    }) as ReviewedGift,
            )
            .sort((a, b) =>
                giftRuleKey(a) < giftRuleKey(b)
                    ? -1
                    : giftRuleKey(a) > giftRuleKey(b)
                      ? 1
                      : 0,
            ),
    );
}
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
    let gifts: readonly ReviewedGift[] = Object.freeze([]);
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
    });
}
