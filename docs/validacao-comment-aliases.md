# Validação — aliases 13 e 22 no PR #8

## Alteração

Base inspecionada: branch `feat/tiktok-scoring-integration`, commit `ba86a410c93b45f070919f6090ed38fc4d41c8f5`. PR #8 aberto em rascunho. A cópia local dos arquivos versionados coincidiu integralmente com a árvore remota antes das alterações.

O reconhecimento foi ampliado somente no interpretador compartilhado de comentários. `Lula`/`13` identificam Lula; `Flávio`/`Flavio`/`22` identificam Flávio. Nome e número do mesmo participante não acumulam pontos. Qualquer combinação dos dois participantes, ou nenhum, resulta em zero. São usados os mesmos tokens Unicode completos e a mesma normalização de caixa/acentos anteriores: letras, números e sublinhado permanecem no token, enquanto espaços/pontuação o separam. IDs e fingerprints dos eventos não foram alterados.

O placar é uma interação informal de entretenimento; não representa pesquisa eleitoral, pesquisa representativa ou votação oficial.

## Compatibilidade transacional

Novas disputas usam `scoring-v2`. Disputas persistidas conservam `dispute.rules_version` e continuam processando todos os eventos com essa versão. V1 continua somente por nomes, inclusive após reinício. Não se reinterpreta o passado, não se muda a versão de uma disputa em andamento e não se zera placar em falha de recuperação.

A coluna de versão já existia: não foi preciso alterar o schema SQL. O checkpoint novo inclui a versão do motor; a verificação de digests v1 preserva exatamente sua serialização histórica. V2 protege a versão explícita no checkpoint. O coordenador seleciona a versão persistida antes do replay e valida a correspondência integral com as projeções. Versões desconhecidas, digests divergentes e pedidos explícitos de outra versão bloqueiam a retomada.

A fixture JSON v1 foi produzida pelo engine original, antes de editar o código, usando apenas comentários e identidades sintéticas. Contém checkpoints/digests fixos de simulação e real, sem banco binário ou dados de LIVE. Os testes materializam bancos temporários com schema 1/2 e recuperam esses resultados originais, incluindo `13` ignorado e `Lula 22` pontuando somente pelo nome em v1. A mesma disputa continua sob v1 e é novamente retomada após novos eventos.

## Validação executada

Linux, Node.js **24.15.0**, npm **11.9.0**. Uma execução inicial também validou build e testes backend no Node 24.19.0 disponível no ambiente; os resultados finais abaixo usam o executável 24.15.0 no PATH.

| Comando                | Resultado final                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `npm ci`               | aprovado; dependências e lockfile preservados                                       |
| `npm audit`            | zero vulnerabilidades reportadas                                                    |
| `npm run build`        | aprovado em frontend, backend e tipos dos testes backend                            |
| `npm test`             | **201 testes aprovados**: 22 frontend + 179 backend, sem falhas/cancelamentos/skips |
| `npm run check:media`  | aprovado; os seis WebM correspondem aos hashes Git de referência                    |
| `npm run format:check` | aprovado                                                                            |

Os 164 testes anteriores foram preservados e 37 testes foram acrescentados. A cobertura inclui todos os exemplos solicitados: `Lula`, `13`, `Flávio`, `Flavio`, `22`, `Lula 13`, `Flávio 22`, `Lula 22`, `Flávio 13`, `13 22`, `113`, `221`, `2022`, `13!`, `22!`, `#13`, `#22` e `LULA!!! 13`. Também cobre nomes/identificadores maiores, acentos decompostos, repetição de tokens, máximo de um ponto, comentários com IDs distintos, retransmissão e conflito do mesmo ID, retomada v2, retomada v1 nos dois domínios, schema legado, troca de versão e metadados corrompidos.

A primeira execução da suíte encontrou um arquivo temporário de transferência extra na pasta de mídias. Ele foi preservado fora da aplicação; os seis arquivos versionados não foram alterados. As execuções completas seguintes passaram. Não foi modificado o teste de mídia para ignorar arquivos inesperados.

Avisos observados na instalação: `http-proxy` herdado do ambiente npm e depreciação transitiva de `prebuild-install`. Nenhuma dependência foi atualizada. A configuração de modo real, autorizações, adaptador TikTok, protocolo/transporte WebSocket, frontend, HTML/CSS, animações, vídeos e catálogo de presentes permanecem iguais à base do ajuste. Não foi iniciada ou conectada uma LIVE; não houve nova inspeção visual. Nenhuma delas é necessária para validar a mudança isolada de interpretação e replay.

## Arquivos alterados neste ajuste

- `README.md`
- `apps/backend/src/persistence/coordinator.ts`
- `apps/backend/src/persistence/schema.ts`
- `apps/backend/src/persistence/sqlite.ts`
- `apps/backend/src/scoring/comments.ts`
- `apps/backend/src/scoring/contracts.ts`
- `apps/backend/src/scoring/engine.ts`
- `apps/backend/tests/comment-aliases.test.ts`
- `apps/backend/tests/fixtures/scoring-v1.json`
- `apps/backend/tests/persistence.test.ts`
- `docs/scoring-engine.md`
- `docs/tiktok-scoring-integration.md`
- `docs/validacao-comment-aliases.md`
