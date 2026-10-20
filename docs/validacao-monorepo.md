# Validação do monorepo

## Contexto e limite da evidência

O usuário relatou validação da etapa inicial no Ubuntu: build, dez testes e mídia aprovados. Após as primeiras correções, os testes de ambiente falharam com saída ANSI e format:check apontou 20 arquivos. Esses relatos pertencem às versões anteriores e não aprovam a versão centralizada.

Nesta sessão, node --version retornou "No usable execution environment is available". Não há execução de comandos Node/npm, navegador ou servidores. Foram feitas apenas inspeção via GitHub e revisão estática.

## Situação das verificações

- npm ci: pendente; não se confirma eliminação dos avisos EBADENGINE.
- npm run build: pendente.
- npm test: pendente; 21 cenários esperados (14 frontend, 7 backend).
- npm run check:media: pendente nesta revisão; seis objetos Git preservados.
- npm run format:check: pendente; não se confirma que os 20 apontamentos foram eliminados.
- npm run dev, HTTP e Ctrl+C: pendentes.
- Conferência visual: não realizada nesta sessão; arquivos HTML/CSS preservados.

Os testes novos/atualizados usam fixtures temporários de monorepo, diretório de execução variado e configuração serializada como JSON. NO_COLOR=1 e remoção de FORCE_COLOR isolam a saída dos subprocessos. Testes verificam configuração central presente/ausente, terminal prioritário, hosts inválidos e watcher. Não sobrescrevem arquivos locais do desenvolvedor.

## Conferência no Ubuntu

```bash
git switch chore/monorepo-foundation
git pull --ff-only
# Se usar nvm:
nvm install
nvm use
npm ci
npm run build
npm test
npm run check:media
npm run format:check
npm run dev
```

Sem arquivo .env, o frontend deve atender em 127.0.0.1:5173 e o backend em 127.0.0.1:3000. Se já houver configuração local, faça o cenário sem arquivo num clone separado, preservando os arquivos existentes.

Em outro terminal:

```bash
curl --fail http://127.0.0.1:3000/health
curl --fail --output /dev/null http://127.0.0.1:5173/
for nome in flavio-feliz flavio-pulando flavio-triste lula-feliz lula-pulando lula-triste; do
  curl --fail --output /dev/null "http://127.0.0.1:5173/videos/$nome.webm" || break
done
```

Confirme status 200 e contrato {"status":"ok","service":"duelo-3d-backend"}. Use Ctrl+C e confira que as portas foram liberadas.

Opcionalmente configure o .env da raiz com os três valores do exemplo. Repita a execução e confira a prioridade do terminal:

```bash
FRONTEND_PORT=5200 BACKEND_PORT=3001 npm run dev
```

Inicie também cada workspace individualmente: comandos npm run dev:frontend/dev:backend na raiz e npm run dev no diretório de cada aplicação. Todos devem usar a mesma configuração central.

Para conflito da porta frontend, mantenha um Vite ativo e inicie outro na mesma porta: o segundo deve falhar claramente sem alternar de porta. Confira erro em FRONTEND_PORT inválida e em BACKEND_HOST=0.0.0.0; nenhum host público deve ser aberto.

Após o build, use npm run preview --workspace frontend e npm start --workspace backend. Confira as mídias no preview (4173) e o /health compilado; o backend em dist deve continuar lendo o mesmo arquivo central.

## Formatação controlada

O Prettier e seus scripts continuam disponíveis na raiz; o comando de verificação não altera arquivos. Os documentos históricos ficam excluídos. Não foi executado prettier nesta sessão; ajustes manuais de recuo/JSON não equivalem a um resultado aprovado. Se ainda houver apontamentos, formate somente os arquivos ativos indicados e repita o check, sem redesenhar a interface ou alterar comportamento.
