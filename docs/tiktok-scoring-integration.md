# Fase 5.2 — pontuação TikTok controlada

A aplicação é uma enquete informal de entretenimento; não representa votação eleitoral oficial ou pesquisa representativa. Nenhuma transmissão foi iniciada e nenhuma interação foi enviada durante a implementação. Testes offline não comprovam garantias da plataforma.

## Fluxo e fronteiras de confiança

1. O operador escolhe um único modo no `.env` da raiz. Variáveis do terminal prevalecem. Nenhum arquivo é obrigatório no modo padrão.
2. Em real, a configuração valida opt-in, conta, sala, ação de recuperação, catálogo e revisão da identidade. A fábrica existente do `tiktok-live-connector@2.5.0` conecta somente à conta configurada. Não se troca biblioteca ou provedor.
3. O ciclo de vida existente entrega callbacks brutos apenas depois do handshake. Um hook interno compara a sala obtida por `connect()` com a sala autorizada. Eventos antes da conexão, callbacks de gerações antigas e salas divergentes não entram no motor.
4. `integration/ingress.ts` valida campos pelo extrator existente e aplica uma política adicional de identidade e entrega. Constrói um contrato interno novo, com origem fixa e domínio real do servidor. Não aceita envelopes de observação, mesmo que alguém troque `domain`, nem campos `origin`, `domain`, `schema` ou `scoringEligible` no payload bruto. A API não é exposta por HTTP/WebSocket.
5. O mesmo motor interpreta comentários, consulta o catálogo e decide sobre combos. O coordenador existente recupera e prova o estado dentro de `BEGIN IMMEDIATE`, aplica o evento a uma instância provisória e persiste journal, identidades, sequência, placar e versão em uma transação. Nada é publicado antes de `COMMIT`.
6. `/arena` envia estados somente de leitura. Lula corresponde ao lado `a`, Flávio ao lado `b`, preservando renderização, barras, liderança, empate e animações existentes. O cliente usa a mesma réplica com modo esperado explícito, versão e geração do socket. Reconexão exige snapshot autorizado, sem replay de votos.

`src/tiktok` continua sem importar scoring, SQL, WebSocket ou frontend. Seu hook de conexão não recebe uma decisão de pontuação; observação continua sem qualquer callback de scoring. A composição fica em `src/integration`. Não há segunda implementação de regras de comentários ou pontuação de presentes.

## Modos e configuração

| Variável                                        | Função                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `DUEL_MODE`                                     | `simulation` por padrão, ou `observation` / `real`                 |
| `TIKTOK_REAL_ENABLED`                           | `false` por padrão; real exige exatamente `true`                   |
| `TIKTOK_IDENTITY_REVIEWED`                      | real exige `true`, após revisão da identidade no provedor fixado   |
| `TIKTOK_USERNAME`                               | conta pública autorizada, sem `@` ou URL                           |
| `TIKTOK_ROOM_ID`                                | ID decimal exato da transmissão revisada; obrigatório em real      |
| `TIKTOK_DATABASE`                               | caminho absoluto fora do repositório/build, um arquivo por disputa |
| `TIKTOK_SESSION_ACTION`                         | `create` ou `resume`, obrigatoriamente explícito                   |
| `TIKTOK_GIFT_CATALOG`                           | JSON opcional; ausente significa catálogo vazio                    |
| `TIKTOK_SIGN_API_KEY`                           | chave opcional privada do serviço de assinatura existente          |
| `TIKTOK_DIAGNOSTIC_ENABLED`                     | `true` somente para observação; incompatível com real              |
| `FRONTEND_PORT`, `BACKEND_PORT`, `BACKEND_HOST` | padrões 5173, 3000 e 127.0.0.1; servidor permanece loopback        |

`SIMULATION_MODE` e `SIMULATION_TOKEN` conservam o significado anterior somente em `DUEL_MODE=simulation`. Mesmo que o `.env` antigo contenha `SIMULATION_MODE=true`, o modo real não instala o transporte de simulação. Fora de desenvolvimento a simulação continua desligada. O SDK não é carregado/conectado em simulação.

Há dupla ativação do modo real, mais revisão de identidade e configuração completa; `DUEL_MODE=real` sozinho não inicia pontuação. A revisão é uma responsabilidade consciente do operador: não é uma garantia oficial produzida pelo checkbox. SDK, conta ou semântica diferentes exigem nova avaliação.

Arquivos `.env*` locais não são versionados. Segredos não usam `VITE_` e não entram em `define` ou `envPrefix`. O proxy Vite encaminha `/arena` e `/realtime`, sem expor o ambiente do backend. `GET /arena/mode` informa somente o modo, sem dados da LIVE, token ou capacidade administrativa. Se a descoberta falhar, os controles ficam desabilitados; recarregue quando o backend estiver disponível.

## Contratos internos reais

| Campo                   | Origem e validação                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `origin`                | constante interna `tiktok-live-connector@2.5.0`                                                                     |
| `domain`                | `real`, selecionado pelo servidor; engine exige `enableRealScoring: true` interno                                   |
| `roomId`                | ID confirmado na conexão, igual ao `common.roomId` e à sala configurada                                             |
| `eventId`               | `common.msgId` decimal positivo exato, sem fabricar identidade                                                      |
| `actorId`               | `user.id` decimal positivo exato, obrigatório para eventos reais                                                    |
| `type: comment`, `text` | `content` integral até 4096 caracteres, interpretado somente pelo motor                                             |
| `type: gift`, `giftId`  | `giftId`, consistente com `gift.id` quando presente; regras do catálogo do servidor                                 |
| `delivery.kind: single` | unidade 1, tipo não combinável, `gift.combo=false`, quantidade 1 e final explícito 1                                |
| `delivery.kind: combo`  | sequência real `groupId`, quantidade acumulativa segura e `final` derivado estritamente de `repeatEnd` numérico 0/1 |

IDs são preservados como strings. Números já imprecisos são rejeitados, nunca reparados. Nome de usuário, texto, presente e timestamp não viram IDs. Os campos existem no schema do conector fixado; sua estabilidade global, unicidade entre reconexões e semântica para todos os presentes **não são garantias oficiais**. `processInitialData=false` reduz ingestão de histórico, mas não garante entrega completa ou ausência de retransmissões.

A identidade de deduplicação mantém origem, sala, domínio, tipo e ID da ocorrência. No domínio real o fingerprint inclui também o ator. A sequência conserva o ator no checkpoint/SQLite: trocar o dono de um mesmo `groupId` gera conflito, em vez de criar uma sequência artificial derivada do usuário. Nomes e comentários não são usados como identidade.

O catálogo e a política de recepção são vinculados à disputa. Um hash `sourcePolicy` inclui provedor/perfil, conta, sala e políticas de entrega revisadas; o catálogo de pontuação já integra a configuração persistida. Alterar configuração na retomada bloqueia o processamento. Não se converte banco de observação ou simulação em banco real.

## Catálogo autorizado

`config/gift-catalog.example.json` contém apenas `[]`. Copie-o, preferencialmente para `~/.config/duelo-3d/gifts.json`, e aponte `TIKTOK_GIFT_CATALOG` para o arquivo. Configure somente IDs efetivamente examinados pelo operador. Não há IDs ou associações predefinidas.

Cada entrada possui exatamente `giftId` (string decimal), `name`, `candidate` (`lula` ou `flavio`), `points` (inteiro positivo seguro) e `delivery` (`single` ou `cumulative-final`). O arquivo aceita até 64 KiB e 1000 regras, sem IDs duplicados. Valores são copiados/congelados. O evento não escolhe pontos nem participante; campos como `points` recebidos do provedor não são utilizados.

Habilitar `cumulative-final` declara que o operador confirmou, **para aquele ID**, que `repeatCount` é acumulativo, `groupId` identifica a sequência e `repeatEnd=1` confirma o total. A recepção ainda exige `gift.type=1`, `gift.combo=true`, IDs consistentes e campos completos. O flag booleano de combo pode ser um default do protobuf em certos presentes; nesses casos a implementação conservadora rejeita a entrega até revisão. Não infere semântica pelo nome do presente.

Notificações intermediárias persistem pendência e não somam pontos. Final válido aplica o total uma vez. Repetições, regressões de quantidade e contradições seguem o motor existente; conflitos em sequências pendentes ficam em quarentena persistida. Combo sem identidade ou finalização válida nunca pontua. Um final completo pode representar toda a sequência, conforme a política acumulativa revisada; não é necessário inventar notificações intermediárias.

Presentes desconhecidos, perfis não revisados e payloads incompletos ficam em diagnóstico/rejeição. Um presente desconhecido com identidade e forma completas passa somente pela rejeição durável `UNKNOWN_GIFT` do motor, sem possibilidade de pontos; assim, uma ocorrência admitida não pode reaparecer com ID de presente contraditório e pontuar. Perfis conhecidos sem ciclo revisado e payloads incompletos não entram como eventos aptos a contabilização. A deduplicação durável cobre ocorrências admitidas pelo pipeline; dados descartados por insuficiência não são inventados nem apresentados como eventos processados. Não há catálogo real embutido ou alteração de regras de presentes da Fase 3. Valores seguros no catálogo continuam sujeitos a overflow na multiplicação e no placar.

## SQLite, recuperação e concorrência

A biblioteca continua `better-sqlite3@12.10.1`. Bancos novos usam schema 2, com as mesmas quatro tabelas: `dispute`, `journal`, `event_identities`, `gift_sequences`. A extensão permite domínio real, `dispute.source_policy` e `gift_sequences.actor_id`. O fingerprint do journal inclui ator somente em real. Regras anteriores de simulação/observação conservam serialização e resultados (`scoring-v1`).

Bancos schema 1 continuam recuperáveis em seus domínios anteriores, sem migração implícita ou habilitação real. Versões desconhecidas, digests divergentes, contexto diferente ou replay incompatível bloqueiam a operação. O domínio real utiliza um banco novo explícito; não reutilize uma disputa experimental como real.

O coordenador existente continua sendo a única implementação transacional. Não mantém engine mutável entre transações: reconstrói pelo journal, verifica checkpoint, aplica e só devolve depois do commit. Rollback não deixa mudanças em memória ou em tabelas. Falha de persistência interrompe a conexão real e bloqueia novos callbacks; exige correção e reinício/retomada consciente. Não há fallback para placar em memória ou zero.

A posse do lock é verificada antes de processar e de fornecer snapshots. Há uma única autoridade de recepção por banco neste fluxo, protegida por `<banco>.authority.lock` criado com exclusividade, além da serialização SQL. Eventos são processados sincronamente no event loop. Não há tarefas assíncronas de pontuação concorrentes nem fila que reordene eventos. O coordenador mantém suas transações `IMMEDIATE`, FKs, WAL e `synchronous=FULL`.

O lock contém apenas PID e instante local; encerramento normal o remove. Após crash ele permanece e bloqueia outra autoridade. Antes de removê-lo manualmente, confirme pelo PID e por ferramentas como `lsof` que não há processo usando banco/WAL/lock. PID isolado não prova que o processo é o mesmo; não há expiração automática. Não use esse protocolo em NFS/armazenamento compartilhado, múltiplas máquinas ou múltiplas autoridades. Não remova banco/WAL/SHM para contornar uma falha.

Para criar: banco inexistente, `TIKTOK_SESSION_ACTION=create`, mesma sala autorizada confirmada na conexão. Depois do primeiro encerramento, configure `resume` antes de reiniciar. `create` em arquivo existente falha; `resume` em arquivo ausente falha. O modo `--watch` também falhará com segurança se tentar recriar um banco já existente; use `resume` no desenvolvimento após a primeira criação.

Retomada conserva sessão, versão, identidades, atores, pendências e finalizações, e exige mesma conta/sala/catálogo/política. Uma LIVE com ID diferente requer nova disputa explicitamente autorizada; nunca retome o banco antigo mudando o ID. Não existe recuperação automática sem prova de integridade, reset HTTP ou endpoint de pontuação.

O journal SQLite contém texto necessário ao replay e identificadores exatos, protegidos por arquivo 0600 e diretórios novos 0700. São dados locais do operador, fora do projeto; proteja também diretórios preexistentes, retenção e backups. Não publique o banco. Logs não incluem texto, IDs brutos, nomes, cookies, assinaturas ou credenciais.

## WebSocket e disponibilidade

`GET /health` permanece técnico. Não significa que a LIVE esteja conectada. No modo real somente `/arena` aceita upgrade, com Origin exato `http://127.0.0.1:FRONTEND_PORT`, cliente loopback, máximo de 32 conexões, payload de até 4 KiB e heartbeat. Leitores locais não precisam de chave de administração: o canal não possui nenhuma operação de escrita. Voto, reset, autorização de simulação ou payload TikTok enviados por ele geram `READ_ONLY_REAL_ARENA` e fechamento. `/realtime` não é instalado em real. Não se usa a chave de simulação para gerir uma disputa.

Mensagens usam o envelope existente `protocol: 1`, `state.snapshot` / `state.updated`, agora com `state.mode=real`, sessão persistida, versão e scores `a`/`b`. Atualizações após pontuação carregam efeito visual `vote` com o lado derivado da decisão do motor. O efeito é somente visual; não executa pontuação no cliente.

Uma falha de publicação depois do commit fecha espectadores afetados para reconciliação. Não desfaz o commit nem reaplica a ocorrência. O navegador reconecta com backoff limitado a 8 s, recebe snapshot persistido e rejeita modo, versão ou sessão indevida. O servidor encerra clientes lentos acima de 64 KiB pendentes. Não há fila/reenvio automático de votos.

Reconexão TikTok conserva o ciclo existente: limpeza da conexão antiga antes de tentar outra, orçamento de cinco tentativas, backoff 1/2/4/8/16 s, timeout de conexão 15 s e limpeza 2,5 s. Sala diferente, término da LIVE ou limpeza incerta interrompem a recepção. O hook real reafirma a sala e verifica a recuperação a cada conexão. Se o limite defensivo de 100 callbacks por segundo do ciclo existente for excedido, a autoridade real encerra a recepção em vez de continuar com amostragem; somente diagnóstico pode descartar excedentes e continuar. Eventos perdidos durante desconexão não podem ser reconstruídos com segurança pelo adaptador; não há promessa de captura completa. O operador acompanha o diagnóstico de conexão no terminal.

Logs `real_ingress` contêm apenas categoria, domínio, motivo, status e versão, limitados a 20 por segundo. Os logs de observação existentes continuam pseudonimizados e com limites próprios. Saída cheia é descartada; logs não são o ledger de pontuação. O ledger é SQLite.

## Teste real controlado posterior

1. Execute primeiro `npm ci`, build, testes, mídias e formatação. Os testes usam provedor falso e bancos temporários. Não exigem LIVE ou chave real.
2. Com autorização do operador e uma LIVE pública acessível, revise os campos do conector fixado no modo diagnóstico, sem pontuar. Use `DUEL_MODE=observation`, `TIKTOK_DIAGNOSTIC_ENABLED=true`, conta e, se necessário, chave privada. Execute `npm run dev` ou o diagnóstico dedicado limitado a cinco minutos. Não habilite debug bruto.
3. Obtenha o `roomId` exato de uma conexão inspecionada pelo operador. Os logs pseudonimizados deliberadamente não permitem recuperar esse ID. Se necessário, o operador pode executar o trecho abaixo, que só conecta, apresenta o ID da sala e desconecta; não envia comentários, presentes ou interações. Não o execute sem autorização e não publique a saída em materiais do projeto.
4. Configure `.env`: `DUEL_MODE=real`, `TIKTOK_REAL_ENABLED=true`, `TIKTOK_IDENTITY_REVIEWED=true`, conta, ID de sala, caminho absoluto de banco novo e ação `create`. Mantenha `TIKTOK_DIAGNOSTIC_ENABLED=false` e o catálogo ausente ou vazio. Comece somente com comentários cuja identidade foi revisada.
5. Execute `npm run dev`, abra a arena e acompanhe o terminal. A arena é somente leitura; não use seus botões como administração real. Confirme a versão, o resultado das regras e a ausência de alterações em eventos rejeitados. Esta aplicação não inicia uma LIVE nem envia interações. Não utilize eventos de terceiros para manipular uma disputa sem autorização do operador.
6. Encerre com Ctrl+C. Troque ação para `resume` e reinicie enquanto a mesma LIVE estiver ativa; confirme snapshot e ausência de duplicação. Se a sala mudou, pare e crie outra disputa com autorização explícita.
7. Somente após confirmar IDs e ciclo de vida de cada presente configure o catálogo externo. Como a política fica vinculada ao banco, planeje essa configuração antes de criar a disputa que usará presentes; a Fase 5.2 não oferece alteração do catálogo durante uma disputa existente.
8. Falhas de identidade, persistência, lease ou contexto devem ser investigadas sem apagar o banco ou forçar retomada. Não declare sucesso a partir de fixtures sintéticas.

Comando opcional de inspeção, na raiz, após configurar diagnóstico e conta no `.env`:

```bash
node --input-type=module <<'JS'
import { loadOptionalEnv } from './apps/backend/src/environment.ts';
import { readDiagnosticConfig } from './apps/backend/src/tiktok/config.ts';
import { createProviderFactory } from './apps/backend/src/tiktok/provider.ts';
loadOptionalEnv();
const config = readDiagnosticConfig(); // exige diagnóstico explicitamente habilitado
const client = (await createProviderFactory(config))();
const timeout = setTimeout(() => { void client.disconnect(); }, 20000);
try {
    const state = await client.connect();
    console.log(JSON.stringify({ roomId: state.roomId }));
} finally {
    clearTimeout(timeout);
    await client.disconnect();
}
JS
```

Este procedimento de LIVE real não foi executado nesta entrega. Observações reais anteriores de contagens acumuladas/finais não provam comportamento uniforme para todos os presentes, identidades, reconexões ou versões do conector. Não há testes de carga, catálogo definitivo, painel administrativo, deploy ou alterações visuais nesta fase.
