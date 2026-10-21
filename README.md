# Duelo 3D — simulação local e motor de regras

Enquete informal de entretenimento, sem vínculo com votação eleitoral oficial ou pesquisa representativa.

O monorepo usa npm workspaces: apps/frontend (Vite/TypeScript/arena) e apps/backend (Node/TypeScript ESM/HTTP e WebSocket). O backend é a única autoridade da simulação: os botões enviam comandos e a arena atualiza somente quando recebe estado do servidor. Não há ingestão TikTok ou disputa real. A Fase 4 oferece persistência SQLite optativa para o motor interno, sem conectar esse armazenamento à arena. A Fase 3 acrescenta um motor interno e testável de comentários/presentes, independente do transporte e ainda sem entrada externa ou ligação com a arena.

## Executar juntos

Node >=24.15.0 dentro da linha 24 e npm 11+.

```bash
npm ci
npm run dev
```

O .env na raiz é opcional; veja .env.example. Os padrões são FRONTEND_PORT=5173, BACKEND_PORT=3000 e BACKEND_HOST=127.0.0.1.

1. Abra http://127.0.0.1:5173.
2. Copie a chave temporária exibida no terminal do backend.
3. Clique em Autorizar simulação e cole a chave.
4. Use os botões existentes. Outras abas autorizadas recebem o mesmo placar.
5. Ctrl+C encerra os serviços no Ubuntu.

O entrypoint dev habilita explicitamente a simulação local, salvo SIMULATION_MODE=false. Fora de NODE_ENV=development, ela permanece desabilitada. npm start --workspace backend não habilita simulação por padrão.

Pode-se configurar SIMULATION_TOKEN no .env central, sem prefixo VITE_. Ela não é exposta pelo Vite nem enviada na URL; o operador informa a chave à aba, que a mantém apenas em memória. Variáveis do terminal têm prioridade. Não publique o .env.

```bash
SIMULATION_MODE=false npm run dev
FRONTEND_PORT=5200 BACKEND_PORT=3001 npm run dev
```

Use a URL 127.0.0.1 na porta do frontend. Origin, chave e modo são validados; acesso à porta local sozinho não autoriza comandos. Frontend mantém strictPort: uma porta ocupada causa erro.

## Build, testes e execução individual

```bash
npm run build
npm test
npm run check:media
npm run format:check

npm run dev:frontend
npm run dev:backend

# Após build: HTTP técnico, sem habilitar simulação por padrão
npm start --workspace backend
curl --fail http://127.0.0.1:3000/health
```

npm run build gera apps/frontend/dist e apps/backend/dist. Preview continua disponível, mas o proxy/origem de simulação é configurado para o Vite dev nesta fase. Não há deploy.

Prettier 3.9.10 permanece na raiz; npm run format altera os arquivos ativos. Documentos históricos e vídeos permanecem excluídos da formatação.

## Estado, reconexão e limites

Na simulação WebSocket experimental, sessão e placar continuam exclusivamente em memória. Reiniciar o backend reinicia a sessão e, sem token fixo, gera outra chave.

Votos são sempre +1, validados e deduplicados pelo servidor. Reset é autorizado e não limpa identidades já aplicadas. A sessão aceita até 4096 comandos distintos e rejeita novos quando atinge o limite; não reaplica comandos descartados de cache.

A conexão usa snapshot, versão monotônica, descarte de sockets/sessões antigas e reconexão automática com backoff até 8 s. Votos de resultado incerto não são reenviados. Enquanto desconectado, o último placar pode permanecer visível, claramente indicado como possivelmente desatualizado; não há pontuação offline.

Arquitetura, contratos, limites, exemplos e segurança: [docs/realtime-simulation.md](docs/realtime-simulation.md).

## Motor de regras — Fase 3

`apps/backend/src/scoring` interpreta comentários com um único candidato, valida presentes pelo catálogo do servidor e controla identidades e combos acumulados. O catálogo padrão é vazio; dados sintéticos existem somente nos testes. O motor aceita simulação e observação, rejeita modo real e não adiciona endpoints ou dependências.

A simulação WebSocket existente permanece preservada. O novo motor não recebe comandos do navegador e ainda não alimenta a arena. A integração futura deverá autenticar a fonte antes de construir os eventos normalizados.

Contratos, limites, política de finalização de combos e exemplos: [docs/scoring-engine.md](docs/scoring-engine.md).

## Validação da Fase 3

Veja [docs/validacao-scoring-engine.md](docs/validacao-scoring-engine.md) para os comandos executados e suas limitações. Os 38 testes existentes foram preservados; o motor acrescenta testes unitários e de integridade. HTML, CSS, transporte, animações e seis WebM não são alterados por esta fase.

## Persistência transacional — Fase 4

`apps/backend/src/persistence` acrescenta armazenamento SQLite local ao motor de regras. Cada processamento usa transação, recuperação pelo mesmo motor e verificação integral antes de devolver o estado comitado. Identidades, fingerprints, combos, sessão, placar e versão são persistidos juntos. Dados ausentes/inconsistentes bloqueiam a retomada.

Biblioteca: better-sqlite3 12.10.1, validada com Node 24.15.0. O banco padrão fica em `~/.local/state/duelo-3d/scoring.sqlite`, fora do repositório; criação e retomada são operações explícitas da API interna. `npm run dev` continua iniciando a simulação existente sem criar banco.

Arquitetura, esquema, exemplo e recuperação: [docs/scoring-persistence.md](docs/scoring-persistence.md). Resultados e limitações: [docs/validacao-scoring-persistence.md](docs/validacao-scoring-persistence.md).

## TikTok LIVE — diagnóstico da Fase 5.1

Adaptador independente, com `tiktok-live-connector@2.5.0`, somente para observação. Desligado por padrão; não altera placar, SQLite, simulação ou arena. Eventos normalizados nunca são elegíveis para pontuação nesta fase.

```bash
# Padrão seguro: termina desligado, sem conectar
TIKTOK_DIAGNOSTIC_ENABLED=false npm run diagnose:tiktok
```

Para diagnóstico real posterior, configurar opt-in e handle no `.env` central e executar o mesmo comando em terminal dedicado. A execução é limitada a cinco minutos e possui logs pseudonimizados e encerramento por Ctrl+C. `npm run dev` continua independente do conector.

Contratos, campos inspecionados, incertezas de combos, serviço de assinatura e roteiro de LIVE: [docs/tiktok-live-diagnostic.md](docs/tiktok-live-diagnostic.md). Resultados: [docs/validacao-tiktok-diagnostic.md](docs/validacao-tiktok-diagnostic.md). Nenhuma LIVE foi validada nesta entrega.
