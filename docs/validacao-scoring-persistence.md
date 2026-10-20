# Validação da Fase 4

Executada em Linux, com **Node.js 24.15.0** e **npm 11.9.0**. O executável Node 24.15.0 foi disponibilizado por `npm exec --package=node@24.15.0`; não foi adicionado às dependências do projeto. Não foram usadas APIs experimentais SQLite do Node.

## Resultados

| Comando/verificação    | Resultado executado                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| PR #5 e base remota    | Integrado; `main` em `67936e83c6c878ef60e3a393eccadf244894fa4b`                                                        |
| `npm ci`               | Aprovado com better-sqlite3 12.10.1; 102 pacotes instalados                                                            |
| `npm audit`            | Zero vulnerabilidades reportadas                                                                                       |
| `npm run build`        | Frontend, backend e tipagem dos testes aprovados                                                                       |
| `npm test`             | **107 aprovados, zero falhas**: 20 frontend e 87 backend                                                               |
| Regressão              | Todos os 74 testes preexistentes preservados e aprovados                                                               |
| Integração nova        | 33 testes de persistência/recuperação com SQLite real e bancos temporários                                             |
| `npm run check:media`  | Seis WebM conferidos pelos hashes e bytes do manifesto existente                                                       |
| `npm run format:check` | Aprovado                                                                                                               |
| `npm run dev`          | Frontend e backend iniciaram juntos, sem `.env`                                                                        |
| HTTP                   | Página frontend HTTP 200 e `/health` HTTP 200 com JSON esperado                                                        |
| SIGINT/Ctrl+C          | Ambos os serviços encerrados e portas 5173/3000 liberadas                                                              |
| Preservação            | Frontend, HTML/CSS, vídeos, renderização, animações, HTTP/WS, autorização e protocolos mantêm os blobs da base remota  |
| Dependências           | Nenhuma versão preexistente atualizada; somente biblioteca SQLite, tipos e suas dependências transitivas acrescentadas |

## Cobertura nova

Persistência de comentários/presentes, sessão e versão; combo pendente retomado e finalização única; fingerprints e contradições após reinício; quarentena mesmo sem mudança de placar/versão; não votos e presentes desconhecidos; IDs grandes e Unicode.

Rollback testado com trigger que aborta durante gravação e com FK diferida que falha no commit: histórico, identidades, sequências, digest e placares permanecem integralmente iguais ao estado anterior. O mesmo coordenador pode retentar após rollback sem memória divergente. Há teste de morte de um processo por SIGKILL durante uma transação não comitada.

Overflow por multiplicação e por total, capacidade saturada, falha de publicação após commit, duas conexões coordenadas e três processos simultâneos disputando o mesmo arquivo. A ocorrência compartilhada entre processos pontua uma única vez, sem perda de votos independentes.

Retomadas foram bloqueadas após alterar placar, versão, fingerprint, identidades, histórico, quantidade da sequência, origem, catálogo, versão de regras ou esquema; também após remover metadados. Há teste de digest recalculado com projeção logicamente divergente: o replay detecta a inconsistência. Bancos ausentes, vazios e fisicamente inválidos não geram placar zerado automaticamente.

Também foram verificados contexto/configuração incompatíveis, isolamento de observação/simulação, rejeição de domínio real, bloqueio de instância após falha de integridade ou remoção do arquivo, caminhos externos e uso da mesma cópia normalizada para motor e histórico.

Os bancos dos testes usam diretórios temporários com limpeza após encerramento. Nenhum arquivo de banco/WAL/SHM ou backup é publicado.

## Limitações e ocorrências

A primeira versão avaliada, better-sqlite3 13.0.3, carregou inicialmente, mas `npm ci` acionou uma compilação node-gyp que falhou por `fchown/EINVAL` no executor. Ela foi substituída por **12.10.1**, compatível com Node 24, cuja instalação limpa e validação completa passaram em Node 24.15.0. A falha da candidata não é apresentada como aprovação.

Na instalação selecionada houve aviso de depreciação da dependência transitiva `prebuild-install` e aviso de configuração `http-proxy` do ambiente. Nenhuma vulnerabilidade foi reportada pelo audit. Plataformas sem binário nativo compatível podem exigir compilador, Python e ferramentas de build; outras plataformas não foram testadas.

Não houve nova inspeção visual em navegador. A preservação foi verificada por identidade dos arquivos, build, testes UI existentes e HTTP. A conferência HTTP desta fase verificou página e health; integridade das mídias foi conferida pelo teste específico.

Não há integração persistente da arena, fonte externa ou votação real. Reconstrução e SQL são síncronos e seu custo cresce com o histórico; esta entrega não mede throughput de produção. Não foram simuladas todas as falhas possíveis de hardware ou sistema de arquivos. Digest/replay não autenticam um banco integralmente reescrito nem detectam restauração de uma cópia antiga coerente sem marco externo confiável. Não há migração, outbox, backup automatizado ou recuperação de desastre.

Política operacional e procedimento de retomada: [scoring-persistence.md](scoring-persistence.md).
