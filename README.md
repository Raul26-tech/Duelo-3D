# Duelo 3D — simulação local em tempo real

Enquete informal de entretenimento, sem vínculo com votação eleitoral oficial ou pesquisa representativa.

O monorepo usa npm workspaces: apps/frontend (Vite/TypeScript/arena) e apps/backend (Node/TypeScript ESM/HTTP e WebSocket). O backend é a única autoridade da simulação: os botões enviam comandos e a arena atualiza somente quando recebe estado do servidor. Não há TikTok, comentários, presentes, persistência ou disputa real.

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

Sessão e placar são exclusivamente em memória. Reiniciar o backend reinicia a sessão e, sem token fixo, gera outra chave.

Votos são sempre +1, validados e deduplicados pelo servidor. Reset é autorizado e não limpa identidades já aplicadas. A sessão aceita até 4096 comandos distintos e rejeita novos quando atinge o limite; não reaplica comandos descartados de cache.

A conexão usa snapshot, versão monotônica, descarte de sockets/sessões antigas e reconexão automática com backoff até 8 s. Votos de resultado incerto não são reenviados. Enquanto desconectado, o último placar pode permanecer visível, claramente indicado como possivelmente desatualizado; não há pontuação offline.

Arquitetura, contratos, limites, exemplos e segurança: [docs/realtime-simulation.md](docs/realtime-simulation.md).

## Validação desta entrega

HTML, CSS, seis vídeos e os módulos de renderização/animação foram preservados. Os cenários anteriores continuam presentes; total esperado após novas verificações: 38.

Não há executor utilizável nesta sessão. Instalação, compilação, testes Node, formatação, serviços HTTP/WS, navegador e Ctrl+C não foram executados. As verificações isoladas do redutor em JavaScript não substituem esses comandos. As novas dependências/entradas do lock também precisam da confirmação de npm ci. O PR deve ser validado localmente antes do merge.
