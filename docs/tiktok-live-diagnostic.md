# Fase 5.1 — adaptador TikTok LIVE em observação

Base inspecionada: `main` em `c761fe59c0b893edfb68233596d5c6bbb4e1d4cf`, após confirmação do merge do PR #6. Branch: `feat/tiktok-live-adapter`.

## Biblioteca e avaliação

Foi escolhida uma única dependência direta de provedor: **tiktok-live-connector 2.5.0**, fixada no backend e no lockfile único. Seu manifesto exige Node >=20, compatível com o mínimo 24.15.0 do projeto. O pacote declara licença AGPL-3.0-only. É um conector **não oficial**, não uma API com garantias do TikTok.

Foram examinados o README e o código/declarations publicados do pacote, incluindo seu decoder **tiktok-live-proto 0.2.4, schema v3**. A versão atual oferece chat, presentes, controle de conexão/stream e acesso a informações da sala. A implementação não chama APIs de envio de comentários, administração, autenticação de sessão ou catálogo.

PirateTok/live-js 0.3.0 foi considerado como alternativa: exige Node >=22.19 e documenta recepção de eventos e reconexão própria sem signing server. Não foi instalado. Dadas as dificuldades anteriores relatadas com combos, esta etapa troca para um único provedor com campos de contagem/finalização/grupo inspecionáveis e ciclo de vida controlado pelo adaptador. Isso **não prova** que seus IDs ou combos sejam corretos em toda LIVE; essa verificação continua pendente.

O conector escolhido usa um serviço de assinatura de terceiros (Euler Stream), por meio da dependência transitiva tiktok-live-api-sdk. Disponibilidade, limites, exigência de chave, rede, região e acesso à LIVE podem impedir conexão. A chave opcional não fornece garantia de acesso. Nenhum serviço adicional é adicionado ao monorepo.

Fontes primárias: [TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector), [pacote 2.5.0](https://www.npmjs.com/package/tiktok-live-connector/v/2.5.0), [PirateTok/live-js](https://github.com/PirateTok/live-js). Os arquivos distribuídos/lockfile são a referência da versão implementada, não exemplos de outra branch upstream.

## Arquitetura e segurança do isolamento

| Arquivo em `apps/backend/src/tiktok` | Responsabilidade                                                  |
| ------------------------------------ | ----------------------------------------------------------------- |
| `config.ts`                          | Opt-in, handle e chave opcional, sem expor valores privados       |
| `contracts.ts`                       | Contratos exclusivos de observação e porta do provedor            |
| `provider.ts`                        | Única fronteira com o SDK, cancelamento e opções de privacidade   |
| `normalize.ts`                       | Projeção por campos permitidos, validação e preservação de IDs    |
| `diagnostics.ts`                     | Logs limitados/pseudonimizados e observação de sequências         |
| `client.ts`                          | Conexão, gerações, deadlines, backoff e encerramento              |
| `main.ts`                            | Entrypoint separado com `.env` central, sinais e duração limitada |

Nenhum desses módulos importa scoring, SQLite, WebSocket de simulação ou frontend. Não recebe referência a esses serviços e não produz `ScoringEvent` ou `simulation.vote`. O contrato observado tem `domain: 'observation'` e `scoringEligible: false` literais, além de campos próprios que o parser estrito do motor recusa. Não há função de conversão para pontuação.

As declarações publicadas do SDK apresentam incompatibilidades em NodeNext: TypedEventEmitter, referência a ProtoMessageFetchResult e cookieJar obrigatório em opção que é opcional no runtime. O bridge carrega o pacote dinamicamente por uma fronteira mínima validada em runtime. Não se desliga a checagem de tipos do projeto, nem se altera código em node_modules. Os testes carregam a biblioteca real e cancelam antes de `connect`, sem rede, além de exercitar o bridge com um SDK fake.

## Contrato normalizado e evidências

`Observation` contém schema/provedor, tipo comment/gift, status, motivos, contexto da sala conectada, campos `confirmed` e interpretações `inferred`. É imutável e permanece apenas em memória.

**Confirmed significa somente que o campo foi encontrado no payload decodificado e passou na validação local. Não significa identidade ou semântica oficialmente comprovada pelo TikTok.** `candidate-unverified` também nunca é elegível para pontuação nesta fase. `insufficient` indica evidência essencial ausente; `invalid` indica formato ou contradição recusados.

| Projeção confirmada  | Campo inspecionado no schema v3 instalado           | Incerteza pendente de LIVE                                     |
| -------------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| `roomId`             | `common.roomId`                                     | Correspondência com a transmissão efetiva e estabilidade       |
| `eventId`            | `common.msgId`                                      | Unicidade, escopo e reapresentação da ocorrência               |
| `userId`             | `user.id`                                           | Disponibilidade e identidade fornecida pela fonte              |
| `text`               | `content`                                           | Texto efetivo entregue; nunca enviado ao logger                |
| `giftId`             | `giftId`, confrontado com `gift.id` quando presente | Correspondência real do presente                               |
| `giftName`           | `gift.name`, quando presente                        | Nome efetivo/localização; não constitui catálogo               |
| `sequenceId`         | `groupId`                                           | Unicidade, escopo, reutilização e relação com a sequência      |
| `repeatCount`        | `repeatCount`, inteiro positivo seguro              | Contagem acumulada real versus outras notificações             |
| `repeatEnd`          | Número 0 ou 1                                       | Semântica e presença no wire; zero pode ser default do decoder |
| `giftType` / `combo` | `gift.type` / `gift.combo`                          | Presentes combináveis/não combináveis e valores default        |

O schema efetivamente importado pelo pacote é v3: `content`, `user.id` e `gift.type`. Alguns exemplos do README ainda usam `comment`, `user.userId`, `giftDetails.giftType` ou `repeatEnd` booleano. Não são adotados aliases silenciosos. Drift de formato gera insuficiência/invalidação, não certeza fabricada.

IDs decimais positivos são preservados como strings de até 128 caracteres. BigInt positivo é convertido exatamente; número só é aceito quando inteiro positivo seguro. Zero/`"0"` são placeholders e não viram identidade. Objetos Long desconhecidos e números já arredondados são recusados, não reparados. Não se usa texto, username, timestamp ou contador local como ID definitivo.

O contexto retornado por `connect()` é separado do `common.roomId` do payload. Se faltarem campos não se inventa roomId no payload; se divergirem, registra-se `ROOM_CONFLICT` e o evento é inválido. O comentário íntegro é retido apenas enquanto observado, até 4096 unidades UTF-16; acima do limite é descartado com motivo, nunca apresentado truncado como texto integral. Nomes de presentes são limitados a 256 caracteres.

## Política de combos — apenas diagnóstico

`gift.type === 1` ou `gift.combo === true` gera a inferência `combo-candidate`. Outro tipo informado gera `individual-candidate`; ausência ou flags contraditórias permanecem desconhecidas/inválidas. São interpretações do schema do conector, não garantias de entrega efetiva.

Quando sala, usuário, presente e groupId estão presentes, a observação correlaciona provisoriamente sala/grupo e verifica se usuário/presente não mudaram. Não se cria grupo por proximidade temporal ou por usuário+presente. Essa correlação também não comprova a identidade real da sequência.

Notas distinguem início observado, início acima de um, aumento 1/2/3, contagem repetida, candidato a retransmissão, identidade contraditória, contagem fora de ordem, flag final explícita, final sem notificação anterior, evento após final, contexto contraditório e sequência não identificável. Uma flag final não comprova por si só a quantidade efetiva, nem torna o evento pontuável.

Uma pendência sem atualização por 30 s é classificada como interrompida. Desconexão, troca de sala e encerramento também interrompem pendências; nunca sintetizam finalização. O diagnóstico retém até 256 grupos e 1024 identidades por 60 s. Expiração/saturação afetam apenas observação, não a deduplicação de negócio ou o limite de capacidade do motor existente. Não é uma trilha confiável de contabilização.

## Privacidade e limites

O logger não aceita o payload bruto nem objetos Error. Usa projeção permitida: categorias, status/motivos, notas, quantidades/flags, comprimentos e pseudônimos. Comentários, nomes de usuários, nomes de presentes, cookies, tokens, assinaturas, URLs e erros do provedor nunca são serializados. IDs e texto recebem HMAC com chave aleatória em memória, não registrada e diferente a cada execução. Portanto logs de execuções diferentes não provam continuidade de uma identidade.

Não há arquivo de captura, banco de observação ou exportação automática. O stdout é JSONL pseudonimizado. Limites: 20 registros/s, até 2 KiB por linha e resumo de descartes; filtro de 100 eventos/s antes da normalização; fila stdout de até aproximadamente 64 KiB antes de descartar novos registros. O transporte SDK usa limite de frame de 1 MiB. Esses limites não constituem teste de carga e podem perder observações durante rajadas.

As opções de debug bruto são recusadas (`DEBUG`, `NODE_DEBUG`, `DEBUG_DESERIALIZE_XD`). Dump Base64 em erro de decoder é desativado; warning ACK repetitivo do SDK também é desativado. Não são registrados erros brutos/stack. A conexão usa `authenticateWs=false`, sem cookies de autenticação ou OAuth fornecidos pelo operador; a chave opcional é somente do serviço de assinatura e fica no backend.

O processo é dedicado porque o SDK usa configuração global de assinatura/deserialização. Não compartilhar esse bridge com outro provedor ativo no mesmo processo. Os timeouts HTTP/assinatura e sinal de abort são configurados; o WebSocket é terminado no fechamento e uma resolução tardia é desconectada novamente.

## Ciclo de vida e reconexão

Só se registra `connected` após resolução de `connect()` com roomId válido, nunca por status preliminar. Callbacks de gerações antigas são descartados. Dados recebidos antes da confirmação não são apresentados como eventos prontos.

Após falha concluída ou desconexão, há limpeza antes de tentar outra conexão. Orçamento: tentativa inicial e **cinco reconexões por execução**, sem reset automático; backoff de 1, 2, 4, 8 e 16 segundos, com teto configurado em 30 s. A biblioteca documenta chamar `connect()` novamente, e o adaptador controla esse ciclo explicitamente.

O deadline externo de conexão é 15 s. Timeout com conexão ainda incerta ou limpeza que não conclui em 2,5 s encerra o diagnóstico, em vez de sobrepor outra conexão. `streamEnd` encerra sem reconectar. SIGINT/SIGTERM cancelam timers/listeners e desconectam. A execução tem limite de cinco minutos; há saída forçada após a janela de encerramento caso restem handles de rede. Falhas terminais são identificadas nos logs e resultam em saída não zero; cancelamento pelo operador/fim da LIVE não são considerados falha.

Reconexão não recupera um histórico completo da LIVE e não comprova exatamente uma entrega. `processInitialData=false` evita a emissão intencional do lote inicial, mas não elimina a possibilidade de retransmissões. Não há confirmação de IDs/combos reais nesta entrega.

## Executar um teste real posteriormente

1. Usar Node 24.15+ e executar os testes offline antes. Ter uma LIVE pública acessível e autorizada para observação. O comando não inicia transmissão nem envia comentários ou presentes.
2. No `.env` opcional **da raiz**, configurar apenas para essa sessão:

```dotenv
TIKTOK_DIAGNOSTIC_ENABLED=true
TIKTOK_USERNAME=handle_da_conta
# Opcional, se o serviço de assinatura exigir; não compartilhar nem versionar:
# TIKTOK_SIGN_API_KEY=...
```

3. Executar da raiz, em terminal dedicado:

```bash
nvm use
npm ci
npm run diagnose:tiktok
```

O script individual também existe: `npm run diagnose:tiktok --workspace backend`. O `.env` é localizado pelo módulo existente, independentemente do cwd; variáveis do terminal têm prioridade. `npm run dev` continua iniciando somente os serviços antigos, mesmo se o opt-in estiver no `.env`.

4. Aguardar a categoria `connection` com `connected`. Se aparecer `provider_failure`, investigar disponibilidade da LIVE, rede, limites ou configuração do serviço de assinatura; não tratar esse log como evento recebido. A aplicação não imprime respostas privadas do serviço.
5. Observar comentários, um presente não combinável e notificações de combo durante uma interação controlada pelo operador. Não é necessário comprar presentes para executar os testes automatizados; a obtenção de amostras reais é uma etapa manual posterior.
6. Comparar ocorrências/grupos pseudonimizados, contagens, flags e notas. Verificar se um grupo mantém presente/usuário, se a contagem é acumulada, se há final explícito, mensagens repetidas, gaps ou mudanças após reconexão. Não concluir unicidade global apenas pela amostra.
7. Encerrar com Ctrl+C e confirmar desconexão. Depois devolver `TIKTOK_DIAGNOSTIC_ENABLED=false`. Não compartilhar logs sem revisar; pseudonimização não torna todo contexto automaticamente público.

Para conferir o padrão seguro sem acessar LIVE:

```bash
TIKTOK_DIAGNOSTIC_ENABLED=false npm run diagnose:tiktok
```

Os campos integrais normalizados só existem em memória; logs não permitem recuperar IDs reais ou texto. Caso uma etapa futura precise de captura controlada para validar catálogo/IDs, isso deverá ter política e autorização próprias, sem habilitar dumps brutos nesta fase.

## Validação e pendências

Fixtures e testes são sintéticos; não reproduzem uma prova da plataforma. Nenhuma LIVE foi conectada durante esta implementação. Permanecem pendentes: disponibilidade real do sign service, identidade/escopo de msgId e groupId, flags default, presentes não combináveis, semântica acumulada e finalizações, além de comportamento sob reconexão real.

Resultados efetivos: [validacao-tiktok-diagnostic.md](validacao-tiktok-diagnostic.md). Não há Fase 5.2, pontuação TikTok, catálogo real, alteração SQLite/WebSocket/frontend ou testes de carga nesta entrega.
