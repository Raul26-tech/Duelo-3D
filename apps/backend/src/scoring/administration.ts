import type { Candidate, Identity } from './contracts.ts';
import { record, exact, normalizeId } from './validation.ts';
export const ADMIN_ORIGIN = 'duelo-admin:local-v1';
export type SourceLink = Readonly<{
    eventId: string;
    actorId: string;
    sequenceId: string | null;
}>;
type Common = Identity &
    Readonly<{
        domain: 'real';
        adminVersion: 'admin-v1';
        sessionId: string;
        at: string;
        justification: string;
        /** Server-derived journal result, never accepted from an HTTP command. */
        appliedPoints?: number;
    }>;
export type AdminAward = Common &
    Readonly<{
        type: 'admin.award';
        candidate: Candidate;
        ruleId: string;
        quantity: number;
        link: SourceLink | null;
        correctionOf: string | null;
        reconciliationConfirmed: true;
    }>;
export type AdminReversal = Common &
    Readonly<{ type: 'admin.reversal'; targetOperationId: string }>;
export type AdminEvent = AdminAward | AdminReversal;
export type AuditOperation = Readonly<{
    operationId: string;
    operatorId: string;
    at: string;
    type: AdminEvent['type'];
    candidate: Candidate;
    ruleId: string;
    quantity: number;
    points: number;
    justification: string;
    reference: string | null;
    link: SourceLink | null;
    state: 'applied' | 'reversed';
    version: number;
}>;
export const operationId = (value: unknown): value is string =>
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        value,
    );
export const isAdminEvent = (event: { type: string }): event is AdminEvent =>
    event.type === 'admin.award' || event.type === 'admin.reversal';
const decimal = (v: unknown): v is string =>
    typeof v === 'string' && /^[1-9][0-9]{0,127}$/u.test(v);
export function parseAdminEvent(
    value: Record<string, unknown>,
): AdminEvent | null {
    const common = [
        'origin',
        'roomId',
        'domain',
        'eventId',
        'actorId',
        'type',
        'adminVersion',
        'sessionId',
        'at',
        'justification',
        ...(Object.hasOwn(value, 'appliedPoints') ? ['appliedPoints'] : []),
    ];
    if (
        !isAdminEvent(value as { type: string }) ||
        value.origin !== ADMIN_ORIGIN ||
        value.domain !== 'real' ||
        !normalizeId(value.roomId) ||
        !operationId(value.eventId) ||
        typeof value.actorId !== 'string' ||
        !/^[a-zA-Z0-9_.-]{3,64}$/u.test(value.actorId) ||
        value.adminVersion !== 'admin-v1' ||
        (Object.hasOwn(value, 'appliedPoints') &&
            (typeof value.appliedPoints !== 'number' ||
                !Number.isSafeInteger(value.appliedPoints))) ||
        typeof value.sessionId !== 'string' ||
        !normalizeId(value.sessionId) ||
        typeof value.at !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value.at) ||
        !Number.isFinite(Date.parse(value.at)) ||
        new Date(value.at).toISOString() !== value.at ||
        typeof value.justification !== 'string' ||
        value.justification.trim().length < 10 ||
        value.justification.length > 1000 ||
        /[\u0000-\u001f\u007f]/u.test(value.justification)
    )
        return null;
    const base = {
        origin: ADMIN_ORIGIN,
        roomId: normalizeId(value.roomId)!,
        domain: 'real' as const,
        eventId: value.eventId,
        actorId: value.actorId,
        adminVersion: 'admin-v1' as const,
        sessionId: value.sessionId as string,
        at: value.at,
        justification: value.justification,
        ...(Object.hasOwn(value, 'appliedPoints')
            ? { appliedPoints: value.appliedPoints as number }
            : {}),
    };
    if (value.type === 'admin.reversal')
        return exact(value, [...common, 'targetOperationId']) &&
            operationId(value.targetOperationId)
            ? {
                  ...base,
                  type: 'admin.reversal',
                  targetOperationId: value.targetOperationId,
              }
            : null;
    if (
        !exact(value, [
            ...common,
            'candidate',
            'ruleId',
            'quantity',
            'link',
            'correctionOf',
            'reconciliationConfirmed',
        ]) ||
        (value.candidate !== 'lula' && value.candidate !== 'flavio') ||
        typeof value.ruleId !== 'string' ||
        !normalizeId(value.ruleId) ||
        typeof value.quantity !== 'number' ||
        !Number.isSafeInteger(value.quantity) ||
        value.quantity <= 0 ||
        value.reconciliationConfirmed !== true ||
        !(value.correctionOf === null || operationId(value.correctionOf))
    )
        return null;
    let link: SourceLink | null = null;
    if (value.link !== null) {
        if (
            !record(value.link) ||
            !exact(value.link, ['eventId', 'actorId', 'sequenceId']) ||
            !decimal(value.link.eventId) ||
            !decimal(value.link.actorId) ||
            !(value.link.sequenceId === null || decimal(value.link.sequenceId))
        )
            return null;
        link = {
            eventId: value.link.eventId,
            actorId: value.link.actorId,
            sequenceId: value.link.sequenceId,
        };
    }
    return {
        ...base,
        type: 'admin.award',
        candidate: value.candidate,
        ruleId: value.ruleId,
        quantity: value.quantity,
        link,
        correctionOf: value.correctionOf,
        reconciliationConfirmed: true,
    };
}
