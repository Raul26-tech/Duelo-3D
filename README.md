# Duelo 3D Live — simulação, observação e disputa persistida

Enquete informal de entretenimento, sem vínculo com votação eleitoral oficial ou pesquisa representativa.

O monorepo usa npm workspaces: apps/frontend (Vite/TypeScript/arena) e apps/backend (Node/TypeScript ESM/HTTP, WebSocket e SQLite). O backend é a única autoridade do placar. Há três modos exclusivos: `simulation` (padrão, sem TikTok), `observation` (diagnóstico sem pontos) e `real` (TikTok → motor existente → commit SQLite → arena somente leitura). O modo real exige ativação explícita, revisão de identidade, transmissão e disputa persistida; presentes começam desligados com catálogo vazio.

Configuração, contratos, recuperação, limitações e procedimento controlado: [docs/tiktok-scoring-integration.md](docs/tiktok-scoring-integration.md). Resultados executados: [docs/validacao-tiktok-scoring.md](docs/validacao-tiktok-scoring.md).

## Executar juntos

Node >=24.15.0 dentro da linha 24 e npm 11+.

```bash
npm ci
npm run dev
```

O .env na raiz é opcional; veja .env.example. Os padrões são FRONTEND_PORT=5173, BACKEND_PORT=3000 e BACKEND_HOST=127.0.0.1.

1. Abra http://127.0.0.1:5173.
2. Copie a chave temporária exibida no terminal do backend.
3. Clique em Autorizar simulação e cole a chave.
4. Use os botões existentes. Outras abas autorizadas recebem o mesmo placar.
5. Ctrl+C encerra os serviços no Ubuntu.

O entrypoint dev habilita explicitamente a simulação local, salvo SIMULATION_MODE=false. Fora de NODE_ENV=development, ela permanece desabilitada. npm start --workspace backend não habilita simulação por padrão.

Pode-se configurar SIMULATION_TOKEN no .env central, sem prefixo VITE_. Ela não é exposta pelo Vite nem enviada na URL; o operador informa a chave à aba, que a mantém apenas em memória. Variáveis do terminal têm prioridade. Não publique o .env.

```bash
SIMULATION_MODE=false npm run dev
FRONTEND_PORT=5200 BACKEND_PORT=3001 npm run dev
```

Use a URL 127.0.0.1 na porta do frontend. Origin, chave e modo são validados; acesso à porta local sozinho não autoriza comandos. Frontend mantém strictPort: uma porta ocupada causa erro.

## Build, testes e execução individual

```bash
npm run build
npm test
npm run check:media
npm run format:check

npm run dev:frontend
npm run dev:backend

# Após build: HTTP técnico; o modo real ainda exige configuração explícita
npm start --workspace backend
curl --fail http://127.0.0.1:3000/health
```

npm run build gera apps/frontend/dist e apps/backend/dist. Preview continua disponível, mas o proxy/origem de simulação é configurado para o Vite dev nesta fase. Não há deploy.

Prettier 3.9.10 permanece na raiz; npm run format altera os arquivos ativos. Documentos históricos e vídeos permanecem excluídos da formatação.

## Estado, reconexão e limites

Na simulação WebSocket experimental, sessão e placar continuam exclusivamente em memória. Reiniciar o backend reinicia a sessão e, sem token fixo, gera outra chave.

Votos são sempre +1, validados e deduplicados pelo servidor. Reset é autorizado e não limpa identidades já aplicadas. A sessão aceita até 4096 comandos distintos e rejeita novos quando atinge o limite; não reaplica comandos descartados de cache.

A conexão usa snapshot, versão monotônica, descarte de sockets/sessões antigas e reconexão automática com backoff até 8 s. Votos de resultado incerto não são reenviados. Enquanto desconectado, o último placar pode permanecer visível, claramente indicado como possivelmente desatualizado; não há pontuação offline.

Arquitetura, contratos, limites, exemplos e segurança: [docs/realtime-simulation.md](docs/realtime-simulation.md).

## Motor de regras — Fase 3

`apps/backend/src/scoring` interpreta comentários com um único candidato, valida presentes pelo catálogo do servidor e controla identidades e combos acumulados. O catálogo padrão é vazio; dados sintéticos existem somente nos testes. Para novas disputas (`scoring-v2`), comentários reconhecem `Lula`/`13` ou `Flávio`/`Flavio`/`22`, sempre no máximo um ponto; menções aos dois participantes não pontuam. Disputas persistidas com `scoring-v1` conservam as regras anteriores, inclusive na continuação, sem recálculo retroativo. Presentes, combos e capacidade mantêm suas regras. A compatibilidade do replay e os testes dos aliases estão documentados em [docs/validacao-comment-aliases.md](docs/validacao-comment-aliases.md). O domínio real exige opt-in interno do servidor; payloads não podem habilitá-lo.

A simulação WebSocket existente permanece preservada. No modo real, somente callbacks da conexão TikTok autorizada entram no motor; o navegador recebe snapshots/atualizações e não pode votar ou reinicializar a disputa.

Contratos, limites, política de finalização de combos e exemplos: [docs/scoring-engine.md](docs/scoring-engine.md).

## Validação da Fase 3

Veja [docs/validacao-scoring-engine.md](docs/validacao-scoring-engine.md) para os comandos executados e suas limitações. Os 38 testes existentes foram preservados; o motor acrescenta testes unitários e de integridade. HTML, CSS, transporte, animações e seis WebM não são alterados por esta fase.

## Persistência transacional — Fase 4

`apps/backend/src/persistence` acrescenta armazenamento SQLite local ao motor de regras. Cada processamento usa transação, recuperação pelo mesmo motor e verificação integral antes de devolver o estado comitado. Identidades, fingerprints, combos, sessão, placar e versão são persistidos juntos. Dados ausentes/inconsistentes bloqueiam a retomada.

Biblioteca: better-sqlite3 12.10.1, validada com Node 24.15.0. O banco padrão fica em `~/.local/state/duelo-3d/scoring.sqlite`, fora do repositório; criação e retomada são operações explícitas da API interna. `npm run dev` no modo padrão continua iniciando a simulação existente sem criar banco. Somente o modo real explicitamente configurado abre a disputa SQLite selecionada.

Arquitetura, esquema, exemplo e recuperação: [docs/scoring-persistence.md](docs/scoring-persistence.md). Resultados e limitações: [docs/validacao-scoring-persistence.md](docs/validacao-scoring-persistence.md).

## TikTok LIVE — diagnóstico da Fase 5.1

Adaptador independente, com `tiktok-live-connector@2.5.0`, somente para observação. Desligado por padrão; não altera placar, SQLite, simulação ou arena. Eventos normalizados nunca são elegíveis para pontuação nesta fase.

```bash
# Padrão seguro: termina desligado, sem conectar
TIKTOK_DIAGNOSTIC_ENABLED=false npm run diagnose:tiktok
```

Para diagnóstico real posterior, configurar opt-in e handle no `.env` central e executar o mesmo comando em terminal dedicado. A execução é limitada a cinco minutos e possui logs pseudonimizados e encerramento por Ctrl+C. `npm run dev` no modo padrão continua independente do conector. O modo `observation` explícito também permite diagnóstico junto aos serviços, sem placar; o comando dedicado continua limitado a cinco minutos.

Contratos, campos inspecionados, incertezas de combos, serviço de assinatura e roteiro de LIVE: [docs/tiktok-live-diagnostic.md](docs/tiktok-live-diagnostic.md). Resultados: [docs/validacao-tiktok-diagnostic.md](docs/validacao-tiktok-diagnostic.md). Nenhuma LIVE foi validada nesta entrega.

## Modos da Fase 5.2

`DUEL_MODE=simulation npm run dev` preserva a simulação. Para diagnóstico junto aos serviços, use `DUEL_MODE=observation`, `TIKTOK_DIAGNOSTIC_ENABLED=true` e a conta configurada na raiz. Não há pontuação nesse modo.

Para uma disputa real autorizada, configure as variáveis documentadas no `.env.example`, incluindo `DUEL_MODE=real`, `TIKTOK_REAL_ENABLED=true`, identidade revisada, conta, sala, banco e ação `create` ou `resume`. Depois execute `npm run dev`. O `.env` nunca vai para o navegador. Não habilite real apenas para experimentar a instalação; primeiro siga o roteiro de revisão e teste controlado. Não foram enviados comentários ou presentes, nem iniciada uma LIVE durante a implementação.

O catálogo é um JSON externo opcional; `config/gift-catalog.example.json` começa com `[]`. Cada entrada exige identificação autorizada por ID confirmado ou nome exato, participante, inteiro positivo seguro e entrega revisada. Não há associações predefinidas. Bancos e logs devem ficar fora do projeto. Reinícios exigem `resume`, mesmo contexto e mesma política; recuperação insegura bloqueia o processamento. Não existe reset ou administração de disputa real pela arena.

## Preparação e identificação de presentes — Fases 5.3/5.4

A referência dos 14 presentes está em `config/gift-catalog.reference.json`: seis IDs confirmados conforme relato do operador e oito itens preparados para identificação por nome exato; seus IDs antigos são somente históricos. Nenhum tem entrega revisada ou aprovação automática. O catálogo operacional inicial permanece `[]`, sem alterar modo real ou disputas existentes.

Use `npm run catalog:gifts -- list`, `template`, `validate`, `prepare` e `verify` para a revisão local e geração exclusiva de arquivo novo. O diagnóstico existente possui um relatório agregado opcional de presentes, sem pontuação e sem dados pessoais. Procedimentos, campos e limitações: [docs/gift-catalog-validation.md](docs/gift-catalog-validation.md).

A identificação híbrida e sua ativação controlada estão em [docs/gift-hybrid-identification.md](docs/gift-hybrid-identification.md). A CLI mantém revisões legadas por ID e prepara novos itens `id`/`exact-name` sem aprová-los automaticamente. Há 14 presentes preparados e zero autorizados por padrão. Entrega validada é requisito separado; nomes literais não dispensam identidade, deduplicação ou finalização. Catálogos novos não são aplicados a disputas antigas silenciosamente.
