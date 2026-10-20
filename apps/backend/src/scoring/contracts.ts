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
    points: 5 | 10 | 20 | 50 | 100;
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
