# Fase 5.5 — administração local e pontuação manual

O painel administra uma interação informal de entretenimento. O placar não representa pesquisa eleitoral, pesquisa representativa ou votação oficial.

## Ativação consciente

A administração começa **desligada**. Não há credenciais no projeto, aprovação automática de presentes, nova disputa, migração automática ou reset pelo navegador. O painel utiliza a disputa real e o catálogo operacional já selecionados pelo operador.

Situação informada pelo operador em 22/10/2026: Rose 5655, Finger Heart 5487, White Rose 8239 e Capybara 14488 autorizados por ID; dez presentes pendentes, incluindo oito `exact-name` ainda sem validação operacional real. Os arquivos privados de catálogo/revisão e o banco operacional não foram acessados ou recriados nesta tarefa. O backend lista somente o catálogo operacional efetivamente carregado; a referência dos 14 itens não é usada para autorizar lançamentos.

Requisitos: Node 24.15+ na linha 24, npm 11+, ambiente local Linux. Instale e compile:

```bash
npm ci
npm run build
```

Crie uma credencial nova **fora do repositório**. A senha passa pela entrada padrão, sem eco, argumento de processo, variável exportada ou gravação no histórico do shell:

```bash
mkdir -p "$HOME/.config/duelo-3d"
read -r -s -p 'Senha administrativa (mínimo 16 caracteres): ' admin_password
printf '%s' "$admin_password" | npm run admin:credential -- --operator raul --output "$HOME/.config/duelo-3d/admin-raul.json"
unset admin_password
```

Use uma senha longa e exclusiva. O arquivo contém versão, identificador do operador, salt e hash scrypt; não contém a senha. É criado com permissão 0600 e criação exclusiva: nunca substitui um arquivo existente. Versão 1 fixa scrypt N=131072, r=8, p=1, salt de 32 bytes e derivação de 64 bytes. O leitor exige arquivo regular privado fora do projeto. É uma conta de operador por configuração local, com até 16 sessões; não compartilhe a conta para preservar atribuição. Troca de credencial exige reinício e invalida as sessões em memória.

No `.env` **local da raiz**, mantenha suas configurações reais existentes de conta, sala, SQLite, catálogo e política. Para uma disputa existente, mantenha `TIKTOK_SESSION_ACTION=resume`; não use `create` para contornar falha de recuperação. Acrescente conscientemente:

```dotenv
ADMIN_ENABLED=true
ADMIN_PORT=3001
ADMIN_CREDENTIAL_FILE=/caminho/absoluto/fora/do/projeto/admin-raul.json
```

Também são exigidos os opt-ins reais já existentes (`DUEL_MODE=real`, `TIKTOK_REAL_ENABLED=true`, identidade revisada e contexto correto). A administração é recusada em simulation/observation. `ADMIN_PORT` deve ser distinta das portas da arena/backend. Nada disso usa prefixo `VITE_`.

```bash
npm run dev
# Alternativa após build: npm start --workspace backend
```

Abra **http://127.0.0.2:3001/admin/**. A arena continua no endereço habitual **127.0.0.1**, sem alteração visual. A administração usa outro IP de loopback porque cookies não são isolados por porta; o cookie host-only de 127.0.0.2 não é enviado à arena em 127.0.0.1. Não substitua os endereços por um hostname comum nem exponha esse servidor por proxy público. Em ambientes com proxy local, inclua 127.0.0.2 na lista de exceções do navegador/ferramenta.

O frontend administrativo tem build separado em `apps/frontend/admin-dist`, base `/admin/`, sem ler `.env` pelo Vite. `npm run dev` compila esse bundle antes do Vite da arena; o backend carrega os assets quando solicitados. Se ainda não estiverem prontos, retorna indisponibilidade, sem liberar o painel. Para mudanças no código administrativo durante desenvolvimento, reinicie o comando ou execute `npm run build:admin --workspace frontend`; esse bundle não utiliza HMR. A arena mantém o HMR existente. O Vite público bloqueia as rotas `/admin` e `/admin-dist` e o acesso a esses diretórios pelo servidor de arquivos; não faz proxy de APIs administrativas.

## Autenticação e isolamento

O servidor administrativo escuta exclusivamente em 127.0.0.2, separado do servidor público. A página inicial sem sessão entrega somente o login. A página do painel é entregue após autenticação; assets estáticos não contêm estado, credenciais ou segredo. O serviço público continua retornando 404 para as rotas administrativas; WebSocket público continua somente leitura.

Sessão aleatória de 256 bits, cookie HttpOnly/SameSite=Strict/host-only/Path=/admin, identificador armazenado no servidor somente por hash. Expiração por dez minutos de inatividade ou duas horas absolutas; reinício/logout invalidam a sessão. Cada login emite outro identificador. HTTP local não usa cookie Secure, pois não há HTTPS; esse desenho não é uma solução para publicação na rede.

Toda escrita exige Origin exato, Host exato, marcador `X-Admin-Request`, JSON e token CSRF ligado à sessão. Leituras de API também exigem o marcador e autenticação. Não há CORS. Conexões não locais, origens divergentes e requisições cross-site são negadas. Cabeçalhos incluem CSP, frame-ancestors none, nosniff, no-referrer e no-store. Login limitado a cinco tentativas/minuto, verificação scrypt concorrente limitada, corpo de até 8 KiB e prazo de requisição/cabeçalhos de cinco segundos. Nenhuma credencial, cookie, token CSRF, justificativa ou payload é escrito em logs HTTP.

## Lançamento, histórico e correção

1. Entre como operador. O painel mostra o snapshot persistido, versão, identidade da disputa, estado do conector e histórico paginado de 50 operações.
2. Escolha participante, regra autorizada e quantidade inteira positiva segura. O servidor verifica o participante da regra e calcula pontos por unidade × quantidade; o navegador não envia pontos.
3. Registre justificativa de 10–1000 caracteres e confirme que revisou/reconciliou o histórico. A consulta mostra operações de mesma regra/quantidade para revisão; isso não é prova de equivalência nem deduplicação automática.
4. Confirme. A operação possui UUID v4, autor obtido da sessão e horário UTC atribuído pelo servidor. Pontuação, versão, identidade e auditoria são confirmadas na mesma transação SQLite antes da publicação.
5. Em falha de resposta, o painel preserva a solicitação em memória e oferece reenviar **a mesma operação**. Não reenvia votos automaticamente. O backend conserva o timestamp original ao reconhecer um UUID já persistido; igualdade retorna duplicata sem pontos/publicação adicionais, alteração de conteúdo/operador/tipo retorna conflito. Se fechar/recarregar o navegador enquanto o resultado é incerto, consulte o histórico pelo UUID antes de criar outra operação.
6. Para desfazer, selecione **Estornar**, informe justificativa e confirme. O servidor deriva o valor integral da operação original; não aceita totais, candidato ou pontos de estorno do navegador. A operação original é preservada e aparece ESTORNADA; o estorno é um novo registro vinculado. Estorno duplo e placar negativo são recusados.
7. Para corrigir, estorne primeiro e escolha **Preparar correção**. Revise quantidade/regra/participante e justificativa; o novo lançamento referencia a operação estornada. Uma operação não pode originar duas correções. São **duas confirmações explícitas**, cada uma transacional; se a nova correção falhar, o estorno já confirmado permanece. O histórico mostra ambas para reconciliação.

Não há edição de tabelas, redefinição direta de totais, criação/reset de disputa, aprovação de presentes ou administração pelo WebSocket. Regras de entrega aprovadas continuam no catálogo; uma quantidade administrativa é uma declaração do operador, não uma notificação de combo TikTok. Nenhuma finalização é fabricada para justificar um lançamento manual.

## Identidades entre origens

Eventos administrativos são `admin.award` e `admin.reversal`, versão **admin-v1**, origem `duelo-admin:local-v1`, identidade própria por operação. Nunca reutilizam a identidade de um gift/comment. O operador não envia eventos de domínio, autoria, horário, origem ou preço ao servidor; envia uma requisição restrita, que o serviço transforma no contrato interno.

Opcionalmente, o operador pode declarar vínculo com IDs exatos de ocorrência, ator e groupId de uma evidência confiável da transmissão atual. Sala e origem vêm do contexto servidor, não do navegador. A auditoria identifica o vínculo como **atestado pelo operador**, sem promovê-lo a confirmação do TikTok.

- Ocorrência já persistida ou sequência já conhecida, inclusive pendente: lançamento vinculado é recusado e exige reconciliação.
- Identidade já reservada por outro lançamento manual: recusada.
- Vínculo novo: reserva identidade da ocorrência e, quando fornecido, contexto ator/sequenceId. Se o evento TikTok chegar posteriormente, fica sem pontuar com `MANUAL_RECONCILIATION_REQUIRED`; sua identidade é registrada para deduplicação. O vínculo não transforma esse evento em administrativo nem dispara um novo voto.
- Estorno não libera automaticamente a reserva: uma retransmissão tardia não pode produzir pontos inesperados. Correção explícita pode suceder a reserva da operação estornada quando ainda não houver ocorrência TikTok persistida contradizendo a conciliação. Caso já haja, a operação vinculada é recusada para revisão.
- Sem IDs compartilhados comprovados, não se garante equivalência entre origens. Nome, quantidade e proximidade temporal só geram sinalização humana. Uma operação sem vínculo depende da reconciliação explícita do operador; não é uma garantia de ausência de dupla contagem.

## SQLite e recuperação histórica

O **mesmo motor** interpreta os eventos administrativos e calcula os deltas. O serviço de administração não implementa outra regra de pontos. O coordenador mantém a estratégia de reconstruir candidato por replay dentro de transação real e publicar somente depois do commit. Se a transação falhar, candidato, auditoria e reservas temporárias são descartados.

Não foi necessária migração física: **SCHEMA_VERSION permanece 2**, com `dispute`, `journal`, `event_identities`, `gift_sequences`. O journal existente armazena os novos eventos tipados; fingerprints administrativos incluem todos os campos canônicos do comando. O coordenador registra também `appliedPoints`, calculado pelo motor, na mesma entrada de journal; esse resultado derivado não é aceito da requisição HTTP, é coberto pelo digest e é conferido pelo motor no replay. O histórico/status de estorno e as reservas são projeções derivadas do journal durante o mesmo replay, não uma segunda fonte de verdade nem um cache persistente independente. O digest existente cobre o journal, identidades, sequências e placar; alteração silenciosa ou replay divergente bloqueia a retomada.

O horário nunca é usado para ordenar ou deduplicar; ordem do journal/versão é autoritativa. IDs e fingerprints antigos permanecem idênticos. `scoring-v1`/`scoring-v2` dos comentários não mudam. Eventos históricos continuam usando seus contratos/políticas originais. Catálogo e sourcePolicy permanecem vinculados à disputa; administração não permite alterar esses valores em uma retomada.

Bancos anteriores são abertos pela nova versão sem alteração de schema ou reescrita do journal. O primeiro lançamento administrativo é uma extensão explícita de dados marcada admin-v1. **Depois disso, não use binário anterior à Fase 5.5 nesse banco**: ele não entende esses eventos e deverá falhar, não reinterpretá-los. Prepare um backup consistente sob seu controle antes de adotar uma nova versão; esta implementação não acessa nem migra seu banco privado durante testes. Bancos novos ou retomadas continuam sendo escolhas explícitas nas configurações existentes.

Auditoria é append-only pela API, com arquivo privado, digest e replay. Isso detecta corrupção/alterações inconsistentes, mas não é um log externo assinado ou prova criptográfica contra um administrador do sistema que possa substituir simultaneamente banco, programa e hashes. Proteja conta do SO, credencial e diretório do banco; não existem endpoints para reescrever o journal.

A autoridade continua única pelo lock existente e as escritas usam BEGIN IMMEDIATE. Eventos simultâneos são serializados, sem instância de motor mutável sobrevivendo ao commit. O limite existente de capacidade continua incluindo eventos/identidades/sequências administrativas; não há expurgo automático de deduplicação. Falha de publicação posterior ao commit desconecta espectadores; reconexão recupera snapshot persistido e não reaplica a ocorrência.

## Verificação e limites

```bash
npm ci
npm audit
npm run build
npm test
npm run check:media
npm run format:check
```

Testes offline usam provedor falso, bancos temporários e credenciais sintéticas. Incluem fluxo HTTP autenticado → motor → SQLite → arena, idempotência, estorno, correção, rollback, falha de publicação, legado, retomada, conflitos de identidade, CSRF e DOM administrativo. Não dependem de LIVE, presentes pagos ou dados privados.

Conector TikTok, aliases 13/22, catálogo híbrido e arena permanecem compatíveis. As permissões de simulação não administram a disputa real. Nenhum dos dez presentes pendentes é ativado por esta fase. Não houve nova conexão LIVE, alteração de banco do operador ou uso do TikFinity como validação.

## Homologação sem ambiente operacional

O comando `npm run homologate:admin -- --isolated --credential /caminho/credencial-de-teste.json` reutiliza este painel e o runtime existentes com provedor sintético, catálogo fictício e banco SQLite temporário exclusivo. Não exige nem lê o `.env` operacional. Prepare os bundles com `npm run build:homologation` e siga [o procedimento de homologação](admin-homologation.md), incluindo recuperação por `r`, invalidação de sessões e limpeza por Ctrl+C. Este fluxo não altera os requisitos ou a configuração de ativação da administração operacional descritos acima.
