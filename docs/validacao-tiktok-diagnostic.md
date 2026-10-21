# Validação — Fase 5.1

Base: `main` em `c761fe59c0b893edfb68233596d5c6bbb4e1d4cf`; PR #6 confirmado integrado antes das alterações. Execução Linux com **Node 24.15.0** e npm **11.9.0**, usando o executável disponibilizado por `npm exec --package=node@24.15.0` sem adicioná-lo ao projeto.

## Resultados executados

| Verificação                                               | Resultado                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm ci`                                                  | Aprovado; 162 pacotes instalados na versão final                                      |
| `npm audit`                                               | Zero vulnerabilidades reportadas                                                      |
| `npm run build`                                           | Frontend, backend e tipagem de testes aprovados                                       |
| `npm test`                                                | **137/137 aprovados**: 20 frontend e 117 backend                                      |
| Regressão                                                 | Todos os 107 testes anteriores preservados e aprovados                                |
| Novos testes                                              | 30 cenários offline do adaptador, com fixtures sintéticas                             |
| `npm run check:media`                                     | Seis WebM com hashes/bytes preservados                                                |
| `npm run format:check`                                    | Aprovado                                                                              |
| `TIKTOK_DIAGNOSTIC_ENABLED=false npm run diagnose:tiktok` | Termina com status `disabled`, sem construir conexão TikTok                           |
| Serviços existentes                                       | `npm run dev`, página e `/health` HTTP 200; SIGINT encerrou ambos e liberou as portas |
| SDK 2.5.0 instalado                                       | Importado/construído e cancelado antes de connect nos testes; não é teste de LIVE     |
| Dependências preexistentes                                | Nenhuma versão atualizada; somente conector e dependências transitivas acrescentados  |

Os novos testes cobrem comentários integrais, ausência de identidade, IDs grandes e números inexatos, conflitos de sala/presente, presente não combinável candidato, diferenças entre README/schema v3, flags de finalização, campos ausentes, payload malformado e limites de campos.

Também cobrem acumulados 1/2/3, repetição, final explícito, retransmissão candidata, identidade contraditória, ordem regressiva, contexto de sequência contraditório, falta de groupId, TTL/interrupção e capacidade limitada de diagnóstico.

Privacidade testada com valores sintéticos de texto, assinatura, cookie, nickname e nome de presente: nenhum aparece nos logs. IDs são pseudonimizados com chave por execução. Há limites de frequência/tamanho e testes de orçamento de reconexão, backoff, deadline, limpeza incerta, callbacks antigos, troca de sala, stop imediato/durante backoff, fim da LIVE e encerramento controlado.

O teste de isolamento mantém snapshots de motor em memória, SQLite temporário e sessão WebSocket simulada, injeta comentários/presentes no adaptador fake e confirma ausência de alteração. Uma Observation encaminhada acidentalmente aos parsers existentes é rejeitada. Os módulos do adaptador também são verificados contra importações de scoring, persistência, realtime e frontend.

## Limitações e ocorrências

**Nenhuma LIVE foi conectada.** Não foi fornecida uma LIVE acessível para teste controlado, e não foram solicitadas credenciais ou iniciadas transmissões. Os resultados são offline; não comprovam comportamento real do TikTok, do serviço de assinatura ou de combos.

Permanecem não verificados em dados reais: significado e escopo de common.msgId/groupId, finalização, quantidade efetiva, campos default/ausentes, nomes/IDs reais de presentes, retransmissões, disponibilidade, acesso e reconexão. Todos os eventos continuam com `scoringEligible=false`.

A biblioteca é não oficial e depende de assinatura de terceiros; inclui tiktok-live-api-sdk 0.4.0-beta1 transitivo. A identidade dos campos foi inspecionada no código/types da distribuição, não inferida a partir de exemplos antigos do README. Declarações incompatíveis em NodeNext são isoladas por uma fronteira dinâmica mínima validada; a checagem de tipos do backend permanece habilitada.

Foram emitidos avisos do ambiente sobre `http-proxy` e da dependência transitiva anterior `prebuild-install`; não houve vulnerabilidade reportada. A distribuição não fornece garantias oficiais da plataforma.

Não houve nova inspeção visual em navegador nem teste de carga. HTML, CSS, mídias, animações, contratos WebSocket, scoring e persistência permanecem iguais à base remota. Limites de diagnóstico podem descartar dados e não constituem deduplicação definitiva. Nenhum payload privado, banco, `.env` ou captura real é publicado.

Roteiro para a verificação manual posterior: [tiktok-live-diagnostic.md](tiktok-live-diagnostic.md).
