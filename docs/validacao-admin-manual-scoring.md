# Validação — Fase 5.5

## Base e resultados

PR #10 confirmado como integrado e branch remota `feat/admin-manual-scoring` inspecionada antes de alterações. Tanto a branch quanto a main estavam em `ab1abbee1f9b1b103c3798dfefe2ba2446518b9d`, sem commits adicionais ou conflitos. Os 113 arquivos da base foram materializados por objetos Git e comparados por hash. Linha de base executada antes da implementação: **268/268 testes aprovados**.

Ambiente: Linux, **Node.js 24.15.0**, npm 11.9.0. Nenhuma dependência adicionada; package-lock preservado.

| Comando/verificação executada   | Resultado                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm ci`                        | aprovado, 162 pacotes instalados                                                              |
| `npm audit`                     | zero vulnerabilidades reportadas                                                              |
| `npm run build`                 | arena, administração, backend e tipos dos testes aprovados                                    |
| `npm test`                      | **292/292**: 26 frontend + 266 backend                                                        |
| `npm run check:media`           | seis vídeos íntegros, mesmos objetos Git                                                      |
| `npm run format:check`          | aprovado                                                                                      |
| `npm run dev`                   | arena, health e seis vídeos HTTP 200; administração desligada não abriu porta                 |
| Ctrl+C                          | processos encerrados e portas fechadas                                                        |
| Bundle administrativo compilado | login, painel autenticado, CSS/JS e APIs HTTP 200                                             |
| Fluxo offline compilado         | dois lançamentos (26 + 2), estorno de 26 e recuperação SQLite com três operações e placar 0/2 |

O fluxo compilado é **sintético, com provedor falso**. Não é uma nova validação em LIVE e não deve ser confundido com os 28 pontos reais informados pelo operador na Fase 5.4. Bancos e credenciais dos testes são temporários e foram removidos. Nenhuma conta LIVE, captura privada ou banco operacional foi utilizado.

A instalação emite o aviso da configuração `http-proxy` do ambiente e a depreciação transitiva de `prebuild-install`; não houve EBADENGINE. O proxy do ambiente intercepta loopback diferente de 127.0.0.1 por padrão; os testes HTTP administrativos utilizam o cliente nativo com `agent:false` para acessar diretamente 127.0.0.2. As verificações são feitas contra o servidor real, sem substituir suas respostas.

## Cobertura nova

Os 268 testes anteriores permanecem intactos e aprovados. Foram adicionados **24 testes**: 20 no backend e quatro no frontend.

Backend cobre autenticação/acesso negado, sessão/expiração/rotação/logout, cookie host-only, origem, CSRF, limite de login, senha/hash/arquivo privado e CLI sem eco; validação estrita de requisições, presente não autorizado, participante divergente, quantidade e overflow; autoria/data/justificativa/resultado persistido; UUID/fingerprint, conflitos entre operadores/tipos e requisições concorrentes; estorno integral, estorno duplo e correção vinculada; rollback SQL, falha de publicação e retomada; evidências de origem já processadas, reservas e reconciliação; corrupção de auditoria; catálogo/contexto incompatível e fixture histórica com preservação de fingerprints e combo pendente.

O fluxo integrado autentica por HTTP, registra lançamento e estorno, verifica o commit no SQLite antes da publicação, força falha de transporte, recupera snapshot e confirma que retry não publica/pontua novamente. A arena recusa escrita administrativa e seu servidor retorna 404 para APIs administrativas.

Frontend cobre autenticação antes de mostrar dados, requisição sem pontos/autoria escolhidos pelo navegador, CSRF, mesma operação preservada após falha de rede, histórico sem injeção HTML e preparação de correção. Um servidor Vite real confirma que `/admin/`, `/admin-dist/` e acesso via `@fs` não entregam o painel pelo endereço público.

## Persistência e compatibilidade

Não foi necessária migração física. Schema e adaptador SQLite permanecem idênticos à base (SCHEMA_VERSION 2, quatro tabelas existentes). Eventos próprios admin-v1 são acrescentados ao journal pelo coordenador; o resultado `appliedPoints` é derivado no motor e persistido na mesma transação, com verificação no replay. Auditoria e reservas são projeções desse journal. Nenhum evento antigo, fingerprint, catálogo ou política é reescrito. Comentários v1/v2 continuam com a interpretação original.

A fixture fixa da Fase 5.4 foi recuperada, recebeu operação administrativa e foi retomada; o combo anteriormente pendente continuou sem alteração de identidade. As fixtures anteriores v1/schema 1 e 2 também seguem passando nos testes existentes. Depois de gravar admin-v1, um binário anterior à Fase 5.5 não deve ser utilizado no banco; a extensão de dados é explícita e não é compreendida por ele.

O teste de rollback força um erro SQLite e comprova ausência de lançamento, identidade ou placar parcial. O de auditoria altera uma justificativa no journal e confirma bloqueio da recuperação. Auditoria não é uma prova externa assinada contra alguém com controle do SO; o limite está documentado.

## Preservação e arquivos

Foram alterados 14 arquivos existentes e criados 16. Os **99 arquivos restantes da base** permanecem idênticos por hash, incluindo HTML/CSS/fontes da arena, seis WebM, regras de comentários, catálogo de referência e operacional vazio, normalização/conector TikTok, autorização/protocolo WebSocket, adaptador/schema SQLite, fixtures e testes anteriores e package-lock.

Modificados: `.env.example`, `.gitignore`, `README.md`, `package.json`; `apps/backend/package.json`, `src/main.ts`, `src/integration/runtime.ts`, `src/persistence/coordinator.ts`, `src/scoring/contracts.ts`, `engine.ts`, `validation.ts`; `apps/frontend/package.json`, `tsconfig.json`, `vite.config.ts`.

Criados: quatro módulos em `apps/backend/src/admin/`, `apps/backend/src/scoring/administration.ts`, `apps/backend/tests/administration.test.ts`; seis arquivos em `apps/frontend/admin/`, `apps/frontend/tests/administration.test.ts`, `apps/frontend/vite.admin.config.ts`; `docs/admin-manual-scoring.md` e este relatório.

O Vite público recebeu somente configuração de isolamento dos diretórios administrativos; o bundle da arena manteve os mesmos nomes/hashes de assets no build. Binários serão herdados da árvore Git, sem reenvio Base64. Não são publicados admin-dist, bancos, credenciais, arquivos .env reais, logs ou catálogos privados.

## Limitações operacionais

Não há navegador local/Playwright disponível: não foi feita inspeção visual do painel. A validação da interface é por DOM, build, isolamento de rotas e fluxo HTTP compilado. A revisão visual responsiva deve ser realizada localmente pelo operador.

Uma conta de operador por configuração, sessões em memória, servidor HTTP exclusivamente local em 127.0.0.2. Não é uma implantação pública, sistema multiusuário com RBAC, log externo assinado ou autenticação para rede. Senha/conta não devem ser compartilhadas se a atribuição pessoal for necessária.

Correção é estorno confirmado seguido de novo lançamento vinculado, com duas decisões explícitas; não há substituição silenciosa ou edição de totais. Sem identidade compartilhada confiável, não se promete deduplicação automática entre TikTok e operação manual. Fechar a aba durante uma resposta incerta exige consulta do UUID no histórico antes de criar outra operação.

Os quatro presentes autorizados relatados pelo operador continuam dependendo do catálogo privado existente. Os dez pendentes não foram promovidos. Nenhuma LIVE foi iniciada/conectada, presente comprado, banco real acessado ou fase posterior iniciada.

Ativação e recuperação: [admin-manual-scoring.md](admin-manual-scoring.md).

## Ajuste do PR #11 — inicializador de homologação isolada

A validação posterior do inicializador está em [admin-homologation.md](admin-homologation.md). Node 24.15.0/npm 11.9.0: `npm ci`, `npm audit` (zero vulnerabilidades), build, 301/301 testes (292 anteriores e nove novos), check:media e format:check aprovados. Comando npm com provedor inerte, bundles reais, SQLite temporário, autenticação, operações, recuperação, WebSocket e SIGINT do grupo comprovados offline. A limitação de encaminhamento de Ctrl+C pelo terminal virtual está registrada no procedimento. Sem acesso a LIVE, `.env` operacional, catálogos privados ou bancos do operador; conferência visual interativa permanece pendente.
