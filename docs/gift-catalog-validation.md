# Fase 5.3 — referência, revisão e catálogo operacional

Duelo 3D é uma interação informal de entretenimento. Não representa pesquisa eleitoral, pesquisa representativa ou votação oficial.

## Origem e situação dos 14 presentes

O PR #8 e o ajuste dos comentários 13/22 foram confirmados na main `4cb21a8a78d8a615e0df211ca2eedc6cd040ff65` antes de iniciar esta branch. Os nomes, IDs, participantes e pontos abaixo reproduzem a definição explícita do operador; não foram pesquisados, adivinhados ou alterados.

| Presente        | ID    | Participante | Pontos por unidade | Procedência do ID                        | Entrega      |
| --------------- | ----- | ------------ | ------------------ | ---------------------------------------- | ------------ |
| Rose            | 5655  | Lula         | 2                  | LIVE de terceiro, relato do operador     | não revisada |
| Finger Heart    | 5487  | Lula         | 10                 | LIVE de terceiro, relato do operador     | não revisada |
| Heart           | 5576  | Lula         | 20                 | repositórios/outros projetos, provisório | não revisada |
| Doughnut        | 5879  | Lula         | 50                 | LIVE de terceiro, relato do operador     | não revisada |
| Confetti        | 5585  | Lula         | 200                | repositórios/outros projetos, provisório | não revisada |
| Money Gun       | 7168  | Lula         | 1000               | repositórios/outros projetos, provisório | não revisada |
| Galaxy          | 6364  | Lula         | 10000              | repositórios/outros projetos, provisório | não revisada |
| White Rose      | 8239  | Flávio       | 2                  | repositórios/outros projetos, provisório | não revisada |
| Overreact       | 19447 | Flávio       | 10                 | repositórios/outros projetos, provisório | não revisada |
| Tiny Diny       | 6560  | Flávio       | 20                 | LIVE de terceiro, relato do operador     | não revisada |
| Capybara        | 14488 | Flávio       | 50                 | LIVE de terceiro, relato do operador     | não revisada |
| Hand Heart      | 6968  | Flávio       | 200                | repositórios/outros projetos, provisório | não revisada |
| You're Amazing  | 9948  | Flávio       | 1000               | repositórios/outros projetos, provisório | não revisada |
| Watermelon Love | 6781  | Flávio       | 10000              | repositórios/outros projetos, provisório | não revisada |

São **cinco IDs observados pelo operador e nove provisórios**. Relato de observação de ID não confirma correspondência do nome, unicidade de ocorrência, tipo de entrega, ciclo de combo ou autorização para pontuar. Nenhum dos 14 teve sua entrega validada nesta implementação.

## Três arquivos com responsabilidades distintas

- `config/gift-catalog.reference.json`: referência versionada dos 14 itens. Campos `giftId`, `name`, `candidate`, `points`, `provenance` e `deliveryStatus`. `operator-reported-live` registra o relato do operador; `external-unconfirmed` significa provisório. `deliveryStatus` permanece `unreviewed` como situação inicial da referência.
- Arquivo local de revisões: criado pela CLI, fora do repositório. Registra verificações independentes por ID. Pode conter todos os itens pendentes ou apenas os itens em revisão; omitir um item nunca o autoriza. Não é um catálogo operacional e não deve ser usado em `TIKTOK_GIFT_CATALOG`.
- Catálogo operacional local: array de objetos contendo exatamente `giftId`, `name`, `candidate`, `points`, `delivery`. Esse é o contrato **existente** de `TIKTOK_GIFT_CATALOG`. O backend já remove `delivery` antes de passar as quatro propriedades do `GiftRule` ao motor. Metadados de revisão não entram no motor, no hash da política ou no SQLite.

O operacional inicial continua sendo `config/gift-catalog.example.json`, com **`[]`**. Sem `TIKTOK_GIFT_CATALOG` a configuração do backend também continua vazia. A referência não é importada pelo runtime real e não seleciona presentes automaticamente. A CLI não altera `.env`, não inicia conexão, não abre SQLite e não habilita o modo real.

## CLI local

Requer Node 24.15+ na linha 24 e a instalação npm usual. Sem novas bibliotecas.

```bash
npm ci
npm run catalog:gifts -- list

mkdir -p "$HOME/.config/duelo-3d"
npm run catalog:gifts -- template --output "$HOME/.config/duelo-3d/reviews-01.json"
npm run catalog:gifts -- list "$HOME/.config/duelo-3d/reviews-01.json"
npm run catalog:gifts -- validate "$HOME/.config/duelo-3d/reviews-01.json"
```

O template começa sem aprovações. Os cinco IDs já relatados como observados recebem somente `idConfirmed=true`; todos mantêm nome, campos, entrega e aprovação pendentes. Os nove provisórios começam com `idConfirmed=false`. Nenhum recebe `single` ou `cumulative-final` automaticamente.

Edite o arquivo de revisões manualmente, verificando cada item. `list` mostra procedência, campos pendentes, entrega revisada e elegibilidade. `validate` distingue um documento estruturalmente válido com itens pendentes de um item marcado como aprovado mas incompleto: pendências não aprovadas são permitidas como planejamento, mas uma aprovação incompleta causa erro e impede a geração de todo o operacional.

| Campo da revisão          | Condição para autorizar                                                      |
| ------------------------- | ---------------------------------------------------------------------------- |
| `giftId`                  | string decimal exata, conhecida na referência; nunca substituída pelo nome   |
| `idConfirmed`             | `true`, com confirmação explícita também para qualquer ID provisório         |
| `observedName`            | nome efetivamente observado, exatamente igual ao nome esperado da referência |
| `nameConfirmed`           | `true`, após revisar a correspondência ID/nome                               |
| `connectorVersion`        | exatamente `tiktok-live-connector@2.5.0`                                     |
| `connectorFieldsReviewed` | `true`, após examinar os campos desse conector                               |
| `delivery`                | classificação independente: `single` ou `cumulative-final`                   |
| `repeatCount`             | `unit` para single ou `cumulative` para combo                                |
| `repeatEnd`               | `explicit-final`, consistente com o validador existente                      |
| `groupId`                 | `not-required` para single ou `sequence` para combo                          |
| `operatorApproved`        | `true` somente após todas as confirmações anteriores                         |

Nomes localizados ou divergentes não são aproximados. Se o nome ou ID esperado precisar mudar, interrompa a habilitação e solicite aprovação para corrigir a referência. O arquivo de revisão não aceita sobrescrever nome, participante ou pontos.

Depois da revisão, gere um arquivo **novo** e verifique-o:

```bash
npm run catalog:gifts -- prepare "$HOME/.config/duelo-3d/reviews-01.json" --output "$HOME/.config/duelo-3d/active-01.json"
npm run catalog:gifts -- verify "$HOME/.config/duelo-3d/reviews-01.json" "$HOME/.config/duelo-3d/active-01.json"
```

Sem itens explicitamente aprovados, o resultado é `[]`. Somente itens integralmente aprovados são exportados. `verify` usa o mesmo parser operacional do backend e compara também com a seleção autorizada, rejeitando alteração de pontos, candidato, tipo de entrega, campos extras ou inclusão não autorizada. Não há comando para aprovar todos ou opção `--force`.

Arquivos de saída precisam ter caminho absoluto `.json`, pai já existente e ficar fora do repositório/build, inclusive por symlink. São criados com permissão 0600 e criação exclusiva (`wx`): arquivo existente nunca é substituído. A ferramenta não sabe se um catálogo está em uso e, por isso, não sobrescreve **nenhum** existente. Use outro nome de arquivo para uma nova preparação. Entradas/revisões/operacionais têm limite de 64 KiB.

Os comandos também estão disponíveis em `apps/backend` com `npm run catalog:gifts -- ...`. Após build, `node apps/backend/dist/catalog-tools/main.js list` usa os mesmos arquivos de referência, resolvidos pelo módulo, independentemente do diretório de execução.

## Diagnóstico agregado opcional

O comando existente `npm run diagnose:tiktok` pode gerar um agregado local. Isso é opcional e não altera o comportamento padrão dos logs. A opção está disponível no entrypoint dedicado de diagnóstico; `npm run dev` em observation continua usando seu diagnóstico existente, sem gerar esse arquivo.

Somente quando houver uma LIVE acessível e autorização do operador, configure a conta e o eventual serviço de assinatura conforme a Fase 5.1. Exemplo de execução **manual posterior**, sem iniciar transmissão ou enviar interações:

```bash
mkdir -p "$HOME/.local/state/duelo-3d"
DUEL_MODE=observation TIKTOK_REAL_ENABLED=false TIKTOK_DIAGNOSTIC_ENABLED=true \
TIKTOK_GIFT_REPORT="$HOME/.local/state/duelo-3d/gift-report-01.json" \
npm run diagnose:tiktok
```

O arquivo deve ser novo e fora do projeto. A configuração é validada e o destino reservado antes de iniciar a conexão. Diagnóstico desligado não cria arquivo nem conector. O processo mantém o limite existente de cinco minutos e encerramento por Ctrl+C. Ao encerrar controladamente, salva o relatório agregado; falha de escrita tem mensagem genérica e saída não zero. Interrupção abrupta pode deixar um arquivo incompleto: não o considere evidência concluída.

O agregado informa IDs públicos de presentes como strings, até dois nomes públicos por item, contagem de notificações, `gift.type`, `gift.combo`, presença/ausência de `groupId`, mínimo/máximo de `repeatCount`, flags `repeatEnd` e contagens das notas de diagnóstico: progressão, repetição, regressão, conflito de identidade/contexto e final explícito. As notas são inferências do observador existente; flags e contagens são campos confirmados pelo payload. Ausências/inconsistências não viram dados confiáveis por inferência.

O relatório não inclui IDs de usuários, salas, sequências, ocorrências, texto de comentários, payloads brutos, cookies, assinaturas ou credenciais. O `groupId` aparece apenas como presença/ausência. A correlação de sequências pode ser inspecionada nos logs pseudonimizados existentes. A coleta não tenta descobrir um ID por nome.

Limites: até 32 IDs de presente, 30000 notificações agregadas, dois nomes de até 128 unidades UTF-16 por ID e até oito valores distintos de tipo. O relatório serializado é limitado a 60000 bytes, removendo linhas finais se necessário. `dropped` indica notificações descartadas por capacidade/tamanho; `missingGiftIds` registra IDs ausentes. Campos fora desses limites não são prova de ausência. O limite defensivo existente de recepção também pode descartar dados em diagnóstico. Não se promete captura completa.

Todo agregado mantém `domain=observation`, `scoringEligible=false`, `semanticsConfirmed=false` e `requiresOperatorReview=true` em cada item. Não é aceito como arquivo de revisão ou catálogo ativo. Não preenche automaticamente nenhuma aprovação. Os registros de revisão são atestações locais do operador, sem assinatura ou garantia oficial da plataforma; o relatório é um auxílio à revisão, não uma certificação.

## Roteiro de confirmação por presente

1. Mantenha pontuação real desligada. Selecione um presente por vez para revisão em diagnóstico autorizado.
2. Confirme o ID decimal real e o nome exato no agregado; não use somente nome/ícone e não transforme IDs ausentes em valores adivinhados.
3. Confira a versão fixada do conector e seus campos `giftId`, `gift.id`, `common.msgId`, `common.roomId`, `gift.type`, `gift.combo`, `repeatCount`, `repeatEnd`, `groupId`. Identidade e contexto continuam sujeitos às verificações já existentes da integração real; não registre IDs pessoais em arquivo de revisão.
4. Para single, confirme não combinável (`gift.type` diferente de 1 e `gift.combo=false`), quantidade unitária e final explícito numérico 1, como exige o validador atual. Ausência de `groupId` não impede single quando sua semântica for efetivamente não aplicável.
5. Para combo, confirme para esse ID que as notificações são acumulativas, `groupId` é confiável para a sequência e o final numérico `repeatEnd=1` declara seu total. O backend exige também `gift.type=1` e `gift.combo=true`. Não classifique por semelhança com Rose ou outro presente. Flag defaultável, final ausente, ordem/contexto contraditório ou sequência ambígua mantêm o item pendente.
6. Compare retransmissões e finalizações usando os pseudônimos existentes, observe desconexões e repita a revisão quando a evidência for insuficiente. Um caso observado não garante todos os presentes ou reconexões.
7. Registre as confirmações e só então marque `operatorApproved=true`. Um ID provisório exige sua própria confirmação explícita antes dessa etapa. Valide e gere um novo operacional; examine sua lista antes de uso.

Os exemplos 1 Rose = 2 pontos, 10 Roses = 20 em combo final válido, 1 Tiny Diny = 20 e 3 Capybaras = 150 em combo final válido são cobertos **como cenários sintéticos condicionais**. Nenhum demonstra que esses presentes reais possuem determinado ciclo de entrega. O engine existente continua não somando intermediárias, deduplicando ocorrências e finalizações e mantendo overflow/capacidade/rollback.

## Uso posterior e recuperação

A CLI não habilita pontuação real, nem altera `TIKTOK_GIFT_CATALOG` ou o banco. Depois de revisar o arquivo, o operador pode selecioná-lo manualmente em `TIKTOK_GIFT_CATALOG` para uma disputa explicitamente configurada conforme a Fase 5.2. Modo real continua desligado por padrão.

Uma disputa persistida exige o mesmo catálogo e política na retomada. Gerar outro arquivo não permite substituição silenciosa numa disputa em andamento: o hash/persistência existentes continuam recusando contexto diferente. Não edite um arquivo ativo em uso para contornar o controle. Um catálogo diferente requer planejamento de outra disputa e criação explícita de banco novo; não apague/migre a disputa anterior. Arquivo novo com conteúdo efetivamente idêntico não muda as regras.

Não houve alteração no engine de presentes/comentários, SQLite, protocolo WebSocket, permissões, frontend, HTML/CSS, animações ou WebM. A CLI reusa os validadores existentes, sem segundo motor de pontos. Os comentários 13/22 e o replay versionado permanecem intactos. Não há painel web, novos endpoints, testes de carga ou ativação da Fase 5.4.
