import type { EventEmitter } from 'node:events';
import type { ProviderClient, ProviderEvent } from './contracts.ts';
import type { DiagnosticConfig } from './config.ts';

const packageName = 'tiktok-live-connector';
interface SdkClient extends EventEmitter {
    connect(): Promise<{ roomId: unknown }>;
    disconnect(): Promise<void>;
    wsClient: { terminate(): void } | null;
}
interface SdkBoundary {
    TikTokLiveConnection: new (
        username: string,
        options: Record<string, unknown>,
    ) => SdkClient;
    SignConfig: {
        apiKey?: string;
        basePath: string;
        baseOptions: Record<string, unknown>;
        cachedInstance?: unknown;
    };
    WebcastDeserializeConfig: {
        showBase64OnDecodeError: boolean;
        includeMessageTypes: string[] | null;
    };
}

/** Only this bridge imports the SDK. No SDK objects are passed to the logger. */
export async function createProviderFactory(
    config: DiagnosticConfig,
    load: () => Promise<unknown> = () => import(packageName),
): Promise<() => ProviderClient> {
    if (!config.enabled)
        throw new Error('Diagnostic must be explicitly enabled');
    if (
        process.env.DEBUG ||
        process.env.NODE_DEBUG ||
        process.env.DEBUG_DESERIALIZE_XD
    )
        throw new Error('Raw debug flags are not allowed');
    // Published declarations have NodeNext errors; validate a narrow runtime boundary instead
    // of disabling type checking for the rest of the backend.
    const value = await load();
    if (
        !value ||
        typeof value !== 'object' ||
        !('TikTokLiveConnection' in value) ||
        typeof value.TikTokLiveConnection !== 'function' ||
        !('SignConfig' in value) ||
        !value.SignConfig ||
        typeof value.SignConfig !== 'object' ||
        !('WebcastDeserializeConfig' in value) ||
        !value.WebcastDeserializeConfig ||
        typeof value.WebcastDeserializeConfig !== 'object'
    )
        throw new Error('Unsupported TikTok SDK exports');
    const { TikTokLiveConnection, SignConfig, WebcastDeserializeConfig } =
        value as SdkBoundary;
    const prototype = TikTokLiveConnection.prototype;
    if (
        !['connect', 'disconnect', 'on', 'off'].every(
            (key) => typeof prototype[key] === 'function',
        )
    )
        throw new Error('Unsupported TikTok SDK lifecycle');
    return () => {
        if (!config.enabled)
            throw new Error('Diagnostic must be explicitly enabled');
        process.env.DISABLE_ACK_LOG_WARNING = '1';
        WebcastDeserializeConfig.showBase64OnDecodeError = false;
        WebcastDeserializeConfig.includeMessageTypes = [
            'WebcastChatMessage',
            'WebcastGiftMessage',
            'WebcastControlMessage',
        ];
        const abort = new AbortController();
        // Standalone diagnostic process: isolate per-attempt signing client and abort its requests.
        SignConfig.apiKey = config.signApiKey;
        SignConfig.basePath = 'https://api.eulerstream.com';
        SignConfig.baseOptions = {
            ...SignConfig.baseOptions,
            timeout: 10_000,
            signal: abort.signal,
        };
        SignConfig.cachedInstance = undefined;
        const sdk = new TikTokLiveConnection(config.username, {
            processInitialData: false,
            fetchRoomInfoOnConnect: true,
            enableExtendedGiftInfo: false,
            authenticateWs: false,
            useMobile: false,
            webClientOptions: {
                timeout: { request: 10_000 },
                retry: { limit: 0 },
                signal: abort.signal,
            },
            wsClientOptions: {
                maxPayload: 1_048_576,
                handshakeTimeout: 10_000,
                perMessageDeflate: false,
            },
        });
        const emitter = sdk as unknown as EventEmitter;
        // EventEmitter's error event must remain handled during late asynchronous cleanup.
        emitter.on('error', () => {});
        let closed = false;
        const listeners = new Map<
            (payload: unknown) => void,
            (payload: unknown) => void
        >();
        async function disconnect() {
            closed = true;
            abort.abort();
            const closing = sdk.disconnect();
            sdk.wsClient?.terminate();
            await closing;
        }
        return {
            on(event: ProviderEvent, handler: (payload: unknown) => void) {
                const guarded = (payload: unknown) => {
                    if (!closed) handler(payload);
                };
                listeners.set(handler, guarded);
                emitter.on(event, guarded);
            },
            off(event: ProviderEvent, handler: (payload: unknown) => void) {
                const guarded = listeners.get(handler);
                if (guarded) emitter.off(event, guarded);
                listeners.delete(handler);
            },
            async connect() {
                if (closed) throw new Error('Diagnostic connection cancelled');
                const state = await sdk.connect();
                if (closed) {
                    await disconnect();
                    throw new Error('Diagnostic connection cancelled');
                }
                return { roomId: state.roomId };
            },
            disconnect,
        };
    };
}
