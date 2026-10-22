# Validação — Fase 5.4

## Base e ambiente

PR #9 confirmado como integrado. Base remota `main` `1782422c0325b83f50412af84aafe1f5250f8dde`; seus 109 arquivos foram materializados e comparados aos blobs Git antes da implementação. Nova branch `feat/gift-hybrid-identification`, sem alteração direta na main.

Linux, **Node.js 24.15.0**, npm 11.9.0. Dependências e package-lock preservados; nenhuma biblioteca adicionada. Nenhum arquivo local do operador foi substituído. O operacional inicial versionado continua `[]`.

## Comandos efetivamente executados

| Verificação                                 | Resultado                                                       |
| ------------------------------------------- | --------------------------------------------------------------- |
| `npm ci`                                    | aprovado, 162 pacotes instalados                                |
| `npm audit`                                 | zero vulnerabilidades reportadas                                |
| `npm run build`                             | frontend, backend e tipos dos testes aprovados                  |
| `npm test`                                  | **268/268**: 22 frontend + 246 backend                          |
| `npm run check:media`                       | seis WebM íntegros, objetos Git preservados                     |
| `npm run format:check`                      | aprovado                                                        |
| `npm run dev`                               | frontend HTTP 200 e backend `/health` HTTP 200, modo simulation |
| Seis vídeos via servidor de desenvolvimento | HTTP 200 e conteúdo idêntico por SHA-256                        |
| Encerramento com Ctrl+C                     | ambos os serviços encerraram; portas fechadas                   |

A instalação emite aviso sobre a configuração `http-proxy` do ambiente npm e a depreciação transitiva de `prebuild-install`; não houve EBADENGINE. Os testes usam provedor falso e bancos temporários, sem LIVE pública.

## Cobertura

Os 236 testes anteriores continuam passando. Foram adicionados 32 testes, cobrindo:

- Seis IDs confirmados, nomes/candidatos/pontos preservados, ID incorreto, nome ausente e conflito ID/nome sem fallback.
- Oito nomes literais com IDs histórico, desconhecido e divergente; nenhum ID é promovido automaticamente. Nomes parecidos, caixa/espaços, ausência e formatos inválidos não ganham correspondência.
- Contratos estritos, nomes/IDs/regras duplicados, pontos inválidos e campos adicionais rejeitados. CLI template/validate/prepare/verify, aprovação incompleta, proteção contra sobrescrita e entrega independente da identificação.
- Unidade válida e combos acumulativos: zero nas intermediárias, final único, repetição, regressão, conflitos, atores/grupos independentes e variação de ID externo entre ocorrências.
- ID externo, regra e nome mantidos no journal/fingerprint; tentativa de alterar mesma ocorrência rejeitada. Limites de capacidade e overflow sem mutação parcial.
- SQLite com pending, rollback por trigger, commit, recuperação, deduplicação após reinício, replay determinístico, recusa de outro catálogo/política e detecção de journal adulterado.
- Catálogo **sintético representativo de quatro itens no formato legado**, hash de política antigo idêntico e recuperação. Não foi acessado um catálogo operacional privado do operador; esse arquivo local não está no repositório.
- Fixture fixa de presentes e combo pendente gerada pelo motor não modificado da main anterior (`gift-id-v2.json`), além das fixtures históricas v1 já existentes. Sem recalcular decisões antigas sob a política nova.
- Novo conflito de nome em catálogo legado também é durável e coloca combo pendente em quarentena, impedindo reapresentação da ocorrência como válida.
- Arena recebe snapshot e atualização somente após commit. Falha de publicação desconecta o espectador, que recupera o placar persistido sem pontuar novamente; comandos de escrita reais continuam rejeitados.
- Logs de correspondência, conflito e entrega, sem IDs brutos de usuário/sala. Aliases de comentários 13/22, isolamento dos domínios e proteções existentes continuam na suíte.

Os testes antigos de catálogo tiveram apenas evidência/counts de White Rose ajustados conforme o pedido (seis/oito). Nos dois catálogos sintéticos de testes TikTok, o nome de `501` foi alinhado ao payload da própria fixture (`Synthetic gift`), pois o novo requisito exige rejeitar nomes contraditórios; as expectativas de pontuação e cenários anteriores foram mantidas.

## Arquivos

Modificados:

- `apps/backend/src/scoring/contracts.ts`, `catalog.ts`, `validation.ts`, `engine.ts`.
- `apps/backend/src/integration/config.ts`, `ingress.ts`, `runtime.ts`.
- `apps/backend/src/catalog-tools/catalog.ts`.
- `apps/backend/tests/gift-catalog.test.ts`, `tiktok-scoring.test.ts`.
- `config/gift-catalog.reference.json`.
- `README.md`, `docs/gift-catalog-validation.md` (indicação explícita de documento da etapa anterior).

Criados:

- `apps/backend/tests/gift-hybrid.test.ts`.
- `apps/backend/tests/fixtures/gift-id-v2.json` (somente dados sintéticos).
- `docs/gift-hybrid-identification.md`.
- `docs/validacao-gift-hybrid.md`.

Os 96 arquivos originais restantes foram comparados por hash e estão preservados. Isso inclui todo frontend, HTML, CSS e seis vídeos; comentários, módulos do adaptador TikTok/observação, autorização/transporte WebSocket, implementação SQLite/coordenador/schema, lockfile e catálogo operacional vazio. A extensão tipada no motor/journal utiliza as mesmas quatro tabelas, sem migração de banco.

## Limitações e próximo passo do operador

**14 preparados, zero presentes autorizados por padrão.** Seis IDs foram confirmados por relato explícito do operador; não comprovam entrega. Nenhum dos oito nomes ou dos ciclos de entrega foi validado em LIVE nesta tarefa. Single/combos e variação de IDs são testes sintéticos condicionais, sem garantia oficial do conector ou plataforma.

Sem nova conferência visual de navegador: preservação do frontend por hashes, testes DOM, build e verificações HTTP/mídias. Nenhuma transmissão foi iniciada/conectada e nenhuma interação foi enviada.

O operador deverá conferir o nome literal e a entrega de cada item em observation, registrar revisão explícita pela CLI e gerar um arquivo operacional novo, fora do projeto. Usar a política nova em uma disputa conscientemente criada; retomadas exigem catálogo e política idênticos, sem alterar bancos anteriores. Procedimento completo em [gift-hybrid-identification.md](gift-hybrid-identification.md). Sem testes de carga ou Fase 5.5.
