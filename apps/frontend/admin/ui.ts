type Rule = { ruleId: string; name: string; candidate: string; points: number };
type Operation = {
    operationId: string;
    operatorId: string;
    at: string;
    type: string;
    candidate: string;
    ruleId: string;
    quantity: number;
    points: number;
    justification: string;
    reference: string | null;
    state: string;
    link: unknown;
};
type View = {
    state: {
        sessionId: string;
        version: number;
        scores: { lula: number; flavio: number };
    };
    connection: string;
    rules: Rule[];
    history: Operation[];
    total: number;
    possibleDuplicates: Operation[];
};
export function mountAdministration(
    doc: Document,
    transport: typeof fetch = fetch,
    newId = () => crypto.randomUUID(),
) {
    const el = <T extends HTMLElement = HTMLElement>(id: string) =>
        doc.getElementById(id) as T;
    const input = (id: string) => el<HTMLInputElement>(id);
    const form = (id: string) => el<HTMLFormElement>(id);
    let csrf = '',
        operator = '',
        view: View | undefined,
        page = 0,
        stopped = false,
        working = false;
    let pending:
        | { kind: 'award' | 'reversal'; body: Record<string, unknown> }
        | undefined;
    let target: string | undefined;
    const messages: Record<string, string> = {
        AUTHENTICATION_REQUIRED: 'Sessão encerrada. Autentique-se novamente.',
        INVALID_CREDENTIALS: 'Operador ou senha inválidos.',
        CSRF_DENIED: 'Sessão inválida. Entre novamente.',
        ORIGIN_DENIED: 'Origem administrativa não autorizada.',
        LOGIN_RATE_LIMIT: 'Limite de tentativas. Aguarde um minuto.',
        UNAUTHORIZED_RULE: 'Presente ou participante não autorizado.',
        INVALID_REQUEST: 'Verifique os campos, a quantidade e a justificativa.',
        SESSION_MISMATCH:
            'A disputa mudou. Atualize e reconcilie antes de enviar.',
        SOURCE_ALREADY_RECORDED:
            'A ocorrência ou sequência já está registrada. Reconciliação necessária.',
        SOURCE_ALREADY_CLAIMED:
            'Identidade já vinculada a um lançamento manual.',
        MANUAL_RECONCILIATION_REQUIRED:
            'Ocorrência reservada por lançamento administrativo.',
        IDENTITY_CONFLICT:
            'Identificador reutilizado com conteúdo diferente. Nenhum novo ponto aplicado.',
        ALREADY_REVERSED: 'Esta operação já foi estornada.',
        INVALID_CORRECTION:
            'A correção exige uma operação estornada e ainda não corrigida.',
        SCORE_LIMIT:
            'Limite numérico ou placar inválido. Nenhuma alteração aplicada.',
        CAPACITY_REACHED: 'Capacidade da disputa atingida.',
        ADMIN_UNAVAILABLE:
            'Administração indisponível. Consulte o estado antes de reenviar.',
    };
    function message(text: string, error = false) {
        el('message').textContent = text;
        el('message').classList.toggle('error', error);
    }
    function locked(value: boolean) {
        working = value;
        for (const id of ['award-submit', 'retry'])
            el<HTMLButtonElement>(id).disabled = value;
    }
    function logoutView() {
        csrf = '';
        operator = '';
        view = undefined;
        el('panel').hidden = true;
        el('logout').hidden = true;
        el('login').hidden = false;
        el('history').replaceChildren();
    }
    async function api(path: string, body?: unknown) {
        const response = await transport('/admin/api/' + path, {
            method: body === undefined ? 'GET' : 'POST',
            credentials: 'same-origin',
            headers: {
                'X-Admin-Request': '1',
                ...(body === undefined
                    ? {}
                    : {
                          'Content-Type': 'application/json',
                          'X-CSRF-Token': csrf,
                      }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const value = await response.json();
        if (response.status === 401 && path !== 'login') logoutView();
        return { response, value };
    }
    function rules() {
        if (!view) return;
        const previous = input('rule').value;
        el('rule').replaceChildren();
        for (const rule of view.rules.filter(
            (rule) => rule.candidate === input('candidate').value,
        )) {
            const option = doc.createElement('option');
            option.value = rule.ruleId;
            option.textContent = `${rule.name} · ${rule.points} pontos/unidade`;
            el('rule').append(option);
        }
        if (
            [...el<HTMLSelectElement>('rule').options].some(
                (option) => option.value === previous,
            )
        )
            input('rule').value = previous;
        el<HTMLButtonElement>('award-submit').disabled =
            working || !input('rule').value;
    }
    function render() {
        if (!view) return;
        el('lula').textContent = String(view.state.scores.lula);
        el('flavio').textContent = String(view.state.scores.flavio);
        el('session').textContent =
            `Disputa ${view.state.sessionId} · versão ${view.state.version}`;
        el('connection').textContent =
            `Painel conectado · fonte TikTok: ${view.connection}`;
        el('signed-in').textContent = `Operador: ${operator}`;
        rules();
        el('duplicates').textContent = view.possibleDuplicates.length
            ? `Revisar ${view.possibleDuplicates.length} lançamento(s) com mesma regra/quantidade. Isso não comprova equivalência. IDs: ${view.possibleDuplicates.map((op) => op.operationId).join(', ')}`
            : 'Sem correspondência na consulta por regra/quantidade. Isso não comprova ausência de duplicidade entre origens.';
        el('history').replaceChildren();
        for (const operation of view.history) {
            const row = doc.createElement('tr');
            for (const text of [
                `${operation.operationId}\n${new Date(operation.at).toLocaleString('pt-BR')}`,
                operation.operatorId,
                `${operation.candidate === 'lula' ? 'Lula' : 'Flávio'} / ${operation.ruleId}`,
                `${operation.quantity} / ${operation.points > 0 ? '+' : ''}${operation.points}`,
                `${operation.state === 'reversed' ? 'ESTORNADA' : operation.type === 'admin.reversal' ? 'ESTORNO' : 'APLICADA'}${operation.reference ? ' / ' + operation.reference : ''}${operation.link ? ' / vínculo declarado pelo operador' : ''}`,
                operation.justification,
            ]) {
                const cell = doc.createElement('td');
                cell.textContent = text;
                row.append(cell);
            }
            const actions = doc.createElement('td');
            if (operation.type === 'admin.award') {
                const button = doc.createElement('button');
                button.className = 'secondary';
                if (operation.state === 'applied') {
                    button.textContent = 'Estornar';
                    button.onclick = () => {
                        target = operation.operationId;
                        el('reverse-target').textContent = target;
                        el('reverse-box').hidden = false;
                        input('reverse-reason').value = '';
                        input('reverse-reason').focus();
                    };
                } else {
                    button.textContent = 'Preparar correção';
                    button.onclick = () => {
                        input('candidate').value = operation.candidate;
                        rules();
                        input('rule').value = operation.ruleId;
                        input('quantity').value = String(operation.quantity);
                        input('correction').value = operation.operationId;
                        input('justification').value = '';
                        input('reconciled').checked = false;
                        input('justification').focus();
                        message(
                            'Preencha a justificativa e reconcilie o novo lançamento vinculado.',
                        );
                    };
                }
                actions.append(button);
            }
            row.append(actions);
            el('history').append(row);
        }
        el('page').textContent = `Página ${page + 1} · ${view.total} operações`;
        el<HTMLButtonElement>('previous').disabled = page === 0;
        el<HTMLButtonElement>('next').disabled = (page + 1) * 50 >= view.total;
    }
    async function refresh() {
        if (!csrf || stopped) return;
        try {
            const query = new URLSearchParams({
                page: String(page),
                ruleId: input('rule').value,
                quantity: input('quantity').value,
            });
            const { response, value } = await api('state?' + query);
            if (!response.ok) {
                message(
                    messages[value.error] ?? 'Falha ao consultar estado.',
                    true,
                );
                return;
            }
            view = value;
            render();
        } catch {
            el('connection').textContent =
                'Painel desconectado · placar exibido pode estar desatualizado';
        }
    }
    async function submitPending() {
        if (!pending || working) return;
        const submission = pending;
        locked(true);
        try {
            const { response, value } = await api(
                submission.kind,
                submission.body,
            );
            if (!response.ok) {
                message(
                    messages[value.decision?.reason ?? value.error] ??
                        'Operação recusada. Consulte o histórico.',
                    true,
                );
            } else {
                message(
                    `${value.decision.status === 'duplicate' ? 'Operação já registrada, sem pontos adicionais.' : 'Operação confirmada no SQLite.'} ID: ${submission.body.operationId}`,
                );
                form('award-form').reset();
                input('correction').value = '';
                el('reverse-box').hidden = true;
            }
            if (
                response.ok ||
                response.status === 400 ||
                response.status === 409
            ) {
                pending = undefined;
                el('uncertain').hidden = true;
            } else {
                el('uncertain').hidden = false;
                el('pending-id').textContent =
                    `ID: ${submission.body.operationId}`;
            }
            await refresh();
        } catch {
            el('uncertain').hidden = false;
            el('pending-id').textContent = `ID: ${submission.body.operationId}`;
            message(
                'Resposta não recebida. O resultado pode já estar confirmado; use a mesma operação para consultar/repetir.',
                true,
            );
        } finally {
            locked(false);
        }
    }
    form('login-form').onsubmit = async (event) => {
        event.preventDefault();
        if (working) return;
        locked(true);
        try {
            const result = await api('login', {
                operator: input('operator').value,
                password: input('password').value,
            });
            input('password').value = '';
            if (!result.response.ok) {
                message(
                    messages[result.value.error] ?? 'Falha de autenticação.',
                    true,
                );
                return;
            }
            csrf = result.value.csrf;
            operator = result.value.operator;
            el('login').hidden = true;
            el('panel').hidden = false;
            el('logout').hidden = false;
            message('Sessão administrativa iniciada.');
            await refresh();
        } catch {
            input('password').value = '';
            message('Não foi possível autenticar.', true);
        } finally {
            locked(false);
        }
    };
    form('award-form').onsubmit = (event) => {
        event.preventDefault();
        if (!view || working) return;
        if (pending) {
            message(
                'Resolva a operação de resultado incerto antes de criar outra.',
                true,
            );
            return;
        }
        const sourceEvent = input('source-event').value,
            actor = input('source-actor').value,
            group = input('source-group').value;
        if ((sourceEvent || actor || group) && (!sourceEvent || !actor)) {
            message('Vínculo exige IDs de ocorrência e ator.', true);
            return;
        }
        pending = {
            kind: 'award',
            body: {
                operationId: newId(),
                sessionId: view.state.sessionId,
                candidate: input('candidate').value,
                ruleId: input('rule').value,
                quantity: Number(input('quantity').value),
                justification: input('justification').value,
                link: sourceEvent
                    ? {
                          eventId: sourceEvent,
                          actorId: actor,
                          sequenceId: group || null,
                      }
                    : null,
                correctionOf: input('correction').value || null,
                reconciliationConfirmed: input('reconciled').checked,
            },
        };
        void submitPending();
    };
    form('reverse-form').onsubmit = (event) => {
        event.preventDefault();
        if (!view || !target || working || pending) return;
        pending = {
            kind: 'reversal',
            body: {
                operationId: newId(),
                sessionId: view.state.sessionId,
                targetOperationId: target,
                justification: input('reverse-reason').value,
            },
        };
        void submitPending();
    };
    el('retry').onclick = () => void submitPending();
    el('refresh').onclick = () => void refresh();
    el('reverse-cancel').onclick = () => {
        el('reverse-box').hidden = true;
        target = undefined;
    };
    el('logout').onclick = async () => {
        try {
            await api('logout', {});
        } finally {
            logoutView();
            message('Sessão encerrada.');
        }
    };
    input('candidate').onchange = () => {
        rules();
        void refresh();
    };
    input('rule').onchange = () => void refresh();
    input('quantity').onchange = () => void refresh();
    el('previous').onclick = () => {
        if (page > 0) {
            page--;
            void refresh();
        }
    };
    el('next').onclick = () => {
        page++;
        void refresh();
    };
    void (async () => {
        try {
            const result = await api('session');
            if (result.response.ok) {
                csrf = result.value.csrf;
                operator = result.value.operator;
                el('login').hidden = true;
                el('panel').hidden = false;
                el('logout').hidden = false;
                await refresh();
            }
        } catch {
            /* Login remains available. */
        }
    })();
    const timer = doc.defaultView?.setInterval(() => void refresh(), 3000);
    return {
        close() {
            stopped = true;
            if (timer !== undefined) doc.defaultView?.clearInterval(timer);
        },
    };
}
