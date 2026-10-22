import { ADMIN_ORIGIN, isAdminEvent } from '../scoring/administration.ts';
import { exact, record, parseEvent } from '../scoring/validation.ts';
import type { Decision } from '../scoring/contracts.ts';
import type { openSqliteScoring } from '../persistence/sqlite.ts';
/** Trusted composition only; the network never submits a domain event. */
export function createAdministrationService(
    storage: ReturnType<typeof openSqliteScoring>,
    options: {
        roomId: string;
        assertAuthority: () => void;
        publish: (decision: Decision) => void;
        now?: () => Date;
    },
) {
    return {
        view() {
            options.assertAuthority();
            return storage.administrationView();
        },
        execute(operator: string, kind: 'award' | 'reversal', value: unknown) {
            options.assertAuthority();
            const fields =
                kind === 'award'
                    ? [
                          'operationId',
                          'sessionId',
                          'candidate',
                          'ruleId',
                          'quantity',
                          'justification',
                          'link',
                          'correctionOf',
                          'reconciliationConfirmed',
                      ]
                    : [
                          'operationId',
                          'sessionId',
                          'targetOperationId',
                          'justification',
                      ];
            if (!record(value) || !exact(value, fields))
                throw new Error('INVALID_REQUEST');
            const view = storage.administrationView();
            if (value.sessionId !== view.state.sessionId)
                throw new Error('SESSION_MISMATCH');
            // A retry reuses the persisted server timestamp; actor and all request fields still
            // participate in the fingerprint, including reversal-vs-award conflicts.
            const previous = view.operations.find(
                (op) => op.operationId === value.operationId,
            );
            const { operationId, ...body } = value;
            const event = parseEvent({
                ...body,
                origin: ADMIN_ORIGIN,
                roomId: options.roomId,
                domain: 'real',
                eventId: operationId,
                actorId: operator,
                type: kind === 'award' ? 'admin.award' : 'admin.reversal',
                adminVersion: 'admin-v1',
                at:
                    previous?.at ??
                    (options.now?.() ?? new Date()).toISOString(),
            });
            if (!event || !isAdminEvent(event))
                throw new Error('INVALID_REQUEST');
            const decision = storage.process(event); // COMMIT before publication; no mutable cached engine.
            if (decision.status === 'applied') options.publish(decision);
            return decision;
        },
    };
}
