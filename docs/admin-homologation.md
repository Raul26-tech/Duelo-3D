# Homologação administrativa isolada — PR #11

Este inicializador permite conferir visualmente o **mesmo painel administrativo compilado** e a arena, sem LIVE, configuração operacional ou banco do operador. É uma enquete informal de entretenimento, sem representar pesquisa eleitoral ou votação oficial.

## Preparar

Use Node 24.15+ na linha 24 e npm 11+. Abra um terminal dedicado, na raiz do repositório, sem exportar configurações operacionais. Não execute `source .env`. O `.env` existente pode permanecer no disco: nenhum dos dois comandos específicos abaixo o carrega.

```bash
npm ci
npm run build:homologation
```

O build usa `vite.homologation.config.ts`, com `envDir: false`, para gerar a arena em `apps/frontend/homologation-dist/`. Em seguida executa o **build administrativo existente**, também com `envDir: false`, em `apps/frontend/admin-dist/`. Não é uma segunda interface. Não utilize `npm run dev` para este procedimento: ele tem a inicialização operacional usual.

Crie uma **credencial exclusivamente de teste**, fora do repositório, usando a CLI existente. Não informe credencial operacional. O arquivo de saída deve ser novo; não será sobrescrito. A senha deve ter entre 16 e 1024 caracteres. Exemplo no Bash/Ubuntu, sem senha na linha de comando ou no histórico:

```bash
install -d -m 700 "$HOME/.local/share/duelo-3d-homologation"
read -r -s -p 'Senha de teste: ' homologation_password
printf '\n'
printf '%s' "$homologation_password" | npm run admin:credential -- \
  --operator homologacao \
  --output "$HOME/.local/share/duelo-3d-homologation/credential.json"
unset homologation_password
```

A CLI armazena somente salt/hash scrypt em arquivo 0600 no Unix ou com DACL restrita no Windows. O procedimento PowerShell e a validação pendente estão em [windows-compatibility.md](windows-compatibility.md). Se já existir uma credencial de teste nesse caminho, reutilize-a conscientemente ou selecione um caminho novo; não apague credenciais para contornar a proteção de sobrescrita.

## Iniciar

```bash
npm run homologate:admin -- --isolated --credential \
  "$HOME/.local/share/duelo-3d-homologation/credential.json"
```

O reconhecimento explícito `--isolated` e a credencial externa são obrigatórios. A partir do workspace backend, o mesmo comando é `npm run homologate:admin -- --isolated --credential /caminho/credencial-de-teste.json`. Caminhos de bundles e banco não dependem do diretório de execução.

- Painel: **http://127.0.0.2:3001/admin/**. Entre com `homologacao` e a senha de teste.
- Arena: **http://127.0.0.1:5173/**. Canal autoritativo somente leitura; botões públicos não administram o placar.
- Health técnico: http://127.0.0.1:5173/health.

Ambas as portas precisam estar livres. O inicializador falha e limpa seus recursos se houver conflito; não escolhe outra porta nem encerra serviços de terceiros. A arena e seu WebSocket usam o mesmo servidor local, dispensando proxy ou um terceiro serviço. Os vídeos são os mesmos seis WebM do build, com suporte a Range/HEAD.

## Roteiro visual

1. Abra arena e painel em abas separadas. Antes do login, o painel entrega somente a página de autenticação.
2. Confira o indicador **HOMOLOGAÇÃO ISOLADA — provedor sintético**. O estado `connected` é local/sintético, não conexão TikTok.
3. Selecione uma das duas regras fictícias: `90001` para Lula ou `90002` para Flávio, ambas com 2 pontos por unidade. Nenhum presente operacional foi importado, aprovado ou associado por este procedimento.
4. Lance 13 unidades para Lula com justificativa e reconciliação explícita. O backend calcula 26 pontos; confira o histórico e a atualização da arena.
5. Lance uma unidade para Flávio (2 pontos). Estorne o lançamento de Lula e confira o histórico preservado e o placar 0/2.
6. Prepare uma correção pelo painel: estorno confirmado e novo lançamento vinculado, utilizando os fluxos já existentes. A correção não é edição direta de totais.
7. No terminal, digite **`r` + Enter**. O inicializador fecha os servidores, o provedor sintético e a autoridade SQLite, e os reabre com **`resume` no mesmo banco temporário**, preservando sessão, versão, histórico e identidades. Faça login novamente. A arena reconecta e recupera o snapshot. Falha de integridade bloqueia a retomada e encerra a homologação; nunca cria uma disputa zerada como alternativa.
8. **Ctrl+C**, SIGTERM ou **`q` + Enter** encerra ambos os servidores e remove exclusivamente o diretório descartável desta execução, incluindo SQLite, WAL/SHM e lock. A credencial de teste externa permanece preservada.

Não há endpoint administrativo de reinício. `r` é um comando de ciclo de vida do terminal, sem capacidade de lançar pontos. Operações administrativas continuam passando por autenticação, CSRF, serviço, motor, transação e publicação após commit existentes.

## Isolamento e limites

- Banco sempre novo: `mkdtemp` no diretório temporário do sistema, prefixo `duelo-admin-homologation-`, diretório 0700 e arquivo `homologation.sqlite` privado. Não aceita caminho de banco, catálogo, conta, sala, host ou provedor pela CLI.
- Nunca abre `live-fase54-tuneldotempodjtim-01.sqlite` nem seleciona um banco por variável de ambiente. Não lê catálogos privados ou credenciais automaticamente.
- Recusa variáveis exportadas `TIKTOK_*`, `ADMIN_*`, `VITE_*`, `DUEL_MODE`, `FRONTEND_PORT`, `BACKEND_PORT`, `BACKEND_HOST`; também `NODE_ENV=production`, `NODE_OPTIONS` não vazio e opções de preload/leitura de ambiente do Node. A existência de um `.env` no disco não causa recusa: ele não é lido. Em caso de recusa, use um terminal limpo; não altere o `.env` ou os arquivos privados para permitir o teste.
- Internamente reutiliza o canal de disputa `real` exigido pelo serviço administrativo, porém com contexto fixo **exclusivo de homologação**, sala sintética, catálogo fictício e `ProviderClient` inerte. O provedor não importa o SDK, abre conexões ou emite comentários/presentes. Não habilita o modo real operacional.
- Admin continua em 127.0.0.2, arena em 127.0.0.1, sem bind público. Autenticação, cookie host-only/HttpOnly/SameSite, CSRF e origem existentes são mantidos. A arena não oferece APIs administrativas e só recebe alterações após commit SQLite.
- Não imprime senha, hash, cookie ou token. O terminal informa apenas URLs, marcador de homologação e diretório temporário próprio.
- Cada nova execução cria uma disputa descartável diferente. Recuperação visual é feita por `r` **durante a mesma execução**, não por seleção de arquivos antigos. SIGKILL, queda do SO ou energia não permitem limpeza garantida: podem deixar o diretório temporário indicado no terminal. Ele não é retomado automaticamente e pode ser removido manualmente após confirmar que o processo terminou. Não há política de varredura/apagamento de outros diretórios.
- O arquivo externo passado explicitamente deve ser uma credencial de teste; o formato compartilhado de credenciais não prova sua finalidade. A ferramenta não tenta descobrir credenciais do operador.
- Testes HTTP/DOM/SQLite/WebSocket não substituem a inspeção visual pelo operador. Nenhuma LIVE é necessária para este procedimento.

## Validação desta entrega

Executado em Linux com Node **24.15.0** e npm **11.9.0**:

- Linha de base: 292/292 testes existentes aprovados antes das alterações (Node 24.19.0).
- `npm ci`: aprovado; nenhuma dependência nova e lockfile preservado.
- `npm audit`: zero vulnerabilidades reportadas.
- `npm run build`: frontend público, painel administrativo, backend e tipos dos testes aprovados.
- `npm run build:homologation`: aprovado; arena isolada e bundle administrativo real gerados.
- `npm test`: **301/301** aprovados, 26 frontend e 275 backend; nove novos testes do inicializador, sem falhas ou skips no Linux.
- `npm run check:media`: aprovado; os seis objetos WebM preservados. HTTP 200 e hashes SHA-256 iguais aos originais; Range HTTP 206 exercitado nos seis vídeos.
- `npm run format:check`: aprovado.
- Comando npm da raiz: login/painel, arena e health em HTTP 200. Recuperação e SIGINT do grupo de processos exercitados, com fechamento de portas e remoção do diretório temporário.

Os testes novos cobrem recusa de ambiente operacional, consentimento e credencial obrigatórios, provedor inerte, banco temporário privado, autenticação/acesso negado, separação das interfaces, bundles reais, mídias, publicação WebSocket, idempotência, estorno/correção, histórico, recuperação da mesma sessão, invalidação de cookies, snapshot persistido, corrupção sem reinicialização, porta ocupada/limpeza e encerramento direto/por npm. Um subprocesso mantém bloqueadas todas as conexões TCP de saída, `fetch`, `process.loadEnvFile` e resolução do SDK TikTok durante inicialização, operações e recuperação.

Não houve conferência visual interativa, conexão à LIVE ou acesso a dados operacionais. A conferência visual permanece com o operador. O terminal virtual deste executor não encaminhou Ctrl+C a todos os descendentes em uma tentativa; esse processo sintético foi encerrado por SIGTERM e seus temporários foram removidos. O teste automatizado adicional e o smoke via comando npm comprovaram SIGINT no **grupo** de processos, correspondente ao Ctrl+C de um terminal Ubuntu normal. Encerramento forçado pelo executor/SIGKILL continua sujeito ao limite de limpeza descrito acima.

O npm emitiu aviso de configuração de proxy `http-proxy` do ambiente de execução e depreciação transitiva de `prebuild-install`; não houve EBADENGINE. Nenhum desses avisos foi ocultado por atualização de dependências.
