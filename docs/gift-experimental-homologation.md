# Fase 5.6.1 — homologação experimental dos 14 presentes

O PR #12 permanece em Draft. Esta fase prepara ferramentas e procedimento; **não inicia conexão TikTok, configura a próxima LIVE, abre o banco histórico ou cria a disputa da transmissão**. A implantação e a disputa nova ficam para a Fase 5.7, mediante autorização. Enquete informal de entretenimento, sem pesquisa representativa ou votação eleitoral oficial.

## Evidência disponível e bloqueios atuais

Os 14 nomes, candidatos, pontos e modalidades estão na [tabela da Fase 5.6](gift-catalog-phase56.md). Os arquivos privados das quatro regras autorizadas não estão neste checkout. Suas políticas não podem ser recuperadas da referência pública ou inventadas a partir de testes.

| Presente        | Identificação                                          | Pontos | Situação da entrega nesta preparação                    |
| --------------- | ------------------------------------------------------ | -----: | ------------------------------------------------------- |
| Rose            | ID 5655, Lula                                          |      2 | Copiar exatamente a regra privada existente             |
| Finger Heart    | ID 5487, Lula                                          |     10 | Copiar exatamente a regra privada existente             |
| White Rose      | ID 8239, Flávio                                        |      2 | Copiar exatamente a regra privada existente             |
| Capybara        | ID 14488, Flávio                                       |     50 | Copiar exatamente a regra privada existente             |
| Heart           | `name:heart`, nome `Heart`, Lula                       |     20 | Pendente: política, justificativa e aceite experimental |
| Doughnut        | ID 5879, Lula                                          |     50 | ID relatado observado; entrega/aceite pendentes         |
| Confetti        | `name:confetti`, nome `Confetti`, Lula                 |    200 | Pendente: política, justificativa e aceite experimental |
| Money Gun       | `name:money-gun`, nome `Money Gun`, Lula               |   1000 | Pendente: política, justificativa e aceite experimental |
| Galaxy          | `name:galaxy`, nome `Galaxy`, Lula                     |  10000 | Pendente: política, justificativa e aceite experimental |
| Overreact       | `name:overreact`, nome `Overreact`, Flávio             |     10 | Pendente: política, justificativa e aceite experimental |
| Tiny Diny       | ID 6560, Flávio                                        |     20 | ID relatado observado; entrega/aceite pendentes         |
| Hand Heart      | `name:hand-heart`, nome `Hand Heart`, Flávio           |    200 | Pendente: política, justificativa e aceite experimental |
| You're Amazing  | `name:youre-amazing`, nome `You're Amazing`, Flávio    |   1000 | Pendente: política, justificativa e aceite experimental |
| Watermelon Love | `name:watermelon-love`, nome `Watermelon Love`, Flávio |  10000 | Pendente: política, justificativa e aceite experimental |

Seis IDs foram relatados observados; isso não confirma entrega. Os oito IDs antigos dos itens por nome continuam apenas históricos e nunca são exportados como autorização por ID. A referência de 14 itens e o catálogo operacional público vazio foram preservados.

**Não há um catálogo operacional de 14 itens habilitado nesta entrega.** Há um procedimento executável que o produz como manifesto experimental após receber as quatro regras privadas e as dez decisões explícitas. Sem isso, o comando enumera os bloqueios individuais e não gera autorização fictícia. Nenhuma hipótese foi escolhida em nome do operador.

## Por que o manifesto é separado

- Catálogo validado continua sendo o array existente em `TIKTOK_GIFT_CATALOG`.
- O novo manifesto tem `schema: gift-experiment-v1`, `purpose: experimental-homologation` e `productionValidated: false`. Contém o plano e 14 regras derivadas, conferidas novamente no carregamento.
- O runtime só aceita esse manifesto com `TIKTOK_EXPERIMENTAL_ENABLED=true` **e** `TIKTOK_EXPERIMENT_MANIFEST`, além de todos os controles reais anteriores. Não permite usá-lo junto de `TIKTOK_GIFT_CATALOG`.
- O caminho normal de catálogo, `validate`, `verify`, `extend` e o motor não aceitam o wrapper experimental como catálogo validado. Não existe comando para convertê-lo automaticamente em aprovação de produção.
- A política persistida inclui o digest do manifesto, além de conta/sala/catálogo. Um banco experimental não pode ser retomado como validado, nem vice-versa, mesmo com os mesmos pontos. Mudanças no plano também bloqueiam retomada incompatível.
- Trata-se do mesmo modo de transporte `real` e do mesmo motor/journal, com perfil experimental explícito; não cria outro motor ou um quarto protocolo. Console e estado da conexão no painel identificam a homologação experimental.

Arquivos locais não são assinados pela plataforma. Um operador com controle do SO pode editar arquivos/código; a proteção impede promoção automática pelos fluxos da aplicação, não falsificação deliberada fora deles.

## Preparar um plano, sem banco ou conexão

Linux, Node 24.15+ na linha 24 e npm 11+. Todos os comandos desta seção são offline. Selecionar explicitamente o arquivo privado atual contendo **somente as quatro regras autorizadas**, sem lê-lo por `.env` ou reconstituí-lo da documentação.

```bash
npm run catalog:gifts -- experiment-template /privado/current-four-active.json \
  --output /privado/new-experiment-plan.json
npm run catalog:gifts -- experiment-status /privado/new-experiment-plan.json
```

A saída deve ser absoluta, nova e externa ao projeto; diretório deve existir. Arquivos são criados 0600, sem sobrescrita. O baseline é lido e copiado, preservando ID/modalidade/formato legado, nome, candidato, pontos e entrega. Se os quatro arquivos/regras anteriores não estiverem disponíveis, interrompa aqui e recupere os dados com o operador. Não selecione um backup SQLite como entrada.

O plano contém:

- `baseline` e `baselineDigest`: cópia e hash das quatro regras privadas selecionadas. Alterar a cópia invalida o plano; a preparação também reconfere o arquivo original selecionado explicitamente.
- `hypotheses`: dez itens vinculados ao ID de referência estável; começam com `delivery: null`, `acceptsAssumption: false`, `rationale: ""`.
- `operator: ""` e `acceptExperimentalRisks: false`.

Os campos de regra operacional das dez hipóteses são derivados da referência; não podem ser enviados como pontos/candidato/nome arbitrários dentro de uma hipótese.

## Decisão de entrega: riscos apresentados ao operador

Não há evidência suficiente no repositório para escolher uma política real para cada pendente. As duas hipóteses possíveis são condicionais, não recomendações de comportamento desses presentes:

| Hipótese           | O que o ingresso exige                                                                                     | Risco da hipótese errada                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `single`           | Tipo diferente de 1, `combo:false`, `repeatCount:1`, `repeatEnd:1`, identidade completa e contexto correto | Um presente realmente combinável ou flags/defaults diferentes será rejeitado. Não somar notificações como unidades                                                         |
| `cumulative-final` | Tipo 1, `combo:true`, `groupId` confiável, contagem acumulativa positiva e finalização explícita           | Sem grupo/finalização não pontua; grupo reutilizado ou entrega não acumulativa pode bloquear/quarentenar a sequência. Os controles não provam a semântica real do provedor |

Escolher por item uma hipótese fundamentada e registrar a justificativa (16–512 caracteres). Se não houver fundamento aceitável, manter pendente e observar sem habilitar. Nunca preencher todos com `single` apenas para passar a validação. Confirmar que um presente identificado por nome exige **nome inglês literal e ID externo na ocorrência**, sem aliases/traduções ou associação por preço.

Somente depois da decisão explícita, editar o arquivo privado do plano:

1. Informar identificador local do operador em `operator`.
2. Aceitar conscientemente os riscos em `acceptExperimentalRisks: true`.
3. Para cada um dos dez, preencher `delivery`, justificar a hipótese em `rationale` e aceitar `acceptsAssumption: true`.
4. Não alterar o baseline. O plano não contém `nameConfirmed`/`connectorFieldsReviewed` fictícios para as hipóteses: elas permanecem não validadas operacionalmente.

```bash
npm run catalog:gifts -- experiment-status /privado/new-experiment-plan.json
npm run catalog:gifts -- experiment-prepare /privado/current-four-active.json /privado/new-experiment-plan.json \
  --output /privado/new-experiment-manifest.json
npm run catalog:gifts -- experiment-verify /privado/new-experiment-manifest.json
```

O gerador só conclui com as dez decisões completas; não reduz silenciosamente o catálogo ou inventa os campos faltantes. Mantém os seis IDs e oito `ruleId` por nome. Duplicatas, pontos/candidatos divergentes, hipóteses ausentes ou regras adulteradas são recusadas. A saída é **experimental**, não aprovação de entrega real. O catálogo em uso e o `.env` não são alterados.

## Execução posterior: fronteira com a Fase 5.7

**Não executar uma transmissão ou criar banco nesta fase.** Depois da autorização da Fase 5.7, o operador deverá ter uma disputa experimental nova, conta/sala confirmadas, caminho externo novo de SQLite e configuração de `create`/`resume` preparada separadamente. Nunca apontar para a disputa/backup histórico nem reinicializá-los.

A configuração adicional que essa preparação posterior deverá fornecer é:

| Variável                            | Valor/condição                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DUEL_MODE` / `TIKTOK_REAL_ENABLED` | `real` / `true`, opt-in existente                                                                                 |
| `TIKTOK_IDENTITY_REVIEWED`          | `true` somente após revisão de identidade do conector                                                             |
| `TIKTOK_EXPERIMENTAL_ENABLED`       | `true` conscientemente; padrão `false`                                                                            |
| `TIKTOK_EXPERIMENT_MANIFEST`        | Caminho absoluto do manifesto privado conferido                                                                   |
| `TIKTOK_GIFT_CATALOG`               | Ausente neste perfil; não combinar com o manifesto                                                                |
| `TIKTOK_DIAGNOSTIC_ENABLED`         | `false`; não iniciar outro conector de observação                                                                 |
| `TIKTOK_RUNTIME_REPORT`             | Arquivo JSON externo **novo**, reservado antes de iniciar a autoridade                                            |
| `TIKTOK_RUNTIME_REPORT_MINUTES`     | `35` por padrão; intervalo inteiro 1–35                                                                           |
| Conta/sala/banco/ação               | Fornecidos exclusivamente pela preparação futura da Fase 5.7                                                      |
| Administração                       | Continua desligada por padrão; se autorizada posteriormente, usar a configuração e credencial externas existentes |

Depois de configurado conscientemente pelo operador, o comando de execução continua `npm run dev`, com build administrativo existente. Não foi executado aqui em perfil TikTok. Não utilizar `homologate:admin` para conectar à plataforma: esse comando permanece isolado/sintético.

## Roteiro supervisionado de 30–35 minutos

1. Conferir o manifesto com a CLI; registrar externamente quais dez políticas são hipóteses, não evidências. Confirmar que a disputa selecionada na Fase 5.7 é a experimental nova e que o histórico não está aberto para escrita.
2. Confirmar portas loopback, arena somente leitura, painel autenticado se autorizado e marcador **HOMOLOGAÇÃO EXPERIMENTAL**. Nenhuma credencial entra em URL, bundle ou relatório.
3. Iniciar somente o runtime já configurado. Ele usa **uma única fábrica/conexão TikTok**. Não executar `diagnose:tiktok` simultaneamente para a mesma finalidade.
4. Observar os presentes recebidos espontaneamente; não iniciar/encerrar LIVE, comprar ou enviar presentes automaticamente. Quando possível, avaliar um presente/tipo por vez, mantendo evidências públicas sem dados pessoais desnecessários.
5. Conferir o nome inglês, ID externo, modalidade de identificação, contagem, grupo/finalização e motivos de rejeição. Não assumir que uma notificação corresponde a uma unidade entregue.
6. Conferir os pontos e versão autoritativos. A gravação continua transacional e a publicação ocorre após commit; retransmissão não reaplica o evento.
7. Usar a contingência administrativa somente depois da reconciliação descrita abaixo. Não alterar o reconhecimento para compensar um lançamento.
8. Ao terminar em 30–35 minutos, Ctrl+C encerra o processo local e grava o relatório. Isso desconecta o conector, **não encerra a LIVE da plataforma**.
9. Avaliar o relatório offline pelo comando existente:

```bash
npm run catalog:gifts -- assess /privado/runtime-report-new.json \
  --output /privado/runtime-assessment-new.json
```

A avaliação reconhece o envelope do runtime, valida o agregado/contadores e preserva finalidade, resultados e alertas. Não produz catálogo ou aprovação.

## Cinco minutos versus 35 minutos

O comando independente `diagnose:tiktok` mantém seu limite de cinco minutos. Ele não é o processo usado para observação simultânea com pontuação nesta homologação.

O runtime real não tinha esse prazo de cinco minutos. O novo relatório é um observador da sua conexão existente e captura por até 35 minutos, ou 30.000 resultados de presentes, com até 64 grupos de resultado e os limites do agregado (32 IDs, dois nomes e oito amostras por ID). O arquivo completo é limitado a 60 KiB; descartes são contados. O relatório é salvo no limite ou encerramento, sem sobrescrita.

Atingir prazo/capacidade **encerra a captura do relatório**, não a LIVE, o placar ou a conexão autoritativa. O operador deve encerrar o processo local no prazo planejado. Logs de console preexistentes continuam limitados por frequência/backpressure; redirecionamentos externos e retenção são responsabilidade do operador. Não há coleta ilimitada em memória ou arquivo pelo novo relatório. Encerramento forçado/SIGKILL pode impedir gravação; falha de gravação é sinalizada, mas nunca desfaz/reaplica pontos confirmados.

## Diagnóstico simultâneo e privacidade

`runtime-report.ts` não possui capacidade de scoring, SQL ou SDK. Reutiliza o agregado e recebe apenas resultados do runtime; captura o mesmo callback e não abre conexão secundária. O relatório tem `schema: real-runtime-report-v1`, `purpose: experimental`, `authorizationGranted:false` e `scoringEligible:false` (não pode ser reingerido como evento).

- `observation`: agregado da Fase 5.6, com campos/limites e indícios de combo.
- `outcomes`: ID/nome públicos do presente, modalidade de correspondência, motivo, status, quantidade de notificações e última versão retornada pelo processamento confirmado. Rejeição antes de SQL/falha de transação usa versão `null`.
- `ended`, contadores de descartes e prazo: sinalizam se a coleta foi encerrada/limitada.

Não armazena IDs de usuários, ocorrências, sala ou grupos, comentários, cookies, tokens ou assinaturas. Logs existentes pseudonimizam identidades. Uma linha agregada não é recibo individual nem comprova quantidade ou aplicação de um evento específico. Por isso não deve ser usada sozinha para lançar pontos.

Defaults e semânticas de `tiktok-live-connector@2.5.0` não são garantias oficiais do TikTok. Amostras podem intercalar grupos, IDs externos podem variar em regras por nome e retransmissões podem repetir finais. ID contraditório tem prioridade sobre correspondência por nome; os oito IDs históricos nunca substituem identidade ausente. Dúvidas mantêm a regra como hipótese/pendência.

## Reconciliação e contingência administrativa

O painel, autenticação, CSRF, catálogo do servidor, cálculo de pontos, justificativa, estorno/correção e auditoria existentes permanecem ativos **somente se habilitados explicitamente pelo operador**. O painel recebe as 14 regras apenas se o manifesto tiver sido aceito, sem mudar a política permanentemente ao lançar pontos.

1. Identificar a ocorrência suspeita por evidência confiável do operador/provedor, não apenas nome, horário ou quantidade. Consultar relatório e logs para investigar o motivo.
2. Conferir a disputa experimental correta e o journal/identidades persistidas, em leitura autorizada, além do histórico administrativo. O histórico do painel é de operações administrativas; sua ausência não prova ausência de pontuação automática.
3. Verificar a quantidade efetiva e se a sequência já finalizou. Não somar notificações intermediárias.
4. Se houver identidade compartilhada comprovada (ocorrência/ator/grupo quando aplicável), utilizar o vínculo existente. Uma ocorrência já admitida pelo motor pode ser recusada pelo vínculo, mesmo com resultado sem pontos. **Não remover o vínculo apenas para contornar a recusa**; esse caso exige reconciliação específica, não um lançamento apressado.
5. Em caso de incerteza, interromper o lançamento. O relatório anonimizado não permite reconstruir identidades reais, e não há promessa de deduplicação entre origens sem identidade compartilhada. Uma notificação observada não é autorização de pontuação manual.
6. Quando o caso estiver efetivamente reconciliado e autorizado, selecionar a regra/candidato, informar quantidade, justificativa, identidade da operação e confirmação de reconciliação. Pontos são calculados exclusivamente pelo backend.
7. Confirmar histórico, versão e arena. Repetir uma requisição incerta com o mesmo UUID, nunca com outro para contornar idempotência.
8. Se necessário, estornar e efetuar correção vinculada pelos fluxos existentes; não apagar operação ou editar totais SQL. Estorno não libera automaticamente a reserva de identidade TikTok.

O teste novo cobre uma entrega rejeitada antes de admissão, lançamento vinculado após reconciliação sintética, retransmissão automática sem dupla pontuação, estorno e replay. Casos de identidade já admitida e casos ambíguos continuam sujeitos aos bloqueios conservadores existentes; esta fase não enfraquece esses controles.

## Da hipótese para validação

Após a LIVE, revisar individualmente cada presente: identidade externa/nome literal, campos do conector, unidade versus acumulativo, grupo confiável, finalização, retransmissões, rejeições e conciliação de resultados. A observação de um único ID ou um teste sintético não basta para semântica universal.

Somente quando a evidência for suficiente, preencher **separadamente** as revisões validadas da Fase 5.6 e obter aprovação explícita do operador. Não converter automaticamente o plano/manifesto ou copiar aceites experimentais para `connectorFieldsReviewed`/aprovação validada. A adoção em catálogo validado e uma disputa compatível deve ser planejada posteriormente; não migrar o banco experimental/histórico, trocar contexto silenciosamente ou recalcular resultados.

## Arquitetura e compatibilidade

O validador operacional existente foi movido sem mudança de regras para `integration/gift-policy.ts` e reexportado por `config.ts`, evitando dependência circular com a CLI experimental. Não há relaxamento dos contratos. O mesmo ingresso híbrido e motor processam todos os eventos; SQLite/schema/journal e fingerprints históricos permanecem inalterados.

A única extensão de contexto é o digest experimental opt-in. Sem esse perfil, o cálculo de sourcePolicy anterior permanece igual. Relatório/duração não alteram a política de pontuação ou o contexto persistido. Falhas de observabilidade e publicação não reabrem transações nem mudam a idempotência.

## Validação executada e entrega

Linux, **Node 24.15.0 / npm 11.9.0**:

| Verificação                        | Resultado                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| Linha de base antes das alterações | 328/328 testes anteriores aprovados                                                  |
| `npm ci`                           | Aprovado, dependências e lockfile preservados                                        |
| `npm audit`                        | Zero vulnerabilidades reportadas                                                     |
| `npm run build`                    | Frontend público/admin, backend e tipos dos testes aprovados                         |
| `npm run build:homologation`       | Bundles reais aprovados, sem conectar ao TikTok                                      |
| `npm test`                         | **348/348**, 26 frontend + 322 backend; 328 anteriores + 20 novos; zero falhas/skips |
| `npm run check:media`              | Seis WebM íntegros por hash                                                          |
| `npm run format:check`             | Aprovado                                                                             |

Testes novos (incluindo alteração do baseline/digest e reconferência do original): plano pendente/14 regras, preservação dos quatro formatos/políticas, seis IDs/oito nomes com aprovações sintéticas, hipóteses/aceites faltantes, adulteração/duplicatas/pontos inválidos, CLI e arquivos novos, opt-in isolado, contexto experimental versus validado, uma conexão falsa processando os 14 itens, combos/retransmissões, rejeição de entrega, resultados reconhecidos/rejeitados e avaliação do relatório, manual após rejeição antes da admissão, deduplicação e estorno/replay, falha de log/arquivo, rollback SQL, publicação após commit, prazo de 35 minutos com relógio injetado e limite de 64 resultados/60 KiB. Não são testes de carga ou validação real de presentes.

Todos os testes e fixtures anteriores foram preservados, incluindo legado SQLite, painel HTTP/CSRF, WebSocket, snapshots, homologação isolada e comentários 13/22. A janela de 35 minutos foi verificada por relógio controlado, não por uma transmissão real de 35 minutos. O identificador `operator` do plano é uma declaração local de responsabilidade; não autentica o painel nem substitui suas credenciais.

Não houve conferência visual interativa ou conexão à plataforma. Nenhum catálogo privado, credencial operacional, `.env` real, banco histórico ou backup do operador foi aberto/modificado. Somente bancos/arquivos temporários dos testes foram usados. O manifesto real completo continua bloqueado pela ausência das quatro regras privadas e das dez decisões do operador; não foi produzido um manifesto operacional com políticas fictícias. O estado histórico informado pelo operador não foi reconsultado.

O npm emitiu os avisos ambientais de `http-proxy` e depreciação transitiva de `prebuild-install`; não houve EBADENGINE ou atualização de dependências para ocultar avisos.

Arquivos alterados: `.env.example` (somente exemplo), README, `catalog-tools/catalog.ts` e `phase56.ts` (caminho do validador), `catalog-tools/evidence.ts` e `main.ts`, novo `catalog-tools/experiment.ts`, `integration/config.ts` e `runtime.ts`, novos `integration/gift-policy.ts` e `runtime-report.ts`, `src/main.ts`, novo `tests/gift-experiment.test.ts`, documentação da Fase 5.6 e este guia. Motor/ingresso, SQLite/schema, protocolo WebSocket, fontes do painel/arena, vídeos e lockfile permanecem inalterados.
