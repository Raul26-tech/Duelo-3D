# Validação — Fase 3

Ambiente de execução: Linux, Node.js **24.19.0**, npm **11.9.0**. A compatibilidade mínima declarada continua Node 24.15+ dentro da linha 24; esta entrega não foi executada especificamente em 24.15.0.

## Verificações executadas

| Verificação                     | Resultado                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `main` remota e PR #4           | PR integrado; base `1815c4c9aa0105bcd933dc304af9b232063b2e20`                                                                         |
| Trabalho local anterior         | Somente snapshots antigos do frontend; nenhum motor da Fase 3 identificado                                                            |
| `npm ci`                        | Aprovado, 64 pacotes instalados; lockfile preservado                                                                                  |
| `npm run build`                 | Aprovado nos dois workspaces, incluindo tipagem dos testes backend                                                                    |
| `npm test`                      | **70 aprovados, zero falhas**: 20 frontend e 50 backend                                                                               |
| Regressão                       | Os 38 testes existentes foram preservados; 32 testes novos do motor                                                                   |
| `npm run check:media`           | Aprovado; bytes e objetos Git dos seis WebM conferidos pelo manifesto                                                                 |
| `npm run format:check`          | Aprovado; formatação aplicada somente a arquivos desta entrega                                                                        |
| `npm run dev`, sem `.env`       | Frontend e backend iniciaram juntos nas portas padrão                                                                                 |
| Página frontend                 | HTTP 200 em `http://127.0.0.1:5173/`                                                                                                  |
| Health check                    | HTTP 200 e JSON esperado em `http://127.0.0.1:3000/health`                                                                            |
| Seis vídeos via HTTP            | HTTP 200 e conteúdo idêntico aos arquivos validados                                                                                   |
| Encerramento conjunto           | SIGINT, equivalente a Ctrl+C, encerrou o conjunto; portas 5173/3000 ficaram fechadas                                                  |
| Preservação do código publicado | Entre os arquivos existentes, somente README foi alterado; frontend, transporte, configurações e lockfile permanecem idênticos à base |

Os vídeos foram obtidos diretamente da revisão inspecionada para os testes. Não foram usados os vídeos de snapshots locais antigos, cujos hashes diferiam. A publicação mantém os objetos Git existentes, sem reenvio binário por Base64.

## Cobertura do motor

- Estado inicial, snapshots imutáveis, sessões independentes e versão monotônica.
- Caixa, acentos compostos/decompostos, palavras completas, ambos/nenhum candidato e comentários legítimos de texto igual.
- Todos os valores configuráveis de presente, lado único, catálogo vazio, configuração inválida e cópia defensiva.
- Identidade composta, normalização de IDs, inteiros grandes e rejeição de números inexatos.
- Retransmissão idempotente, identidade contraditória e registro de não votos/presentes desconhecidos.
- Soma de eventos independentes, ausência de pontos arbitrários e validação estrita de campos/tamanhos.
- Fonte/sala fixas, observação sem pontuação e rejeição de domínio real.
- Combos pendentes, finalização única, sequências independentes, notificação duplicada, conflito/quarentena e notificações atrasadas.
- Saturação sem evicção, overflow sem aplicação parcial e repetição após falha de publicação.

## Limitações

Não foi realizada nova conferência visual em navegador. A preservação visual desta alteração é sustentada pela identidade dos arquivos de frontend e pelas verificações automatizadas/HTTP; isso não equivale a inspeção visual.

Os testes do motor usam dados sintéticos e chamadas internas. Não demonstram recepção de comentários/presentes de qualquer plataforma. O motor não foi conectado à arena ou ao transporte nesta fase. O catálogo padrão permanece vazio e não há pontuação real habilitada.

Estado e deduplicação são voláteis. Reiniciar perde ambos; não há recuperação de disputa real. A política conservadora de combos pode bloquear sequências fora de ordem ou contraditórias. Não há correção automática de uma sequência que apresente contradição depois de já pontuada.

O npm emitiu aviso sobre uma configuração `http-proxy` do ambiente do executor. Não foi emitido `EBADENGINE` na instalação executada com Node 24.19.0. Não houve mudança de dependências para esta entrega.
