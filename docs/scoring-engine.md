# Fase 3 — motor de regras de negócio

Base inspecionada: `main` em `1815c4c9aa0105bcd933dc304af9b232063b2e20`, merge do PR #4. Não havia motor da Fase 3 preparado no ambiente inspecionado. A branch desta entrega é `feat/scoring-engine`.

## Fronteira desta fase

O módulo `apps/backend/src/scoring` contém contratos internos, validação, interpretação de comentários, catálogo e processamento síncrono em memória. Não importa HTTP, WebSocket ou bibliotecas de plataforma. Não adiciona dependências.

A simulação WebSocket da Fase 2 continua funcionando como antes. Este motor ainda não é conectado a seus comandos: um voto manual não é transformado em comentário ou presente fictício. Não há entrada de eventos reais, endpoint de pontuação, integração TikTok ou alteração na arena.

Uma futura camada de entrada confiável deverá autenticar a fonte e normalizar seus eventos antes de chamar o motor. Os campos `origin` e `domain` são contexto validado pelo servidor, não prova de autenticidade de dados recebidos da rede. Não encaminhar JSON de navegador diretamente para `process`.

## Organização e uso interno

| Arquivo                 | Responsabilidade                                                   |
| ----------------------- | ------------------------------------------------------------------ |
| `contracts.ts`          | Eventos normalizados, candidatos, entregas, decisões e snapshots   |
| `validation.ts`         | Campos permitidos, limites, IDs, identidade composta e fingerprint |
| `comments.ts`           | Interpretação determinística de palavras completas                 |
| `catalog.ts`            | Validação e cópia da configuração autorizada de presentes          |
| `engine.ts`             | Fonte/sala fixas, deduplicação, sequências, registro e placar      |
| `tests/scoring.test.ts` | Testes unitários e de integridade do fluxo completo                |

```ts
import { createScoringEngine } from '../src/scoring/engine.ts';

const engine = createScoringEngine({
    origin: 'offline-test',
    roomId: 'fixture-room',
    domain: 'simulation',
    // Vazio por padrão; não há IDs reais comprovados nesta fase.
    catalog: [],
});

const decision = engine.process({
    origin: 'offline-test',
    roomId: 'fixture-room',
    domain: 'simulation',
    eventId: 'comment-1',
    type: 'comment',
    text: 'Flávio!',
});
// applied, candidate=flavio, points=1; state.scores.flavio=1
```

Cada instância aceita uma única origem, sala e domínio, copiados na construção. O dono da execução deverá manter uma única instância autoritativa; criar instâncias paralelas não compartilha deduplicação. Nesta fase só são permitidos `simulation` e `observation`. O domínio `real` é rejeitado na configuração e nos eventos. Observação sempre retorna zero pontos.

Os candidatos do domínio são `lula` (vermelho, lado visual `a`) e `flavio` (azul, lado visual `b`). Nenhum mapeamento novo é aplicado ao frontend nesta fase.

## Contratos e regras

Todo evento exige `origin`, `roomId`, `domain`, `eventId` e `type`. Campos extras são recusados; o evento não pode fornecer candidato, pontos, placar ou `diamondCount`.

Comentários acrescentam `text`, limitado a 4096 unidades UTF-16. A normalização ignora caixa e acentos. Palavras completas são separadas por pontuação/espaços; letras Unicode, números e sublinhado permanecem parte da palavra. `LULA!` e `Flávio` valem um ponto; `lulalandia`, `lula123`, ambos os nomes ou nenhum não pontuam. Repetir o mesmo nome no texto não multiplica votos. Sentimento do texto não altera a regra.

Presentes acrescentam `giftId` e `delivery`. O catálogo interno exige exatamente `giftId`, `name`, `candidate` e `points`; candidato único e pontos entre os valores autorizados 5, 10, 20, 50 e 100. Entradas inválidas ou IDs duplicados impedem a construção do catálogo. O motor copia a configuração, impedindo alterações posteriores pelo chamador.

O catálogo padrão fica vazio. Rosa/pequeno/médio/grande/especial são categorias desejadas, não IDs reais comprovados. Somente fixtures de teste contêm mapeamentos sintéticos. Presentes desconhecidos não pontuam. Comentários e presentes independentes somam seus efeitos, sem criar eventos associados artificialmente.

| Entrega            | Campos de `delivery`                                      | Decisão                                       |
| ------------------ | --------------------------------------------------------- | --------------------------------------------- |
| Individual         | `kind: 'single'`, `quantity: 1`                           | Aplica o valor configurado uma vez            |
| Combo em andamento | `kind: 'combo'`, `sequenceId`, `quantity`, `final: false` | Registra acumulado, sem pontuar               |
| Combo finalizado   | Mesmos campos, `final: true`                              | Aplica valor × quantidade final uma única vez |

`quantity` de combo deve ser inteiro positivo seguro. O contrato declara uma contagem **acumulada**, nunca um delta. A entrada confiável futura deverá comprovar identidade e finalização; não inferir `single` ou `final` a partir de campos ausentes. Um final isolado pode pontuar apenas porque o contrato normalizado já afirma uma entrega final inequívoca com identidade e quantidade conhecidas.

Contagem decrescente, troca de presente na mesma sequência ou reutilização contraditória de identidade rejeitam a notificação. Uma sequência ainda não pontuada envolvida em contradição fica em quarentena até o encerramento da instância e não pontua depois. Isso inclui mudança para presente desconhecido. Eventos fora de ordem são tratados conservadoramente: podem bloquear a sequência, nunca gerar soma adicional.

Finalizações repetidas com outro ID de notificação e mesmo total são deduplicadas pela sequência. Após finalização, notificações atrasadas/contraditórias não acrescentam pontos nem revertem automaticamente pontos já registrados. Uma correção administrativa seria outro fluxo, fora desta fase. O adaptador futuro deve fornecer IDs de sequência únicos no contexto da origem/sala/domínio; não reutilizá-los por usuário ou tipo de presente.

## Identidade, decisões e registro

A identidade usa a tupla JSON `[origin, roomId, domain, type, eventId]`, evitando colisões de concatenação. Sequências usam `[origin, roomId, domain, sequenceId]`, sem incluir `giftId`, para detectar sua alteração contraditória.

IDs são strings não vazias, sem controles ou espaços nas extremidades, até 256 caracteres. Números inteiros seguros e `bigint` não negativos são normalizados para string. Números já inexatos são recusados; não há como recuperar precisão perdida anteriormente. IDs grandes devem chegar como string ou `bigint`.

Uma retransmissão idêntica retorna `duplicate` com zero pontos adicionais. Mesma identidade com conteúdo diferente retorna `IDENTITY_CONFLICT`. Textos iguais com IDs distintos continuam independentes. Eventos estruturalmente válidos sem voto ou com presente desconhecido também ficam registrados para impedir sua transformação posterior em votos pela mesma identidade. Entradas malformadas não são registradas.

Decisões retornam `status` (`applied`, `ignored`, `rejected`, `duplicate`), `reason`, `identity` quando disponível, candidato quando aplicado, pontos adicionais e snapshot imutável. O snapshot tem `sessionId`, `domain`, `version` e `scores` separados. Versão só avança em alterações de pontuação.

Identidade, sequência, pontos e versão são registrados sincronamente antes do retorno. A camada futura de publicação deve publicar depois desse retorno: falhar ao publicar não autoriza reaplicar a ocorrência. Não há callback de publicação dentro do commit do motor.

O limite padrão de 10.000 registros inclui identidades de eventos e sequências. Não há evicção, TTL ou limpeza automática. Ao saturar, novos eventos são bloqueados; retransmissões conhecidas continuam identificáveis. Valores e total do placar devem permanecer inteiros seguros; overflow é recusado antes de alterar pontos ou finalizar uma sequência.

## Execução, testes e limitações

```bash
npm ci
npm run build
npm test
npm run check:media
npm run format:check
npm run dev

# Somente o motor, a partir da raiz:
node --test apps/backend/tests/scoring.test.ts
```

Os serviços existentes continuam em `http://127.0.0.1:5173` e `http://127.0.0.1:3000/health`; configuração opcional somente no `.env` da raiz. A chave da simulação continua sendo informada à arena pelo operador.

O motor é determinístico nas decisões para uma sequência de eventos/configuração; o identificador de sessão é gerado pelo servidor. Não há persistência. Reiniciar ou construir nova instância perde placar, sequências e identidades. Isso não permite retomada automática segura de disputa real.

Esta fase não habilita comentários/presentes na arena. Integração com fonte externa, verificação factual de catálogo, persistência e autoridade de disputa real exigem etapas futuras autorizadas.
