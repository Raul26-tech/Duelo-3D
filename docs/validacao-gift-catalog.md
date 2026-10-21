# Validação — Fase 5.3, catálogo de presentes

## Base e pré-condições

PR #8 confirmado como integrado. Main remota `4cb21a8a78d8a615e0df211ca2eedc6cd040ff65`, árvore `7a6dff70fc0f7e333f64690f4aef111309cbd829`. O interpretador 13/22 (`scoring-v2`) foi inspecionado nessa referência. Catálogo, validação de ingressos, coordenador SQLite e documentação foram revisados antes da criação de `feat/gift-catalog-validation` a partir da main atualizada.

Os 100 arquivos da base foram materializados conferindo seus hashes Git. Nenhuma implementação anterior foi refeita ou sobrescrita. A publicação herda os seis objetos binários de mídia existentes; não há envio de vídeos por Base64.

## Resultado funcional

- Referência dos 14 presentes preserva exatamente os nomes, IDs, participantes e pontos informados pelo operador. Cinco são `operator-reported-live`; nove são `external-unconfirmed`. Todos começam com entrega `unreviewed`.
- O operacional inicial existente continua `[]`. A referência não é carregada pelo runtime real e não ativa presentes. Os cinco IDs observados não têm nome, entrega ou aprovação presumidos.
- CLI local lista, cria template pendente, valida, gera e verifica operacionais. Requer confirmação por item e aprovação explícita; campos administrativos nunca entram no operacional. Arquivos de saída são novos, exclusivos, 0600 e fora do repositório/build. Não há sobrescrita, alteração de `.env` ou comando de aprovação geral.
- Relatório agregado opcional reutiliza o diagnóstico de observação existente. Não contém usuários, salas, ocorrências, sequências brutas, texto de comentários ou credenciais, nem produz eventos elegíveis à pontuação. Capacidade/tamanho são limitados e descartes são informados.
- Motor de comentários/presentes, catálogo do engine, integração real, persistência, WebSocket e frontend permanecem sem alteração. A seleção e o hash do catálogo continuam vinculados à disputa; mudança de catálogo na recuperação é recusada.

## Ambiente e comandos efetivamente executados

Linux, Node.js **24.15.0**, npm **11.9.0** na validação final. A primeira instalação/build/testes também foram executados no Node 24.19.0 disponível no ambiente. Sem novas dependências e sem alterações no lockfile.

| Comando                | Resultado                                                                         |
| ---------------------- | --------------------------------------------------------------------------------- |
| `npm ci`               | aprovado; 162 pacotes instalados                                                  |
| `npm audit`            | zero vulnerabilidades reportadas                                                  |
| `npm run build`        | aprovado nos dois workspaces, incluindo tipos dos testes backend                  |
| `npm test`             | **236 aprovados**: 22 frontend + 214 backend; zero falhas, cancelamentos ou skips |
| `npm run check:media`  | aprovado; seis WebM com os hashes Git esperados                                   |
| `npm run format:check` | aprovado                                                                          |

Os 201 testes anteriores foram preservados. Há 35 testes novos (28 catálogo/CLI e 7 relatório/diagnóstico). Avisos observados: configuração npm `http-proxy` do ambiente e depreciação transitiva de `prebuild-install`; nenhum EBADENGINE na instalação final.

Também foi executado o workflow real da CLI pela raiz npm (`template`, `validate`, `prepare`, `verify`) em diretório temporário, sem aprovações: o operacional gerado era `[]`. O CLI compilado em `apps/backend/dist/catalog-tools/main.js list` carregou os 14 itens. Os arquivos temporários desse workflow foram removidos ao final.

## Cobertura

Testes offline verificam os 14 valores exatos, cinco/nove procedências, entrega pendente, IDs inválidos/duplicados, pontos inseguros ou de tipo incompatível, candidatos inválidos, metadados incompletos ou contraditórios, confirmação explícita dos provisórios, aprovação independente, seleção/exportação apenas de autorizados e rejeição de campos administrativos no operacional.

A CLI é exercitada por subprocessos a partir de outro diretório; a referência é resolvida pela localização do módulo. Testes verificam ausência de sobrescrita, permissões, limite de entrada e bloqueio de saídas no repositório, inclusive por symlink. Catálogo gerado não pode incluir item não autorizado ou alterar os pontos da referência.

Cenários **sintéticos**, sem afirmar comportamento real dos presentes, cobrem Rose single = 2, Tiny Diny single = 20, dez Roses em combo final = 20 e três Capybaras em combo final = 150. Intermediárias não somam; retransmissões e finais repetidos não reaplicam pontos. Presentes desconhecidos ou sem entrega aprovada no operacional permanecem sem pontuação.

SQLite real temporário verifica pendência, recuperação, finalização, deduplicação após reinício, rollback imposto por trigger e recusa de outro catálogo. Os testes de overflow, integridade, capacidade, modos e snapshot anteriores continuam aprovados. Comentários 13/22 e combinações ambíguas conservam seus resultados.

O relatório é testado com payloads sintéticos e provedor falso, incluindo progressão, final, retransmissão, regressão, conflito, falta de IDs, isolamento, ausência de dados pessoais/credenciais e limites. Configuração desligada não cria arquivo; configuração de conexão real em NODE_ENV=test é recusada antes de conectar. A composição com provedor falso encerra controladamente e salva somente agregados. O relatório não é aceito como revisão ou catálogo operacional.

## Preservação e limitações

Conferidos por SHA Git: **50 arquivos protegidos sem alteração**, incluindo todo o frontend, seis mídias, módulos de scoring/persistência/integração/realtime, lockfile e catálogo operacional vazio. Alterações no package.json são somente scripts locais; o entrypoint TikTok dedicado recebeu somente a composição opcional do relatório. Permissões, sourcePolicy, contratos e recuperação da disputa real não foram alterados.

Nenhuma LIVE foi iniciada ou conectada nesta execução e nenhuma interação foi enviada. Os cinco IDs observados são relatos prévios do operador; não representam validação realizada aqui. Os nove provisórios continuam não confirmados. Nenhum ciclo de entrega dos 14 presentes foi comprovado nesta implementação. Os testes sintéticos não são evidência de semântica real.

Não houve nova inspeção visual ou reprodução em navegador real. A arena foi preservada por hashes, build, testes DOM existentes e integridade das mídias; não se declara validação visual. Não foram implementados testes de carga ou a Fase 5.4.

O relatório é limitado, não prova captura completa e pode ficar incompleto após encerramento abrupto. Revisões são atestações locais do operador, sem certificação oficial ou assinatura. Arquivos operacionais editados manualmente continuam sujeitos à confiança e validação já existentes do backend; a CLI não introduz outra autorização nem altera o contrato para embutir evidências. Não se deve trocar catálogo de disputa em andamento.

Procedimentos e campos: [gift-catalog-validation.md](gift-catalog-validation.md).

## Arquivos criados ou modificados

- `.env.example`
- `README.md`
- `apps/backend/package.json`
- `apps/backend/src/catalog-tools/catalog.ts`
- `apps/backend/src/catalog-tools/main.ts`
- `apps/backend/src/local-json.ts`
- `apps/backend/src/tiktok/gift-report.ts`
- `apps/backend/src/tiktok/main.ts`
- `apps/backend/tests/gift-catalog.test.ts`
- `apps/backend/tests/gift-report.test.ts`
- `config/gift-catalog.reference.json`
- `docs/gift-catalog-validation.md`
- `docs/validacao-gift-catalog.md`
- `package.json`
