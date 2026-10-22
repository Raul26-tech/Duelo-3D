/** Server-internal contracts. These are not browser commands or platform payloads. */
export type Candidate = 'lula' | 'flavio';
export type RulesVersion = 'scoring-v1' | 'scoring-v2';
export const CURRENT_RULES_VERSION: RulesVersion = 'scoring-v2';
export type Domain = 'simulation' | 'observation' | 'real';
export type Identity = Readonly<{
    origin: string;
    roomId: string;
    domain: Domain;
    eventId: string;
    /** Required for real source attribution; never supplied by browser commands. */
    actorId?: string;
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
        /** Hybrid v1 journal extension: actual provider ID above, authorized rule below. */
        giftPolicy?: 'hybrid-v1';
        giftName?: string | null;
        giftRuleId?: string | null;
        delivery: GiftDelivery;
    }>;
export type ScoringEvent = CommentEvent | GiftEvent;
export type GiftRule = Readonly<{
    giftId: string;
    name: string;
    candidate: Candidate;
    points: number;
}>;
export type CatalogGiftRule =
    | (GiftRule & Readonly<{ match?: 'id' }>)
    | Readonly<{
          match: 'exact-name';
          ruleId: string;
          giftId?: never;
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
    rulesVersion: RulesVersion;
    sourcePolicy?: string;
    catalog: readonly CatalogGiftRule[];
}>;
export type EngineCheckpoint = Readonly<{
    configuration: EngineConfiguration;
    state: Snapshot;
    events: readonly Readonly<{ identity: string; fingerprint: string }>[];
    sequences: readonly Readonly<{
        identity: string;
        giftId: string;
        actorId?: string;
        quantity: number;
        final: boolean;
        invalid: boolean;
    }>[];
}>;
