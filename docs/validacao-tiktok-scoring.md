# Validação — integração TikTok e pontuação (Fase 5.2)

## Base e escopo

PR #7 integrado, conferido antes da implementação. Main remota de origem: `67f59879c06d3cc2d42ec6c0fbeb454b075f523c`, árvore `ba03d820e2a9e1b818d233f7ecda1381a4fd267b`. Branch criada a partir dessa referência: `feat/tiktok-scoring-integration`. Nenhuma fase anterior foi recriada. Os objetos existentes de mídia são herdados da árvore Git; não houve envio de vídeos em Base64.

O motor continua único. Mudanças de domínio limitam-se ao opt-in real interno, atribuição do ator em fingerprints/sequências e política de origem no checkpoint. As regras de interpretação, pontos por catálogo, combos, capacidade e overflow continuam no mesmo engine; a coordenação SQLite existente mantém commit antes de publicação.

## Ambiente e resultados executados

Linux, Node.js **24.15.0** e npm **11.9.0**. A primeira instalação também funcionou com o Node 24.19.0 disponível no ambiente; a validação final usou explicitamente o executável 24.15.0 no PATH. Não houve conexão com LIVE real nesta execução.

| Verificação               | Resultado                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci`                  | aprovado no Node 24.15.0; 162 pacotes instalados; lockfile preservado                                                                            |
| `npm audit`               | 0 vulnerabilidades reportadas                                                                                                                    |
| `npm run build`           | frontend Vite + TypeScript e backend + tipos dos testes aprovados                                                                                |
| `npm test`                | **164 aprovados**: 22 frontend + 142 backend; zero falhas, cancelamentos ou skips                                                                |
| `npm run check:media`     | aprovado: seis objetos WebM correspondem à main de origem                                                                                        |
| `npm run format:check`    | aprovado                                                                                                                                         |
| `npm run dev`, sem `.env` | frontend e backend iniciaram juntos, em portas locais reservadas para o teste                                                                    |
| Página e `/health`        | HTTP 200 em ambos; modo retornou simulation pelo proxy Vite                                                                                      |
| Seis vídeos via HTTP      | HTTP 200 e hashes iguais aos arquivos originais locais                                                                                           |
| Ctrl+C no conjunto        | grupo principal encerrado; ambas as portas deixaram de aceitar conexão                                                                           |
| Arquivos protegidos       | 19 arquivos conferidos por SHA Git: HTML, CSS, seis WebM, componentes de renderização/animação, históricos e manifests npm/lockfile sem mudanças |

Avisos efetivamente observados: configuração `http-proxy` herdada do ambiente npm e depreciação transitiva de `prebuild-install@7.1.3`. Nenhum EBADENGINE apareceu na instalação final. Dependências e lockfile não foram atualizados.

## Cobertura offline

Os 137 testes anteriores foram preservados; foram acrescentados 27 testes (25 backend e 2 frontend). Todos os eventos adicionados são fixtures sintéticas com provedor falso; SQLite utiliza diretórios temporários e limpeza ao término.

- Comentários válidos/ambíguos, palavras completas, acentos, repetições distintas e retransmissões.
- IDs grandes, identidade/usuário ausentes, tipos inseguros, sala divergente, origem injetada, payload malformado e impossibilidade de promover uma projeção observada trocando domain.
- Catálogo externo vazio ou configurado, pontos controlados pelo servidor, configuração imutável, presentes desconhecidos e rejeição durável contra identidade contraditória posterior.
- Acúmulo 1/2/3, pendências no banco, finalização, retransmissões, finalização insuficiente, regressões de quantidade e alteração do ator da sequência.
- Reinício com deduplicação, mesma sessão/versão/placar e snapshots persistidos para reconexão; bancos legados com layout v1 continuam recuperáveis em simulação.
- Rollback SQL imposto por trigger: nenhum journal/identidade/placar parcial ou atualização WebSocket; falha bloqueia recepção. A ocorrência sem commit pode ser processada após retomada segura.
- Overflow do total e da multiplicação sem finalização parcial de combo; regras de capacidade e concorrência transacional anteriores continuam aprovadas.
- Confirmação de commit por segunda conexão SQLite antes da publicação; falha injetada no transporte não reaplica votos e força reconciliação por snapshot.
- Múltiplos espectadores, recusa de Origin externo, canal de simulação ausente em real e recusa de voto/reset/token/payload TikTok enviados pelo navegador.
- Queda e reconexão do provedor falso, descarte de callbacks antigos e pré-handshake, bloqueio em sala diferente, falha de conexão e encerramento controlado.
- Exclusividade da autoridade, revogação por lock removido/substituído, mudança de contexto/catálogo/política, corrupção persistida sem fallback para zero.
- Réplica real rejeita simulação, sessão antiga e versão obsoleta; o cliente real nunca envia autorização de simulação, voto ou reset.
- Testes existentes continuam cobrindo mídia, renderização DOM, liderança/empate, barras, animações, regras de negócio, integridade e os modos anteriores.

## Limitações

Não foi realizado teste real com TikTok, assinatura, conta ou transmissão pública nesta entrega. As fixtures não provam unicidade de `common.msgId`, estabilidade de `groupId` ou semântica dos presentes na plataforma. O operador precisa confirmar essas propriedades e habilitar somente os IDs/ciclos revisados. Catálogo padrão permanece vazio.

Não houve nova conferência visual em navegador real. HTML, CSS, componentes de animação/renderização e vídeos foram preservados por hash; DOM automatizado e HTTP foram testados. Isso não é uma alegação de inspeção visual ou reprodução de vídeo em navegador.

O smoke do comando conjunto usou simulation e nenhum `.env`, para evitar conexão externa. O fluxo real completo foi executado offline por composição com provedor falso, SQLite real e sockets WebSocket reais de loopback. Não se afirma que o entrypoint foi conectado a uma LIVE.

A operação é local, de uma autoridade e uma máquina. O lock deixado por crash requer verificação manual antes de remoção. Não há garantias de entrega de eventos perdidos enquanto o conector está offline. O modo real bloqueia ao detectar perda conhecida por limite de recepção, falha persistente ou inconsistência; não há recuperação por zero ou aproximação.

Configuração, contratos, procedimentos de create/resume, revisão de IDs/combos e teste real controlado: [tiktok-scoring-integration.md](tiktok-scoring-integration.md).

## Arquivos criados ou modificados

- `.env.example`
- `.gitignore`
- `README.md`
- `apps/backend/src/integration/arena.ts`
- `apps/backend/src/integration/authority.ts`
- `apps/backend/src/integration/config.ts`
- `apps/backend/src/integration/ingress.ts`
- `apps/backend/src/integration/runtime.ts`
- `apps/backend/src/main.ts`
- `apps/backend/src/persistence/coordinator.ts`
- `apps/backend/src/persistence/schema.ts`
- `apps/backend/src/persistence/sqlite.ts`
- `apps/backend/src/scoring/contracts.ts`
- `apps/backend/src/scoring/engine.ts`
- `apps/backend/src/scoring/validation.ts`
- `apps/backend/src/server.ts`
- `apps/backend/src/tiktok/client.ts`
- `apps/backend/tests/tiktok-scoring.test.ts`
- `apps/frontend/src/main.ts`
- `apps/frontend/src/realtime/client.ts`
- `apps/frontend/src/realtime/protocol.ts`
- `apps/frontend/src/realtime/replica.ts`
- `apps/frontend/tests/realtime.test.ts`
- `apps/frontend/vite.config.ts`
- `config/gift-catalog.example.json`
- `docs/tiktok-scoring-integration.md`
- `docs/validacao-tiktok-scoring.md`
