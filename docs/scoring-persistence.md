# Fase 4 — persistência e recuperação transacional

Base: `main` em `67936e83c6c878ef60e3a393eccadf244894fa4b`, com o PR #5 integrado. Branch: `feat/scoring-persistence`.

## Escopo e biblioteca

Persistência optativa do motor de regras da Fase 3, sem ingestão de rede ou pontuação real. O HTTP, WebSocket, autorização, botões, frontend e vídeos da simulação experimental da Fase 2 permanecem inalterados e em memória.

Escolha: **better-sqlite3 12.10.1**, fixado no backend, com **@types/better-sqlite3 9.6.0** somente para desenvolvimento. A biblioteca oferece transações síncronas reais, rollback automático e `BEGIN IMMEDIATE`, sem framework/ORM. Seu manifesto inclui Node 24 na compatibilidade; instalação e testes desta entrega foram executados no **Node 24.15.0**. Não houve atualização das versões das dependências preexistentes.

O `node:sqlite` do Node 24.15.0 é classificado como **Stability 1.2 — Release candidate**, não como API estável. Por isso não é assumido como uma API estável para esta fundação. A versão 13.0.3 de better-sqlite3 foi avaliada, mas sua instalação limpa acionou node-gyp e falhou no executor; a versão 12.10.1 selecionada passou em `npm ci`.

Referências primárias: [Node 24.15 SQLite](https://nodejs.org/download/release/v24.15.0/docs/api/sqlite.html), [API de transações better-sqlite3](https://github.com/WiseLibs/better-sqlite3/blob/v12.10.1/docs/api.md), [manifesto 12.10.1](https://github.com/WiseLibs/better-sqlite3/blob/v12.10.1/package.json).

## Arquitetura

| Componente                   | Responsabilidade                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `scoring/engine.ts`          | Único motor das regras existentes; acrescenta checkpoint completo imutável e identidade de sessão restaurável |
| `scoring/contracts.ts`       | Configuração/checkpoint sem SQL ou dependência SQLite                                                         |
| `persistence/port.ts`        | Interface transacional mínima de armazenamento e erro de integridade                                          |
| `persistence/coordinator.ts` | Reconstrução, verificação, processamento isolado e entrega após commit                                        |
| `persistence/sqlite.ts`      | Adaptador, SQL parametrizado, transações e composição `openSqliteScoring`                                     |
| `persistence/schema.ts`      | Esquema 1, identificador da aplicação e versão das regras                                                     |
| `persistence/paths.ts`       | Caminho externo, absoluto e independente do cwd                                                               |

Não existe um segundo redutor de pontuação no adaptador. O coordenador reconstrói uma instância do mesmo motor reprocessando o histórico e preservando a sessão. Somente a instância temporária é alterada durante o processamento. Ela é descartada em caso de erro; não há engine mutável compartilhado ou cache de placar a corrigir depois de rollback.

O input é normalizado uma única vez para que motor e histórico recebam a mesma cópia. IDs grandes são armazenados como texto, sem conversão SQL para número.

## Esquema

Um arquivo representa uma única disputa/contexto. Todas as tabelas são `STRICT`.

| Tabela             | Conteúdo e restrições                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dispute`          | Uma linha: sessão única, origem, sala, domínio, capacidade, catálogo, versão das regras, placares, versão do estado, contagem do histórico e digest SHA-256 |
| `journal`          | Comandos normalizados que realmente modificaram estado interno, com posição contígua e chave primária sessão/posição                                        |
| `event_identities` | Identidade composta e fingerprint, com chave primária sessão/identidade                                                                                     |
| `gift_sequences`   | Identidade da sequência, presente, acumulado, finalização e quarentena, com chave primária sessão/identidade                                                |

As três tabelas filhas referenciam `dispute.session_id` por FK diferível até o commit. `foreign_keys=ON` é ativado em cada conexão. Há `CHECK`s para domínio, limites de inteiros seguros, capacidade, posições e flags. O total dos placares também deve permanecer seguro.

O histórico inclui votos, presentes, pendências, não votos registrados e rejeições que mudam quarentena. Mudança de sequência sem mudança do placar/versão também precisa de persistência. Retransmissões sem efeito, eventos malformados e rejeições sem mudança interna não geram histórico adicional.

Identidades e sequências continuam consumindo o limite conjunto do motor, máximo 10.000, sem evicção. As transições registradas ficam igualmente limitadas a 10.000: cada uma consome uma identidade nova ou muda uma sequência ainda não colocada em quarentena. Não há coleta automática que permita reaplicar eventos antigos.

## Transação, rollback e publicação

Cada chamada `process` usa uma transação **BEGIN IMMEDIATE**:

1. Ler configuração, histórico e projeções dentro do bloqueio de escritor.
2. Verificar integridade e reconstruir o motor com a sessão persistida.
3. Processar o evento na instância temporária usando as regras originais.
4. Se houver mudança interna, acrescentar o comando ao histórico e gravar identidades/fingerprints, sequências, placares, versão e digest na mesma transação.
5. Commit. Somente então devolver a decisão/snapshot ao chamador.

Exceção SQL, violação de FK no commit ou erro de processamento propagam e causam rollback integral. A memória temporária não é publicada. O próximo comando recupera novamente o estado do banco. As projeções são regravadas integralmente nesta implementação simples; o histórico é apenas acrescentado.

WAL com `synchronous=FULL` é usado para durabilidade local, dentro das garantias de SQLite e do sistema de arquivos. Não há `await` dentro da transação. O chamador deve publicar **depois** de `process` retornar. Uma falha de publicação não desfaz o commit nem autoriza somar outra vez. Uma falha/resultado incerto pode ser reconciliada pelo snapshot e pelo reenvio da mesma identidade, nunca por um novo ID artificial.

## Recuperação e bloqueio seguro

`resume` exige arquivo existente. Não cria automaticamente disputa vazia. Ao abrir são verificados identificador da aplicação, versão do esquema, modo WAL, `integrity_check` e `foreign_key_check`.

A cada operação são conferidos marcadores do esquema, referências, contexto da sessão, capacidade, posições/contagem do histórico e digest de todo o conteúdo. O mesmo motor reprocessa o histórico, e seu checkpoint completo precisa coincidir exatamente com todas as projeções persistidas. Isso verifica placares, sessão, versão, identidades, fingerprints, acumulados, finalização e quarentena. Origem, sala, domínio, capacidade, catálogo e versão de regras não podem mudar silenciosamente.

Qualquer divergência bloqueia a continuidade; não há fallback para zero ou reparo automático. Uma instância que encontra `ScoringIntegrityError` fica bloqueada até ser fechada. Arquivo removido/substituído durante o uso também bloqueia a instância, por verificação de dispositivo/inode. Hard links não são aceitos.

Se a criação for interrompida antes da inicialização completa, o arquivo parcial será recusado em `resume`. `create` também recusa qualquer arquivo já existente. O operador deve preservar e investigar os dados antes de decidir explicitamente sobre uma nova disputa; não apagar um banco para contornar uma recuperação que falhou.

O digest detecta alterações acidentais e o replay verifica coerência lógica. Não são assinatura/autenticação contra um atacante capaz de reescrever integralmente banco e histórico, nem detectam a substituição de todo o armazenamento por uma cópia antiga coerente após todas as conexões fechadas. Isso exigiria um marco confiável externo, fora desta fase. Mudanças futuras nas regras exigem uma estratégia explícita de versão/migração; esquemas/regras desconhecidos são recusados.

## Concorrência e operação

Há um único escritor ativo por arquivo, imposto por SQLite. Conexões/processos adicionais só exercem autoridade através do mesmo coordenador e do mesmo arquivo canônico: cada comando adquire o lock antes de ler, reconstruir ou alterar estado. Nenhuma instância usa seu snapshot anterior como base de uma nova gravação. Timeout de lock: 5 segundos; `SQLITE_BUSY` é propagado sem aplicar o evento. Repetir depois deve preservar sua identidade.

Os testes exercitam três processos simultâneos, incluindo uma ocorrência compartilhada, sem perda de atualização ou duplicação. Isso não é coordenação entre arquivos diferentes: não criar cópias independentes da mesma disputa para pontuar em paralelo.

Usar disco local confiável e um único caminho canônico. Não usar compartilhamento de rede, sincronização de pastas ou cópias do arquivo aberto como mecanismo de replicação. Não remover ou substituir banco/WAL/SHM com conexões ativas. Para movimentar armazenamento, encerrar todos os coordenadores normalmente antes e preservar o conjunto consistente de arquivos SQLite; confirmar recuperação antes de qualquer continuidade. Backups/restauração automatizados não foram implementados.

## Uso interno e localização

O padrão é `~/.local/state/duelo-3d/scoring.sqlite`, fora do repositório/build. Caminhos alternativos devem ser absolutos e externos ao repositório, inclusive após resolver symlinks. Diretórios novos usam modo 0700 e o arquivo novo 0600 no Linux. Arquivos de banco, sidecars e backups também ficam no `.gitignore` como proteção adicional.

Não há nova variável de ambiente obrigatória ou `.env` por workspace. A configuração HTTP/WebSocket continua no `.env` opcional da raiz. Esta API não é chamada automaticamente por `npm run dev`, portanto não cria banco ao iniciar a arena.

```ts
import { openSqliteScoring } from './apps/backend/src/persistence/sqlite.ts';

const engine = {
    origin: 'offline',
    roomId: 'simulation-room',
    domain: 'simulation' as const,
    catalog: [], // nenhum ID real inventado
};

// Uma vez, para criar uma disputa nova; recusa arquivo existente.
const dispute = openSqliteScoring({ mode: 'create', engine });
try {
    const decision = dispute.process({
        origin: 'offline',
        roomId: 'simulation-room',
        domain: 'simulation',
        eventId: 'comment-1',
        type: 'comment',
        text: 'Lula',
    });
    // Publicar decision somente aqui: commit concluído.
    console.log(decision.state);
} finally {
    dispute.close();
}

// Após reinício, com exatamente a mesma configuração e caminho:
const recovered = openSqliteScoring({ mode: 'resume', engine });
try {
    console.log(recovered.snapshot());
} finally {
    recovered.close();
}
```

Para observação, usar arquivo distinto e `domain: 'observation'`. Seus eventos nunca pontuam. O domínio `real` continua recusado. Os campos de origem/domínio não autenticam eventos de rede; não expor esta API ao navegador. Não há endpoints novos de pontuação.

## Validação e limites

```bash
nvm use
npm ci
npm audit
npm run build
npm test
npm run check:media
npm run format:check
npm run dev

# Somente integração de persistência, a partir da raiz:
node --test apps/backend/tests/persistence.test.ts
```

Resultados executados: [validacao-scoring-persistence.md](validacao-scoring-persistence.md).

O adaptador é síncrono e reconstrói o histórico a cada operação para priorizar verificabilidade. O custo cresce com o histórico e pode bloquear o event loop; conflitos que alteram quarentena exigem comparações adicionais. Não há promessa de throughput de produção ou escalabilidade horizontal. A capacidade não é ampliada automaticamente. Não há outbox, entrega garantida de publicação, migração automática, administração externa ou integração TikTok. O frontend continua usando a sessão experimental em memória.
