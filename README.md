# Duelo 3D — monorepo

Enquete informal de entretenimento, sem vínculo com votação eleitoral oficial ou pesquisa representativa. Frontend e backend são independentes: a votação continua simulada no navegador, e o backend oferece somente GET /health.

## Organização

- `apps/frontend`: Vite, TypeScript, HTML/CSS, animações WebM e testes.
- `apps/backend`: HTTP nativo Node.js, TypeScript ESM e testes.
- `scripts/dev.mjs`: inicia os dois serviços e encerra seus processos filhos.
- `docs/`: decisões e validação; `docs/historico/` preserva documentos antigos.
- `.env.example`: único exemplo de configuração do monorepo.
- `package.json` e `package-lock.json`: npm workspaces e lockfile único.

## Requisitos e instalação

Node **24.15.0 ou superior dentro da linha 24** (`^24.15.0`) e npm 11+.
O requisito acompanha as dependências existentes, sem atualizar suas versões.

```bash
# Se usar nvm:
nvm install
nvm use
npm ci
npm run dev
```

A criação de .env não é necessária. Sem o arquivo, os dois serviços usam seus padrões.

## Um único arquivo de ambiente

Opcionalmente, crie `.env` na **raiz do repositório**, usando `.env.example`:

```dotenv
FRONTEND_PORT=5173
BACKEND_PORT=3000
BACKEND_HOST=127.0.0.1
```

Não mantenha configuração em arquivos .env por workspace. As aplicações não os leem. A migração não apaga arquivos locais; se já existirem, transfira os valores desejados para a raiz por conta própria. O antigo PORT foi substituído por BACKEND_PORT e não é usado como fallback.

Somente o exemplo da raiz é versionado. .env e suas variantes locais continuam ignorados pelo Git. Não sobrescreva um .env existente ao copiar exemplos.

As variáveis do terminal têm prioridade:

```bash
FRONTEND_PORT=5200 BACKEND_PORT=3001 npm run dev
```

O backend encontra o arquivo pela localização de seu módulo (tanto src quanto dist), carrega-o com process.loadEnvFile e ignora somente ENOENT. Não passa um arquivo inexistente ao watcher e não depende do diretório atual. Alterações no .env do backend exigem reiniciar o processo.

O Vite fixa root no frontend e envDir na raiz do monorepo e usa loadEnv para a configuração do servidor. Nenhum .env dentro de apps é carregado. A convenção de modos do Vite continua disponível na raiz; para manter a mesma configuração nos dois serviços, utilize apenas o .env central, pois o backend não carrega variantes por modo.

FRONTEND_PORT e BACKEND_PORT devem ser inteiros entre 1 e 65535. O frontend usa strictPort e host 127.0.0.1: uma porta ocupada gera erro, sem escolher 5174/5175. BACKEND_HOST aceita somente os literais 127.0.0.1 e ::1; vazio, localhost, 0.0.0.0, ::, endereços de rede e nomes externos são rejeitados para impedir exposição acidental.

Os endereços padrão são http://127.0.0.1:5173 e http://127.0.0.1:3000/health. O preview do frontend permanece na porta 4173; FRONTEND_PORT controla somente o dev.

Variáveis privadas, inclusive futuras credenciais TikTok, destinam-se exclusivamente ao backend. Não use prefixo VITE_ em segredos. envPrefix não foi ampliado e o arquivo central não é publicado como asset do frontend. FRONTEND_PORT não é inserida no bundle.

## Comandos na raiz

```bash
npm run dev
npm run build
npm test
npm run check:media
npm run format:check
```

Ctrl+C no dev conjunto encerra os grupos de processos no Ubuntu. O build gera apps/frontend/dist e apps/backend/dist.

## Executar cada workspace

Na raiz:

```bash
npm run dev:frontend
npm run dev:backend
npm run preview --workspace frontend
npm start --workspace backend
```

Dentro de apps/frontend ou apps/backend, `npm run dev`, `npm run build` e `npm test` também usam a configuração central. Para produção local do backend, execute o build antes de npm start.

```bash
curl --fail http://127.0.0.1:3000/health
```

Resposta: `{"status":"ok","service":"duelo-3d-backend"}`.

## Formatação e testes

Prettier 3.9.10 permanece como devDependency da raiz. `npm run format` aplica formatação e `npm run format:check` apenas verifica. Documentos arquivados em docs/historico e os vídeos ficam fora da formatação. HTML/CSS não foram redesenhados. Ajustes de recuo em TypeScript não alteram regras de votação.

Os testes cobrem placar, DOM, integridade dos seis WebM, porta ocupada, configuração central independente do cwd, prioridade do terminal, host seguro e backend em --watch com/sem .env. Os subprocessos de teste usam NO_COLOR=1 e removem FORCE_COLOR para evitar saídas ANSI.

A versão atual prevê 21 cenários (14 frontend e 7 backend); isso é contagem esperada, não um resultado de execução. Nesta sessão o executor está indisponível: npm ci, build, testes, mídia por HTTP, Prettier e dev não puderam ser executados. Veja docs/validacao-monorepo.md.

## Limitações e próximas fases

Sem integração TikTok LIVE, comentários, presentes, WebSocket, persistência, autenticação, Docker ou deploy. Backend não processa votos e frontend não o consulta. Qualquer integração ou refatoração interna posterior depende de novo escopo.
