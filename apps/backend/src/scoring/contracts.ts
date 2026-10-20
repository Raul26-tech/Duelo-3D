/** Server-internal contracts. These are not browser commands or platform payloads. */
export type Candidate = 'lula' | 'flavio';
export type Domain = 'simulation' | 'observation';
export type Identity = Readonly<{
    origin: string;
    roomId: string;
    domain: Domain;
    eventId: string;
}>;
export type CommentEvent = Identity &
    Readonly<{ type: 'comment'; text: string }>;
export type GiftDelivery =
    | Readonly<{ kind: 'single'; quantity: 1 }>
    | Readonly<{
          kind: 'combo';
          sequenceId: string;
          quantity: number;
          final: boolean;
      }>;
export type GiftEvent = Identity &
    Readonly<{
        type: 'gift';
        giftId: string;
        delivery: GiftDelivery;
    }>;
export type ScoringEvent = CommentEvent | GiftEvent;
export type GiftRule = Readonly<{
    giftId: string;
    name: string;
    candidate: Candidate;
    points: number;
}>;
export type Snapshot = Readonly<{
    sessionId: string;
    domain: Domain;
    version: number;
    scores: Readonly<Record<Candidate, number>>;
}>;
export type Decision = Readonly<{
    status: 'applied' | 'ignored' | 'rejected' | 'duplicate';
    reason: string;
    identity?: string;
    candidate?: Candidate;
    points: number;
    state: Snapshot;
}>;

/** Library-neutral, complete state for verification by a persistence coordinator. */
export type EngineConfiguration = Readonly<{
    origin: string;
    roomId: string;
    domain: Domain;
    capacity: number;
    catalog: readonly GiftRule[];
}>;
export type EngineCheckpoint = Readonly<{
    configuration: EngineConfiguration;
    state: Snapshot;
    events: readonly Readonly<{ identity: string; fingerprint: string }>[];
    sequences: readonly Readonly<{
        identity: string;
        giftId: string;
        quantity: number;
        final: boolean;
        invalid: boolean;
    }>[];
}>;
