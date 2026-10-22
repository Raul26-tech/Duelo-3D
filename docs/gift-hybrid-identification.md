# Fase 5.4 — identificação híbrida de presentes

Duelo 3D é uma interação informal de entretenimento. Não representa pesquisa eleitoral, pesquisa representativa nem votação oficial.

## Situação e escopo

PR #9 integrado e `main` `1782422c0325b83f50412af84aafe1f5250f8dde` conferidos antes das alterações. Branch `feat/gift-hybrid-identification` criada dessa referência. Sem nova biblioteca, provedor ou API pública de pontuação.

**14 presentes preparados, zero autorizados por padrão.** `config/gift-catalog.example.json` continua `[]`; o runtime não importa a referência. O modo real continua desligado por padrão. Nenhum ciclo de entrega foi validado em LIVE nesta implementação.

| Modalidade | Presente        | Identidade na referência | Participante | Pontos |
| ---------- | --------------- | ------------------------ | ------------ | -----: |
| id         | Rose            | 5655                     | Lula         |      2 |
| id         | Finger Heart    | 5487                     | Lula         |     10 |
| id         | Doughnut        | 5879                     | Lula         |     50 |
| id         | Tiny Diny       | 6560                     | Flávio       |     20 |
| id         | Capybara        | 14488                    | Flávio       |     50 |
| id         | White Rose      | 8239                     | Flávio       |      2 |
| exact-name | Heart           | name:heart               | Lula         |     20 |
| exact-name | Confetti        | name:confetti            | Lula         |    200 |
| exact-name | Money Gun       | name:money-gun           | Lula         |   1000 |
| exact-name | Galaxy          | name:galaxy              | Lula         |  10000 |
| exact-name | Overreact       | name:overreact           | Flávio       |     10 |
| exact-name | Hand Heart      | name:hand-heart          | Flávio       |    200 |
| exact-name | You're Amazing  | name:youre-amazing       | Flávio       |   1000 |
| exact-name | Watermelon Love | name:watermelon-love     | Flávio       |  10000 |

White Rose foi confirmado pelo operador no pedido da Fase 5.4. São agora seis IDs relatados como confirmados; isso não valida `repeatCount`, `repeatEnd`, `groupId`, nome recebido ou entrega. Em particular Doughnut e Tiny Diny não recebem entrega automática. Os oito IDs provisórios anteriores permanecem em `giftId` na referência apenas como registro histórico/chave de revisão. Não são exportados como autorização nos itens por nome e não são atualizados automaticamente por observações.

## Contrato operacional

Mantém-se `TIKTOK_GIFT_CATALOG` apontando para JSON externo. Formato novo, campos exatos:

```json
[
    {
        "match": "id",
        "giftId": "5655",
        "name": "Rose",
        "candidate": "lula",
        "points": 2,
        "delivery": "single"
    },
    {
        "match": "exact-name",
        "ruleId": "name:heart",
        "name": "Heart",
        "candidate": "lula",
        "points": 20,
        "delivery": "cumulative-final"
    }
]
```

**Exemplo sintético de contrato, não catálogo aprovado para uso real.** As entregas mostradas não constituem evidência de comportamento desses presentes. Cada entrega precisa ser revisada individualmente.

`id` exige ID decimal positivo como string. `exact-name` exige `ruleId` estável no padrão `name:[a-z][a-z0-9-]{0,63}` e não aceita `giftId` operacional. Participante e pontos vêm somente desse catálogo; pontos são inteiros positivos seguros. Preços, diamantes, moedas e pontos em payloads externos não são utilizados.

Comparação de nomes é **literal**, incluindo caixa, espaços, acentos e pontuação; não há normalização. `Heart`, `Finger Heart` e `Hand Heart` são diferentes; `Rose` e `White Rose` também. `You're Amazing` não aceita `You're awesome`. Nomes duplicados entre quaisquer modalidades impedem ativação. O resolvedor rejeita ambiguidade defensivamente mesmo se chamado com regras não validadas.

Em `id`, nome ausente é permitido; se o nome estiver presente deve ser exatamente o autorizado. Um ID conhecido com nome contraditório é rejeitado **antes de qualquer fallback por nome**. Em `exact-name`, o ID externo continua obrigatório e íntegro como identidade do provedor; pode divergir do histórico sem mudar a regra. ID externo ausente, inseguro ou contraditório entre campos não é reparado pelo nome.

Catálogos legados com os cinco campos `giftId`, `name`, `candidate`, `points`, `delivery` continuam sendo interpretados como `id`. Não se injeta `match` ao canonicalizá-los: formato, ordenação e hash da política legados permanecem iguais. Recebimentos novos também verificam nomes contraditórios quando presentes. O replay de eventos históricos conserva sua semântica original, inclusive ausência de nomes no journal.

## Revisão e ativação controlada

```bash
npm ci
npm run catalog:gifts -- list
mkdir -p "$HOME/.config/duelo-3d"
npm run catalog:gifts -- template --output "$HOME/.config/duelo-3d/reviews-02.json"
npm run catalog:gifts -- list "$HOME/.config/duelo-3d/reviews-02.json"
```

O template inclui a modalidade da referência. Nenhum item começa aprovado. Os seis IDs confirmados recebem somente `idConfirmed=true`. Para `exact-name`, `idConfirmed` pode continuar falso: o ID histórico não participa da autorização. A modalidade de uma revisão nova deve coincidir com a referência; não basta promover o ID provisório mudando `match`.

Para cada item, o operador deverá:

1. Observar o payload com o diagnóstico existente, sem pontuação. Não enviar presentes pagos automaticamente ou iniciar uma LIVE.
2. Em `id`, comprovar o ID exato e conferir o nome recebido. Em `exact-name`, conferir o nome literal completo, sem inferi-lo de outra fonte. Não registrar automaticamente novos IDs.
3. Revisar os campos de `tiktok-live-connector@2.5.0`, identidade da ocorrência, sala, usuário e contexto da sequência.
4. Classificar entrega `single` ou `cumulative-final`. Single exige quantidade 1, final explícito, tipo diferente de 1 e `combo=false`. Combo exige tipo 1, `combo=true`, quantidade acumulativa inteira positiva, `groupId` íntegro e final explícito; intermediárias não pontuam.
5. Preencher `observedName`, `nameConfirmed`, `connectorFieldsReviewed`, `delivery`, `repeatCount`, `repeatEnd`, `groupId` e, somente após a revisão, `operatorApproved=true`. Em modo ID também é obrigatório `idConfirmed=true`.

Não é possível aprovar um item apenas por seu nome conhecido. Revisões legadas sem `match` continuam com as exigências de confirmação de ID da Fase 5.3, para verificar catálogos locais já preparados; não são convertidas automaticamente para nome.

```bash
npm run catalog:gifts -- validate "$HOME/.config/duelo-3d/reviews-02.json"
npm run catalog:gifts -- prepare "$HOME/.config/duelo-3d/reviews-02.json" --output "$HOME/.config/duelo-3d/active-02.json"
npm run catalog:gifts -- verify "$HOME/.config/duelo-3d/reviews-02.json" "$HOME/.config/duelo-3d/active-02.json"
```

Saída nova, fora do repositório/build, permissão 0600, criação exclusiva; não há sobrescrita, edição de banco ou ativação do modo real. Use `TIKTOK_GIFT_CATALOG` somente depois da revisão e seleção consciente da disputa. Não troque o catálogo de uma disputa em andamento. Mudança de nome, pontos, modalidade, regra, entrega ou política exige outra configuração/disputa explicitamente criada; nunca contorne a recusa de `resume` ou apague o banco anterior.

## Pipeline, identidade e persistência

O mesmo motor e coordenador continuam autoritativos. O adaptador valida fonte/sala/ocorrência/ator, resolve a regra e valida entrega. O motor revalida a correspondência configurada nos eventos novos; o adaptador não escolhe pontos. Commit SQLite continua anterior à publicação WebSocket. Não há endpoint para o navegador enviar presentes confiáveis, votos ou reset reais.

Novos recebimentos com catálogo explicitamente híbrido carregam a extensão interna **`giftPolicy: "hybrid-v1"`**, `giftName` (nome literal ou null) e `giftRuleId` (regra resolvida ou null). `giftId` continua sendo o ID externo real. O parser exige os três campos da extensão e o marcador, aceita-a somente no domínio real e rejeita campos extras/formatos parciais. A referência interna é revalidada; um chamador não pode selecionar outra regra para ganhar pontos.

Não houve mudança do schema SQLite: permanecem `dispute`, `journal`, `event_identities`, `gift_sequences`. O journal guarda ID externo, nome e regra. Fingerprints novos acrescentam a extensão versionada sem alterar a ordem/formato dos antigos. Mesmo ID de ocorrência com outro ID externo, nome ou regra é contradição, sem pontuação; pode colocar combos pendentes em quarentena. Ocorrências distintas de uma mesma sequência por nome podem trazer IDs externos diferentes, se continuarem correspondendo à mesma regra e sem contradizer os demais campos.

Para eventos híbridos, chave de sequência inclui origem, sala, domínio, `groupId` e ator. A projeção `gift_sequences.gift_id` representa a identidade estável da regra (`name:...` em modo nome ou ID confirmado em modo ID). O ID externo original fica no journal/fingerprint, nunca é substituído. Dois atores/grupos não são fundidos pelo nome. Mudança de regra na mesma sequência, regressão, final contraditório e identidades contraditórias preservam `COMBO_CONFLICT`/quarentena. Intermediárias têm zero pontos; finalização válida pontua quantidade efetiva uma vez. Overflow e limites continuam sem mutação parcial.

Bancos antigos conservam suas chaves de sequência e fingerprints originais. Uma contradição de nome recebida agora também é registrada com a extensão versionada, inclusive em catálogo legado, para impedir que a mesma ocorrência reapareça como voto válido; a chave histórica da sequência é conservada e combos pendentes implicados são colocados em quarentena. A discriminação explícita do envelope seleciona o formato de processamento/replay; `scoring-v1`/`scoring-v2` dos comentários não mudaram. O hash `sourcePolicy` mantém o perfil legado para catálogos antigos, e usa `hybrid-v1-literal` para catálogos explícitos. Catálogo e política já fazem parte do contexto/digest persistido: recuperação com outro catálogo bloqueia. Sem migração automática, reinterpretação ou zeragem. A fixture `gift-id-v2.json` foi capturada do motor não modificado da main para testar replay histórico de presentes e combo pendente; fixtures anteriores de v1 também continuam na suíte.

## Diagnóstico e limites

`real_ingress` distingue `MATCH_BY_ID`, `MATCH_BY_EXACT_NAME`, `NAME_NOT_AUTHORIZED`, `ID_NAME_CONFLICT`, `AMBIGUOUS_GIFT`, `DELIVERY_NOT_VALIDATED` e decisões do motor. Registra modalidade quando resolvida, status e versão, sem payload, nomes de usuários, IDs pessoais, credenciais ou texto de comentários. O limite existente de 20 linhas/segundo é preservado; motivos suprimidos são contados em agregado limitado (até 32 motivos) e descarregados periodicamente/no encerramento. Logs não alteram catálogo ou placar. O diagnóstico observation permanece independente e sem pontos.

Os testes são offline, com provedor falso e SQLite temporário. Não provam a semântica real do TikTok. Nomes podem ser localizados/alterados pelo provedor; diferença literal é rejeitada e exige revisão humana, sem aproximação. Um ID por nome que colida com ID confirmado de outra regra é rejeitado por contradição. O conector continua não oficial e fixado em 2.5.0; não há garantia oficial sobre IDs ou ciclos de presentes.

Depois da revisão do PR, validar um item por vez em LIVE autorizada, primeiro no diagnóstico, com entregas documentadas e catálogo novo conferido. Ativar conscientemente modo real somente com o contexto/sala/disputa corretos, mantendo presentes ainda não revisados fora do operacional. Nenhuma LIVE foi iniciada/conectada nesta tarefa. Não houve envio de comentários/presentes ou Fase 5.5.
