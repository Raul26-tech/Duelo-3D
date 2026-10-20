# WebSocket e simulação autoritativa

## Escopo e arquitetura

Base: main em eb1891439a23adee80f494234ff10bbe2c90efc5. Branch feat/realtime-simulation.

O backend é a única autoridade usada pela arena em execução. Seus módulos realtime/protocol.ts, session.ts, config.ts e server.ts separam validação, sessão, configuração e transporte. O estado é mantido exclusivamente em memória para uma simulação local.

No frontend, realtime/protocol.ts valida mensagens, replica.ts controla sessão/versão e client.ts controla autorização/reconexão. main.ts compõe a conexão com a renderização existente. O código antigo de store/cálculos permanece para preservar testes e utilitários; o entrypoint da arena não instancia o store nem incrementa pontos localmente, mesmo desconectado.

Nenhum endpoint HTTP de pontuação foi criado. GET /health mantém o contrato anterior. Os seis WebM, HTML, CSS e módulos de renderização/animação são preservados.

## Execução

Node 24.15+ dentro da linha 24 e npm 11+:

```bash
npm ci
npm run build
npm test
npm run check:media
npm run format:check
npm run dev
```

O entrypoint backend src/dev.ts carrega o .env central e define NODE_ENV=development e SIMULATION_MODE=true apenas se ainda não estiverem configurados. SIMULATION_MODE=false desabilita. npm start --workspace backend não habilita simulação por padrão, mesmo que SIMULATION_MODE=true esteja no arquivo: NODE_ENV também precisa ser development.

Configuração central opcional:

```dotenv
FRONTEND_PORT=5173
BACKEND_PORT=3000
BACKEND_HOST=127.0.0.1
SIMULATION_MODE=true
# SIMULATION_TOKEN=<chave privada de 32 a 128 caracteres A-Za-z0-9_->
```

Sem chave configurada, o backend gera uma chave aleatória temporária e a mostra no terminal de desenvolvimento. Ela muda ao reiniciar o processo. Chaves configuradas não são reimpressas.

Abra http://127.0.0.1:5173, clique em Autorizar simulação e cole a chave. Ela fica somente na memória da aba, nunca na URL, em localStorage, em variável VITE_ ou no bundle. Cada aba deve ser autorizada. Botões de voto/reset permanecem desabilitados enquanto não houver snapshot da conexão autorizada.

O Vite encaminha somente /realtime ao backend por proxy WebSocket local, preservando o Origin. O navegador utiliza a mesma origem da página, sem precisar de VITE_API_BASE_URL ou acesso direto ao segredo de ambiente. Use o endereço 127.0.0.1 mostrado pelo Vite, pois localhost é outra origem e é rejeitado. Preview/deploy não são adicionados como novas origens nesta fase.

Para desabilitar explicitamente:

```bash
SIMULATION_MODE=false npm run dev
```

## Autorização e limites

Origin precisa ser exatamente http://127.0.0.1:FRONTEND_PORT. Ausência de Origin, origem externa, caminho/query diferente de /realtime, conexão que não seja loopback ou limite de 32 conexões rejeitam o upgrade com 403.

Após o upgrade, o cliente tem cinco segundos para enviar simulation.authorize com a chave. Token comparado em tempo constante para tamanhos iguais. Chave incorreta ou comando antes da autorização recebe command.rejected e fechamento 1008. Nenhum snapshot é enviado antes de autorizar.

Os votos/reset exigem conexão autenticada, sessão atual e mode=simulation. Cada voto vale exatamente +1. O parser rejeita campos extras, scores, amount e lados não previstos. Não existe conversão de simulação para disputa real, modo real implementado, ingestão de comentários ou presentes.

Limites de transporte: mensagens textuais até 4096 bytes, compressão desabilitada, até 30 mensagens por segundo por conexão, backpressure de 64 KiB e ping/pong a cada 15 segundos. Cliente lento ou sem resposta é terminado. O frontend também limita o tamanho das mensagens recebidas e descarta envelopes inválidos.

A autorização é uma capacidade de operador local para simulação, não um sistema de usuários de produção. Ter acesso à porta local não autoriza comandos. Não configure NODE_ENV=development em ambiente público.

## Contratos

Todos os eventos de estado usam protocol=1 e state completo:

```typescript
type State = {
    mode: 'simulation';
    sessionId: string;
    version: number;
    scores: { a: number; b: number };
};
```

| Mensagem             | Campos e finalidade                                               |
| -------------------- | ----------------------------------------------------------------- |
| simulation.authorize | type, correlationId, token; primeiro comando da conexão           |
| state.snapshot       | protocol, type, state; após autorização ou repetição idempotente  |
| simulation.vote      | type, correlationId, mode, sessionId, side ('a' ou 'b')           |
| simulation.reset     | type, correlationId, mode, sessionId                              |
| state.updated        | protocol, type, state, correlationId, effect (vote/side ou reset) |
| command.rejected     | protocol, type, correlationId (ou null se inválido), code         |

Identificadores de comando/sessão: 16 a 64 caracteres A-Za-z0-9_-. O cliente utiliza crypto.randomUUID. Auth é separada dos comandos de estado e não altera a versão.

Exemplo:

```json
{
    "type": "simulation.vote",
    "correlationId": "command_012345678901",
    "mode": "simulation",
    "sessionId": "session_012345678901",
    "side": "a"
}
```

Não há campo de quantidade ou de placar enviado pelo cliente. Scores são inteiros não negativos e seguros no JavaScript. Versão aumenta uma vez por comando aceito, inclusive reset; sessionId permanece durante o reset.

## Idempotência e capacidade

A identidade é (sessionId, correlationId). Um Map guarda o tipo/lado dos comandos aplicados durante toda a sessão. Repetição igual não altera nada e retorna snapshot atual somente ao solicitante; reutilização do identificador com outro comando é ID_CONFLICT.

Reset não limpa as identidades. Há limite de 4096 comandos aplicados: ao atingir, novos identificadores recebem SESSION_CAPACITY. Nenhuma entrada é descartada para dar lugar a outra, impedindo reaplicação tardia. Essa limitação exige reiniciar a simulação ao esgotar a sessão; não é armazenamento permanente.

## Reconexão e renderização

Backoff de 500 ms até 8 s, sem fila nem reenvio automático de votos. Chave inválida suspende tentativas até o operador informar outra.

Cada nova conexão precisa de snapshot antes de aceitar updates. Uma geração de conexão descarta callbacks de sockets antigos. A réplica rejeita versões antigas/iguais, updates de outra sessão e troca de sessão no meio da mesma conexão. No primeiro snapshot da reconexão, uma nova sessão é aceita; a mesma sessão não pode retroceder sua versão.

O último placar autorizado pode permanecer visível enquanto desconectado, com indicação de que pode estar desatualizado. Não há fallback de pontuação local. Snapshot reinicia somente a apresentação das animações e renderiza os scores autorizados; state.updated inclui o efeito para manter salto por voto e limpeza por reset.

## Reinício e limitações

Reiniciar o backend perde placar, deduplicação, conexões e chave temporária e cria novo sessionId/versão zero. Cada aba precisa da nova chave quando ela for regenerada. Isso não implementa recuperação de disputa real; não há persistência, banco ou replay de eventos reais.

Os tipos do protocolo ficam próximos de cada lado para não introduzir um pacote de build compartilhado nesta etapa. O documento e os testes descrevem o contrato comum. Não há catálogo de presentes, interpretação de comentários, TikTok, motor definitivo, autenticação de produção ou administração externa.

## Dependências e validação

ws 8.18.3 é a única dependência de runtime adicionada. @types/ws 8.18.1 é dependência de desenvolvimento. O navegador usa WebSocket nativo. As novas entradas do lock têm versões/tarballs explícitos; instalação e resolução pelo npm ainda precisam ser verificadas no ambiente local, pois não houve executor para regenerar o lock via npm.

Os 21 cenários anteriores foram preservados, com adaptação da expectativa de configuração para incluir o proxy e isolamento do ambiente dos subprocessos existentes. Foram adicionados 11 cenários backend e 6 frontend: total esperado 38, não resultado de execução.

Cobertura nova: estado inicial, autorização, formato/campos/pontos arbitrários, deduplicação e conflito, reset, limite, modo desabilitado, snapshot e broadcast reais, reconexão, origem/chave inválidas, JSON/payload, versões/sessões antigas e ausência de atualização otimista.

O executor está indisponível nesta sessão, inclusive para node --version. npm ci/build/test/check:media/format:check/dev, HTTP, navegador e Ctrl+C não foram executados. Houve apenas inspeção por GitHub e 12 verificações isoladas do redutor convertido para JavaScript em V8; isso não valida compilação TypeScript, Node, ws ou npm. PR deve permanecer em rascunho até validação local completa.
