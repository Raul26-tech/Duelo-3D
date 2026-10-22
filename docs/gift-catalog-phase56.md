# Fase 5.6 — catálogo de 14 candidatos e revisão de evidências

O PR #11 foi confirmado como integrado à `main` `8895bb7282d2cf1d9e2dc92b8c6a9bae5181f580`. A branch `feat/new-live-gifts` não existia e foi criada dessa revisão. Linha de base executada antes das alterações: **301/301 testes**. O objetivo desta fase é preparar a revisão supervisionada de presentes, sem conectar ao TikTok, preparar nossa LIVE ou criar uma disputa operacional.

A arena é uma interação informal de entretenimento, sem representar pesquisa eleitoral ou votação oficial.

## Seleção revisada e estados individuais

Fonte dos nomes, associação, pontos e modalidades propostas: `config/gift-catalog.reference.json`, preservado integralmente. Os dois candidatos além dos oito nomes literais e quatro autorizados são **Doughnut** e **Tiny Diny**.

| Nome literal inglês | ID de referência | Papel do ID                           | Participante | Pontos/unidade | Correspondência proposta        | Autorização relatada pelo operador | Entrega                             |
| ------------------- | ---------------- | ------------------------------------- | ------------ | -------------: | ------------------------------- | ---------------------------------- | ----------------------------------- |
| Rose                | 5655             | Observado em LIVE                     | Lula         |              2 | `id`                            | Autorizado anteriormente           | Preservar revisão privada existente |
| Finger Heart        | 5487             | Observado em LIVE                     | Lula         |             10 | `id`                            | Autorizado anteriormente           | Preservar revisão privada existente |
| Heart               | 5576             | Provisório/histórico, não autoriza ID | Lula         |             20 | `exact-name`: `Heart`           | Pendente                           | Não revisada                        |
| Doughnut            | 5879             | Observado em LIVE                     | Lula         |             50 | `id`                            | Pendente                           | Não revisada                        |
| Confetti            | 5585             | Provisório/histórico, não autoriza ID | Lula         |            200 | `exact-name`: `Confetti`        | Pendente                           | Não revisada                        |
| Money Gun           | 7168             | Provisório/histórico, não autoriza ID | Lula         |           1000 | `exact-name`: `Money Gun`       | Pendente                           | Não revisada                        |
| Galaxy              | 6364             | Provisório/histórico, não autoriza ID | Lula         |          10000 | `exact-name`: `Galaxy`          | Pendente                           | Não revisada                        |
| White Rose          | 8239             | Observado em LIVE                     | Flávio       |              2 | `id`                            | Autorizado anteriormente           | Preservar revisão privada existente |
| Overreact           | 19447            | Provisório/histórico, não autoriza ID | Flávio       |             10 | `exact-name`: `Overreact`       | Pendente                           | Não revisada                        |
| Tiny Diny           | 6560             | Observado em LIVE                     | Flávio       |             20 | `id`                            | Pendente                           | Não revisada                        |
| Capybara            | 14488            | Observado em LIVE                     | Flávio       |             50 | `id`                            | Autorizado anteriormente           | Preservar revisão privada existente |
| Hand Heart          | 6968             | Provisório/histórico, não autoriza ID | Flávio       |            200 | `exact-name`: `Hand Heart`      | Pendente                           | Não revisada                        |
| You're Amazing      | 9948             | Provisório/histórico, não autoriza ID | Flávio       |           1000 | `exact-name`: `You're Amazing`  | Pendente                           | Não revisada                        |
| Watermelon Love     | 6781             | Provisório/histórico, não autoriza ID | Flávio       |          10000 | `exact-name`: `Watermelon Love` | Pendente                           | Não revisada                        |

Há **seis IDs relatados como observados**, quatro presentes relatados como autorizados e dez pendentes. Observar o ID de Doughnut/Tiny Diny não valida entrega ou autorização. Os oito IDs históricos não são exportados pelas novas revisões `exact-name`; seus `ruleId` estáveis já existentes são usados no catálogo operacional. Nomes em português, traduções, espaços extras, diferenças de caixa ou aproximações não viram aliases.

A evidência operacional anterior informada pelo operador reconciliou Rose (13 unidades/26 pontos) e White Rose (1 unidade/2 pontos) com SQLite, e relatou quatro regras autorizadas por ID. As políticas privadas de entrega dos quatro presentes não estão disponíveis no repositório. Não foram inferidas, recriadas ou substituídas nesta fase; continuam nos arquivos do operador. Os testes usam políticas sintéticas explicitamente identificadas.

O campo histórico `deliveryStatus: unreviewed` da referência pública descreve a ausência de revisão pública de entrega; não revoga autorizações privadas existentes. O exemplo operacional público continua `[]`. Os quatro autorizados não são ativados automaticamente por instalação ou por constarem neste documento.

## Referência, relato, evidência e autorização

```bash
# Sem ler .env, bancos ou arquivos privados automaticamente
npm run catalog:gifts -- status

# Opcional: examinar explicitamente um catálogo confiável, somente leitura
npm run catalog:gifts -- status /caminho/privado/active.json
```

`status` lista os 14 candidatos e distingue:

- `idEvidence`/`referenceIdRole`: procedência do ID e uso apenas histórico quando aplicável.
- `reportedAuthorization`: quatro `operator-reported-authorized`, dez `pending`; é informação pública relatada, nunca uma autorização carregada pelo runtime.
- `configured`: `not-inspected`, `present` ou `absent`, conforme um operacional seja fornecido explicitamente.
- `reviewedDelivery`: `null` sem operacional inspecionado; política efetiva somente quando presente no arquivo selecionado.
- `authorizationGrantedByThisTool: false`: listar ou analisar nunca ativa um presente.

As regras operacionais são validadas pelo contrato existente; valores/candidatos/nomes divergentes da referência e regras desconhecidas são recusados pelo comando. Arquivos privados só são lidos quando selecionados explicitamente pelo operador. Não imprimir nem compartilhar esses arquivos junto aos relatórios.

## Observação real posterior, supervisionada e sem pontos

**Este roteiro não foi executado com uma LIVE nesta implementação.** O operador deve escolher uma transmissão pública acessível e autorizada para observação. Não utilizar o banco operacional anterior, não executar `npm run dev` em modo real e não trocar o catálogo de uma disputa em andamento.

Use um terminal dedicado sem variáveis operacionais exportadas. A opção nova `--no-env` no **diagnóstico existente** evita carregar o `.env` do projeto; recusa modo diferente de observação, real/admin habilitados e caminhos exportados de catálogo/banco. Não altere o `.env` operacional para realizar o teste. O conector permanece desligado por padrão.

Crie um diretório externo privado e escolha um nome de relatório novo. A execução a seguir só deve ser feita posteriormente pelo operador, com o handle real que ele selecionar:

```bash
install -d -m 700 "$HOME/.local/state/duelo-3d-observation"

DUEL_MODE=observation \
TIKTOK_REAL_ENABLED=false \
ADMIN_ENABLED=false \
TIKTOK_DIAGNOSTIC_ENABLED=true \
TIKTOK_USERNAME=HANDLE_ESCOLHIDO_PELO_OPERADOR \
TIKTOK_GIFT_REPORT="$HOME/.local/state/duelo-3d-observation/gifts-run-01.json" \
npm run diagnose:tiktok -- --no-env
```

Se existirem `TIKTOK_DATABASE`/`TIKTOK_GIFT_CATALOG` ou outras configurações conflitantes exportadas, o comando recusa o início. Abra um terminal limpo ou remova apenas as exportações desse terminal; não apague arquivos. Se o ambiente exigir chave de assinatura, utilize o mecanismo privado existente, sem escrevê-la na linha de comando, no relatório ou no repositório. A opção `--no-env` não impede leitura de arquivos explicitamente indicada pelo operador nem carrega automaticamente credenciais de outro local.

O entrypoint dedicado não importa o motor, SQLite ou administração e não fornece hook de pontuação ao cliente. Observação não é disputa: `domain: observation`, `scoringEligible: false`. Ao receber presentes espontâneos, observe um tipo por vez quando possível. Não iniciar/encerrar uma LIVE, comprar/enviar presentes ou interagir automaticamente. Ctrl+C encerra **o conector local**, não a transmissão. O limite existente é cinco minutos e a reconexão continua no cliente já implementado.

O relatório é salvo no encerramento controlado, em arquivo externo novo 0600, sem sobrescrita. Queda forçada/SIGKILL pode impedir a gravação completa; um arquivo vazio/incompleto não é evidência válida. Não promover relatório de uma execução com falhas como validação conclusiva.

## O que o relatório observa e o que ele não comprova

Reutiliza `createGiftReport`, `withGiftReport`, normalizador, observer, ciclo de vida e logs existentes. O agregado mantém `schema: 1` e acrescenta `evidenceVersion: 1`:

| Campo                                           | Natureza da evidência                                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `giftId`, `names`                               | ID externo decimal preservado como string e até dois nomes públicos entregues pelo conector; não significa identidade confirmada                               |
| `notifications`, `invalid`, `insufficient`      | Quantidade de notificações e classificação estrutural; notificações não são unidades pontuadas                                                                 |
| `giftTypes`, `comboFlags`                       | Valores do payload `gift.type`/`gift.combo`; não são uma política de entrega aprovada                                                                          |
| `withGroupId`/`withoutGroupId`                  | Presença de grupo, sem gravar o identificador ou dados do usuário                                                                                              |
| `repeatCountMin`/`repeatCountMax`, flags finais | Extremos da contagem e contadores de `repeatEnd` 0/1/ausente                                                                                                   |
| `notes`                                         | Retransmissão candidata, conflito de identidade, repetição/regressão, contexto, finalização e limites detectados pelo observer                                 |
| `evidence`                                      | Cobertura de ocorrência/usuário/sala e nome, contagens de descartes, até oito amostras públicas `{repeatCount, repeatEnd, hasGroupId}` em ordem de notificação |

O agregado não grava IDs de usuários, ocorrências, sala ou grupos, texto de comentários, cookies, tokens ou assinaturas. Os logs existentes pseudonimizam identidades. Campos desconhecidos não entram na avaliação offline. IDs de presentes e nomes públicos são os únicos identificadores legíveis necessários à revisão.

Limites: 32 IDs de presentes, 30.000 notificações, dois nomes por ID com 128 caracteres, oito amostras por ID e relatório serializado limitado. Descartes, nomes excedentes e amostras omitidas são explicitamente contados. O observer tem capacidades/janelas próprias, pode interromper sequências e gera indícios, não deduplicação permanente.

As oito amostras são de **notificações do presente**, podendo intercalar atores/grupos diferentes. Não comprovam sozinhas uma sequência individual ou uma quantidade total. A mesma ocorrência pode reaparecer; um final repetido não comprova duas entregas. Sem identidade/finalização comprovadas, não aprovar combo. Variação de ID por nome pode gerar alertas conservadores de contexto no observer existente: revisão humana é necessária.

`tiktok-live-connector@2.5.0` não é uma garantia oficial do TikTok. Defaults da desserialização podem fazer um campo parecer presente, e `repeatCount`, `repeatEnd`, `gift.type`, `gift.combo` e `groupId` não têm semântica universal comprovada para todos os presentes. O relatório agregado não conserva o payload bruto nem prova a origem oficial de cada flag. Campos ausentes/contraditórios, limites, desconexões e entregas diferentes permanecem pendências. Identificação por nome não dispensa ID externo da ocorrência/presente nem os demais requisitos de identidade existentes.

## Avaliar as evidências offline

```bash
npm run catalog:gifts -- assess \
  "$HOME/.local/state/duelo-3d-observation/gifts-run-01.json" \
  --output "$HOME/.local/state/duelo-3d-observation/assessment-run-01.json"
```

O comando valida estritamente o agregado e produz um relatório dos 14 candidatos, notificações públicas referenciadas por ID, itens não reconhecidos e motivos para revisão. Sinaliza ID/nome contraditório, nome esperado ausente, ID divergente sem fallback, ID histórico sem valor de identidade, campos insuficientes, ciclo não finalizado, flags de entrega incoerentes, regressões, contexto e limites. Um evento que coincida apenas com o ID histórico de um item por nome não confirma esse presente.

`observations` contém cada linha agregada uma única vez; `observedGiftIds` liga as evidências aos candidatos. Relatórios antigos sem cobertura/amostras continuam legíveis, mas recebem pendência explícita. Campos privados extras, identidades repetidas no agregado, tipos inválidos e contadores inconsistentes são recusados. Saída acima de 60 KiB é recusada antes de criar arquivo; faça observações menores.

Mesmo que `concerns` esteja vazio, todos os itens continuam com `identityConfirmedByThisTool: false`, `operatorReviewRequired: true`, `deliveryAuthorizedByThisTool: null`; o resultado global nunca concede autorização. Um arquivo manipulado localmente pode parecer observação válida: não há assinatura da plataforma. Conservar a procedência e a revisão do operador é indispensável.

## Revisão explícita e geração sem perder os quatro existentes

1. Preserve o catálogo e as revisões privadas aprovadas. Não recrie os quatro registros a partir desta tabela, pois suas políticas privadas não estão publicadas.
2. Use `catalog:gifts template --output /novo/reviews.json` **apenas como rascunho pendente**, nunca como substituto de revisões existentes. Ele começa sem aprovações ou entrega definida.
3. Para cada candidato novo, confira a fonte da observação, ID real quando `match: id`, nome inglês literal, identidade da ocorrência/usuário/sala, campos do conector e finalização. Documente evidências e pendências externamente, sem dados pessoais desnecessários.
4. Escolha `single` somente após demonstrar unidade, finalização e ausência de combo; `cumulative-final` exige evidência da contagem acumulativa, grupo confiável e finalização explícita. Não atribuir essa política aos 14 itens por padrão. Dados insuficientes mantêm `operatorApproved: false` e entrega `null`.
5. Preencha os campos de revisão existentes: `observedName`, `nameConfirmed`, `connectorFieldsReviewed`, `delivery`, `repeatCount`, `repeatEnd`, `groupId`, versão fixada e aprovação consciente. `idConfirmed` é obrigatório para reconhecimento por ID. Para os oito nomes, `match: exact-name` conserva o `ruleId` existente e nunca exporta o ID provisório como autorização.
6. Prepare um arquivo de **revisões completo**, conservando os quatro registros privados anteriores e adicionando apenas as novas revisões aprovadas. Não mude o formato legado/`match`, pontos, candidato ou entrega dos registros anteriores.

```bash
npm run catalog:gifts -- validate /privado/full-reviews.json
npm run catalog:gifts -- extend /privado/current-active.json /privado/full-reviews.json \
  --output /privado/new-candidate-active.json
npm run catalog:gifts -- verify /privado/full-reviews.json /privado/new-candidate-active.json
npm run catalog:gifts -- status /privado/new-candidate-active.json
```

`extend` gera um **arquivo candidato novo**, exigindo todas as revisões explícitas. Recusa a retirada/alteração de qualquer regra do catálogo anterior, inclusive pontos, entrega e modalidade/formato legado; duplicatas/ambiguidades e autorizações incompletas também falham. Não copia aprovações apenas porque um presente está no relato público, na referência ou no relatório observado. Se as revisões anteriores não estiverem disponíveis, interrompa a geração e recupere-as com o operador; não invente valores para passar na validação.

Nenhum comando altera `.env`, catálogo em uso ou banco. A CLI não configura automaticamente `TIKTOK_GIFT_CATALOG`, habilita real/admin ou cria disputa. O operador é responsável por selecionar os arquivos privados corretos; a ferramenta não prova que um arquivo escolhido explicitamente foi autorizado em outra execução.

**Gerar um candidato não autoriza sua aplicação em uma disputa existente.** Catálogo/política fazem parte do contexto persistido: o SQLite continua recusando `resume` com catálogo modificado. Não contornar a proteção, reescrever journal, migrar/reinicializar banco ou criar disputa para testar este trabalho. A decisão de adoção operacional fica fora desta implementação.

## Painel, motor e recuperação

O painel continua listando somente o catálogo operacional passado pelo runtime. Nenhum dos metadados/relatórios públicos alimenta essa lista. Novas regras `exact-name` aprovadas são selecionadas por `ruleId`; o backend calcula pontos por unidade e quantidade, mantém idempotência, estorno e correção auditáveis. O navegador não escolhe pontos nem administra a arena pelo WebSocket.

Não há mudanças em scoring, persistência, SQLite/schema, runtime de pontuação, autorização administrativa ou arena. Testes offline usam apenas bancos temporários sintéticos para comprovar novo catálogo no painel, cálculo, replay, rollback, recuperação de combo por nome e recusa de troca silenciosa. Nenhuma disputa operacional foi aberta/criada.

## Critérios de conclusão

A preparação técnica termina com os 14 itens preservados, quatro autorizações relatadas separadas de dez pendências, diagnóstico/avaliação e geração protegida disponíveis, testes completos aprovados e documentação. A **autorização operacional dos dez novos itens permanece pendente**, individualmente, até a análise do operador de eventos reais e das respectivas identidades/entregas. Não depende apenas de testes sintéticos ou de um relatório sem alertas.

## Validação técnica executada

Linux, **Node 24.15.0**, npm **11.9.0**. Linha de base: 301/301 testes no Node 24.19.0 disponível inicialmente. A validação final foi executada na versão mínima:

| Comando                                                      | Resultado                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `npm ci`                                                     | Aprovado, 162 pacotes, sem mudança de dependências/lockfile                          |
| `npm audit`                                                  | Zero vulnerabilidades reportadas                                                     |
| `npm run build`                                              | Frontend público, painel administrativo, backend e tipos dos testes aprovados        |
| `npm test`                                                   | **328/328**, 26 frontend + 302 backend; 301 anteriores + 27 novos; zero falhas/skips |
| `npm run check:media`                                        | Seis WebM preservados por hash                                                       |
| `npm run format:check`                                       | Aprovado                                                                             |
| `npm run catalog:gifts -- status`                            | CLI executada; 14 candidatos, sem ler operacional automaticamente                    |
| Diagnóstico `--no-env` com `TIKTOK_DIAGNOSTIC_ENABLED=false` | Executado pela raiz; terminou `disabled`, sem conexão                                |

Os 27 testes novos cobrem os 14 presentes por ID/nome com aprovações **sintéticas**, ausência/contradição de identidade, desconhecidos, catálogo sem aprovação, pontos/candidato divergentes, extensão e preservação de regras legadas, entrega não revisada, amostras/limites/privacidade, agregado legado, parser estrito, arquivos novos, provedor falso sem pontuação, combo acumulativo com variação de ID, retransmissão, rollback e recuperação SQLite, bloqueio de troca de catálogo e HTTP administrativo autenticado com lançamento/estorno/correção/replay. Um subprocesso proíbe SDK, SQLite, rede e leitura de `.env` para verificar o modo desabilitado `--no-env` e a recusa de configurações conflitantes.

Os testes e fixtures anteriores foram mantidos, incluindo journal legado, autorização/CSRF, WebSocket após commit, snapshot/reconexão, homologação isolada, comentários 13/22, arena e seis mídias. Não foram adicionados testes de carga.

O npm emitiu os avisos ambientais de configuração `http-proxy` e depreciação transitiva de `prebuild-install`; não houve EBADENGINE. Nenhuma dependência foi atualizada para ocultar avisos.

**Limitações:** nenhuma conexão real, compra/envio de presente ou conferência visual interativa foi realizada. Nenhum banco operacional foi criado, aberto, migrado ou alterado. Os arquivos privados de autorização/revisão dos quatro presentes não estão disponíveis neste checkout; sua continuidade foi preservada mantendo o runtime/motor/persistência/painel e testando exemplos representativos nos formatos atual e legado, sem afirmar que os arquivos privados foram revalidados. A coleta real, confirmação individual de entrega/identidade e aprovação dos dez pendentes dependem do operador, posteriormente.

Arquivos deste ajuste: README; CLI `catalog-tools/main.ts`; novos `catalog-tools/phase56.ts` e `catalog-tools/evidence.ts`; agregado `tiktok/gift-report.ts`; entrypoint diagnóstico `tiktok/main.ts`; encaminhamento de argumentos em `package.json`; novo teste `gift-phase56.test.ts`; este documento. A referência JSON dos 14 itens, exemplo operacional vazio, motor, SQLite/schema, integração de pontuação, credenciais, painel/arena, HTML/CSS, animações, vídeos e lockfile não foram modificados.

## Complemento 5.6.1 — manifesto experimental, não validação automática

O procedimento de [homologação experimental](gift-experimental-homologation.md) acrescenta plano por item e manifesto separado para os 14 presentes, exigindo cópia explícita das quatro regras privadas e decisão justificada para cada uma das dez hipóteses de entrega. Sem essas decisões, o catálogo permanece bloqueado; não há preenchimento arbitrário de `single` ou confirmação fictícia de evidências. O manifesto não é aceito como catálogo validado, exige opt-in experimental no runtime e fica vinculado a um contexto SQLite distinto.

O próprio runtime pode gerar relatório limitado de sua conexão por até 35 minutos, sem segunda conexão e sem capacidade de pontuar pelo diagnóstico. `assess` aceita também esse envelope. O diagnóstico independente de cinco minutos permanece preservado. Nenhuma disputa operacional, conexão real ou configuração da próxima LIVE foi criada nesta fase; decisões e preparação da Fase 5.7 permanecem com o operador.
