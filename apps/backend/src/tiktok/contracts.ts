/** Observation contracts only: deliberately incompatible with scoring commands. */
export type EvidenceStatus =
    'candidate-unverified' | 'insufficient' | 'invalid';
export type Observation = Readonly<{
    schema: 1;
    provider: 'tiktok-live-connector@2.5.0';
    domain: 'observation';
    scoringEligible: false;
    kind: 'comment' | 'gift';
    status: EvidenceStatus;
    reasons: readonly string[];
    connectionRoomId: string | null;
    confirmed: Readonly<{
        roomId: string | null;
        eventId: string | null;
        userId: string | null;
        text: string | null;
        giftId: string | null;
        giftName: string | null;
        sequenceId: string | null;
        repeatCount: number | null;
        repeatEnd: 0 | 1 | null;
        giftType: number | null;
        combo: boolean | null;
    }>;
    inferred: Readonly<{
        delivery: 'individual-candidate' | 'combo-candidate' | 'unknown';
        phase: 'pending-candidate' | 'explicit-final-flag' | 'unknown';
    }>;
}>;

export type LifecycleState =
    | 'disabled'
    | 'idle'
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'stopping'
    | 'stopped';
export type LifecycleReason =
    | 'disabled'
    | 'connecting'
    | 'connected'
    | 'disconnected'
    | 'provider_error'
    | 'provider_failure'
    | 'room_changed'
    | 'connect_timeout'
    | 'cleanup_timeout'
    | 'retry_exhausted'
    | 'stream_ended'
    | 'operator_stop'
    | 'event_rate_limited';
export type ProviderEvent =
    'chat' | 'gift' | 'error' | 'disconnected' | 'streamEnd';
export interface ProviderClient {
    on(event: ProviderEvent, handler: (payload: unknown) => void): void;
    off(event: ProviderEvent, handler: (payload: unknown) => void): void;
    connect(): Promise<unknown>;
    disconnect(): Promise<void>;
}
export type Scheduler = (task: () => void, delayMs: number) => () => void;
