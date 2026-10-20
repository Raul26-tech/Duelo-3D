# Correções de configuração do monorepo

## Base e escopo

Branch existente chore/monorepo-foundation, a partir de 23330cdfa81db784a449acda6b84fbc48bb60d93; PR #3 preservado. A main não recebe commits. Nenhuma alteração em HTML, CSS, personagens, vídeos, animações ou regras de votação.

## Causas e soluções

| Problema | Causa identificada | Correção |
| --- | --- | --- |
| ENOENT no backend sem .env | O comando combinava --watch com --env-file-if-exists=.env; no Node 24.13.1 o usuário observou o watcher tentar vigiar o caminho inexistente | Removida a opção da CLI; main carrega o arquivo opcional com a API nativa loadEnvFile em runtime e ignora somente ENOENT |
| Frontend em 5174/5175 | Comportamento padrão do Vite ao encontrar a porta ocupada; não havia configuração da variável | loadEnv no vite.config.ts, FRONTEND_PORT validada, padrão 5173, host 127.0.0.1 e strictPort true |
| Prettier indisponível como dependência direta | package.json raiz e entrada raiz do lock tinham devDependencies vazias, apesar da presença do pacote no lock | Prettier 3.9.10 declarado na raiz e na entrada raiz do lock, sem alteração da versão ou integridade |
| EBADENGINE | engines >=24.0.0 aceitava 24.13.1, abaixo do exigido pelas dependências já resolvidas | engines ^24.15.0 na raiz e nos workspaces e respectivos registros do lock; .nvmrc 24.15.0 |

A causa do erro do watcher é inferida do comando publicado e do erro relatado pelo usuário; não houve reprodução nesta sessão indisponível.

## Decisões

- A API process.loadEnvFile é nativa e estável na linha Node 24. O carregamento preserva variáveis existentes no terminal. Não se cria .env vazio e não se adiciona dotenv.
- O backend continua com porta padrão 3000, host 127.0.0.1 e apenas GET /health. O arquivo opcional é procurado no diretório de execução do workspace. Sua edição exige reiniciar o backend.
- O frontend usa loadEnv com prefixo de leitura FRONTEND_, sem mudar envPrefix nem definir variáveis no bundle. Não há VITE_FRONTEND_PORT ou VITE_API_BASE_URL.
- FRONTEND_PORT afeta somente o dev; preview mantém sua configuração existente. Porta ocupada gera erro, sem fallback. Base './' preservada.
- As versões/resoluções de dependências foram mantidas. Não se executou atualização geral nem formatação de arquivos existentes.
- .prettierrc.json e .prettierignore permanecem inalterados. format:check poderá apontar arquivos preexistentes fora do padrão; seu resultado não foi executado nem encoberto com exclusões.

## Testes acrescentados (pendentes de execução)

Frontend, quatro cenários em tests/config.test.ts:
1. Porta padrão, limites válidos e rejeição de entradas inválidas.
2. Configuração sem .env com host, strictPort e base preservados.
3. Carregamento por arquivo/modo e prioridade do terminal.
4. Vite real rejeitando uma porta reservada, sem tentar a próxima.

Backend, três cenários em tests/environment.test.ts:
1. Arquivo ausente não causa erro, não é criado e mantém porta 3000.
2. Arquivo presente é carregado, terminal prevalece e ENOTDIR não é ignorado.
3. Processo Node --watch real inicia sem .env e responde ao contrato de /health; limpeza do processo e filhos no teste.

Os dez testes anteriores não foram editados. O total esperado passa a 17. Testes usam diretórios temporários e portas efêmeras; não sobrescrevem arquivos .env do desenvolvedor.

## Evidências e validação

O usuário informou, para a versão anterior: npm ci concluído com avisos EBADENGINE; build aprovado; dez testes aprovados; check:media aprovado; frontend iniciado e visualmente conferido no Ubuntu com Node 24.13.1/npm 11.8.0.

Nesta sessão, a tentativa de consultar node --version falhou com "No usable execution environment is available". Não foi possível executar npm ci, build, testes, check:media, format:check ou dev. Não foi testado HTTP nem Ctrl+C, nem foi realizada conferência visual. Não foi confirmada a eliminação de EBADENGINE. Revisão estática não substitui essas verificações.

### Verificação local após atualizar a branch

```bash
git switch chore/monorepo-foundation
git pull --ff-only
# Com nvm instalado:
nvm install
nvm use
node --version
npm --version
npm ci
npm run build
npm test
npm run check:media
npm run format:check
npm run dev
```

Sem arquivos .env, verificar frontend em 127.0.0.1:5173 e backend em 127.0.0.1:3000/health (200 e corpo esperado). Se algum .env local já existir, preserve-o; faça o cenário sem .env num clone novo.

Em outra execução, conferir `FRONTEND_PORT=5200 npm run dev`, valor inválido e porta ocupada (use um servidor de teste já ativo, ou dois processos Vite, um por terminal). Confira que o segundo Vite falha sem escolher outra porta. Confira também os seis vídeos e Ctrl+C liberando as portas dos dois serviços.

Copiar exemplos para .env é opcional; configurar PORT e FRONTEND_PORT simultaneamente no terminal deve prevalecer sobre os arquivos. Não publique os arquivos .env.

## Referências oficiais

- https://nodejs.org/docs/latest-v24.x/api/process.html#processloadenvfilepath
- https://vite.dev/config/#using-environment-variables-in-config
- https://vite.dev/config/server-options.html#server-strictport
