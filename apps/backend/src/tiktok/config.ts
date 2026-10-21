export type DiagnosticConfig = Readonly<{
    enabled: boolean;
    username: string;
    signApiKey?: string;
}>;
export function readDiagnosticConfig(
    env: NodeJS.ProcessEnv = process.env,
): DiagnosticConfig {
    const enabled = env.TIKTOK_DIAGNOSTIC_ENABLED ?? 'false';
    if (enabled !== 'false' && enabled !== 'true')
        throw new Error('TIKTOK_DIAGNOSTIC_ENABLED must be true or false');
    if (enabled === 'false')
        return Object.freeze({ enabled: false, username: '' });
    if (env.NODE_ENV === 'test')
        throw new Error('Real TikTok diagnostic is disabled in NODE_ENV=test');
    if (env.DEBUG || env.NODE_DEBUG || env.DEBUG_DESERIALIZE_XD)
        throw new Error(
            'Disable raw debug environment flags before TikTok diagnostic',
        );
    const username = env.TIKTOK_USERNAME ?? '';
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.]{0,23}$/.test(username))
        throw new Error('TIKTOK_USERNAME must be a handle without @ or URL');
    const signApiKey = env.TIKTOK_SIGN_API_KEY;
    if (
        signApiKey !== undefined &&
        (signApiKey.length < 1 ||
            signApiKey.length > 512 ||
            /[\u0000-\u0020\u007f]/u.test(signApiKey))
    )
        throw new Error('Invalid optional TIKTOK_SIGN_API_KEY');
    return Object.freeze({ enabled: true, username, signApiKey });
}
