# Duelo 3D — monorepo

Enquete informal de entretenimento entre Lula e Flávio Bolsonaro, sem vínculo com votação eleitoral oficial ou pesquisa representativa. O frontend mantém a votação simulada em memória e o layout publicado na main. O backend oferece somente um health check técnico; ele não recebe nem processa votos.

## Estrutura e responsabilidades

```text
apps/
  frontend/    Vite, interface, regras atuais, testes e seis WebM
  backend/     HTTP nativo Node, TypeScript ESM e teste de saúde
scripts/
  dev.mjs      Inicia os dois workspaces sem dependências adicionais
docs/
  monorepo.md  Decisões, diagnóstico e relação das movimentações
  validacao-monorepo.md
  PUBLICAR-UBUNTU.md
  historico/   Documentos preservados das fases anteriores
package.json
package-lock.json
```

Há dois npm workspaces: `frontend` e `backend`. A instalação usa exclusivamente o lockfile da raiz; não execute uma instalação independente dentro de cada aplicação. Dependências de frontend e backend são declaradas em seus respectivos manifests; Prettier permanece na raiz como ferramenta do repositório.

## Requisitos

- Node.js **24.15.0 ou superior dentro da linha 24** (`^24.15.0` nos manifests).
- Com nvm instalado: `nvm install` e `nvm use`, a partir do `.nvmrc` da raiz.
- npm **11 ou superior**, com suporte a workspaces.
- Acesso ao registro npm durante a instalação.

O Node 24.13.1 fica abaixo dos requisitos efetivos de jsdom 30.1.3, @asamuzakjp/css-color 7.1.7, @asamuzakjp/dom-selector 10.0.4 e w3c-xmlserializer 6.0.0 (`^24.15.0` na linha 24). As versões exatas de Vite, TypeScript e demais pacotes já publicados foram preservadas. Não há Express, Fastify, Nx ou Turborepo.

## Instalação e comandos na raiz

```bash
npm ci
npm run dev
```

Endereços locais padrão:

| Aplicação | Endereço |
| --- | --- |
| Frontend Vite | http://127.0.0.1:5173 |
| Backend | http://127.0.0.1:3000/health |
| Preview do frontend após build | http://127.0.0.1:4173 |

Use Ctrl+C no terminal de desenvolvimento para encerrar o conjunto. O script usa grupos de processos no Ubuntu para encerrar também os processos filhos. Uma saída inesperada de um workspace encerra o outro.

```bash
npm run build
npm test
npm run check:media
```

O build verifica tipos e gera `apps/frontend/dist/` e `apps/backend/dist/`. No backend, os testes também passam por checagem de tipos. Os dez cenários existentes (nove frontend e um health check) foram mantidos. Foram acrescentados sete testes de configuração: quatro no frontend e três no backend, totalizando 17 cenários esperados. Consulte o relatório de validação antes de interpretar isso como resultado de execução.

## Executar separadamente

A partir da raiz:

```bash
npm run dev:frontend
npm run dev:backend

npm run build --workspace frontend
npm run build --workspace backend
npm test --workspace frontend
npm test --workspace backend

# Depois de npm run build:
npm run preview --workspace frontend
npm start --workspace backend
```

Para conferir o endpoint:

```bash
curl --fail http://127.0.0.1:3000/health
```

Resposta: `{"status":"ok","service":"duelo-3d-backend"}`.

O backend escuta exclusivamente em `127.0.0.1`. A porta padrão é 3000, configurável por `PORT`, um inteiro de 1 a 65535:

```bash
PORT=3001 npm run dev:backend
```

Opcionalmente copie `apps/backend/.env.example` para `apps/backend/.env`. A inicialização carrega esse arquivo se existir usando `process.loadEnvFile`, sem dependência dotenv, ignorando somente ENOENT. O script dev é `node --watch src/main.ts`: o caminho opcional não é passado ao watcher. Nenhum arquivo é criado automaticamente. Alterações no `.env` do backend exigem reiniciar o processo. Variáveis já definidas no terminal têm prioridade. Nenhuma credencial é necessária; arquivos `.env` permanecem ignorados.

## Porta do frontend

`FRONTEND_PORT` configura somente o servidor de desenvolvimento, com padrão 5173. O Vite carrega `.env`, `.env.local` e arquivos por modo usando `loadEnv`, a partir de `apps/frontend`. O arquivo de exemplo é `apps/frontend/.env.example`; copiar para `.env` é opcional.

```bash
FRONTEND_PORT=5200 npm run dev:frontend
# Ou os dois serviços com portas escolhidas pelo terminal:
FRONTEND_PORT=5200 PORT=3001 npm run dev
```

Valores do terminal têm prioridade sobre os arquivos. Valores vazios, fracionários, não numéricos ou fora de 1 a 65535 produzem erro com o nome da variável. Com `server.strictPort: true`, uma porta ocupada encerra o Vite com erro, sem avançar para 5174/5175; libere a porta ou escolha outra explicitamente.

O host permanece `127.0.0.1`. A variável não usa o prefixo `VITE_` e não é exposta ao navegador. Não há `VITE_API_BASE_URL`, proxy ou integração com o backend. O preview continua na porta padrão 4173 e não usa FRONTEND_PORT.

## Frontend e mídias

O frontend foi movido a partir do commit `2cdee325df80e6278855c2d3e5d94bab7e500e1b` da main, incluindo o layout do PR #2. HTML, CSS, módulos visuais, animações e oito testes de regras/DOM mantêm os mesmos objetos Git. Os seis WebM reutilizam exatamente os objetos existentes; não houve upload Base64, conversão ou substituição.

As URLs públicas continuam em `/videos/...`; os caminhos relativos entre código e testes permanecem válidos dentro do workspace. Vite mantém sua configuração `base: './'`.

O teste de mídia continua verificando catálogo, quantidade, tamanho, cabeçalho e conteúdo integral. Seu manifesto foi corrigido para os vídeos efetivamente presentes na main: o anterior ainda descrevia tamanhos/hashes de uma versão antiga do ZIP. Agora a referência é o SHA do objeto Git (`SHA-1("blob " + tamanho + NUL + bytes)`), verificável localmente sem acesso a Git ou à rede. Isso preserva a referência exata dos binários atuais, sem inventar novos SHA-256.

## Formatação

```bash
npm run format:check
npm run format
```

Prettier **3.9.10** está declarado como devDependency da raiz e no lockfile único, sem mudança da versão já resolvida. A configuração Prettier existente permanece na raiz. Uma formatação global pode alterar a apresentação textual de arquivos históricos; revise o diff antes de commitá-la. A migração não reformatou o frontend.

## Limitações e próximas fases

Frontend e backend são independentes: não há comunicação entre eles, armazenamento, motor de pontuação no servidor, comentários, presentes, WebSocket, autenticação, Docker ou hospedagem em nuvem. A integração TikTok LIVE **não foi implementada**. O placar continua local e reinicia ao recarregar a página.

Nesta sessão não havia ambiente de execução utilizável: instalação, compilação, testes, inicialização HTTP e conferência visual do monorepo não puderam ser executados. A revisão realizada foi estática e por hashes Git. O usuário relatou que a versão anterior passou em build, dez testes e check:media no Ubuntu com Node 24.13.1/npm 11.8.0, com avisos EBADENGINE. Esse resultado não valida as novas correções. Reexecute os comandos abaixo com Node >=24.15.0 na linha 24 antes do merge; não foi confirmada aqui a eliminação dos avisos. Veja `docs/validacao-monorepo.md` e `docs/correcoes-configuracao.md`.

```bash
npm ci
npm run build
npm test
npm run check:media
npm run format:check
npm run dev
```

Próximas fases, sujeitas a novo escopo e autorização: validar regras/eventos externos, definir adaptador TikTok, definir sincronização entre backend e frontend. Nenhuma dessas fases está antecipada nesta entrega.
