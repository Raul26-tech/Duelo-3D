# Migração para npm workspaces

## Fonte de verdade e diagnóstico

Base: main em `2cdee325df80e6278855c2d3e5d94bab7e500e1b`, merge do PR #2 (`feat: Ajustando layout`). A raiz possuía frontend Vite/TypeScript, public/videos, nove testes, npm lock v3 e configuração Prettier. Node exigido: >=24.0.0. Não existia backend ou workspace.

O layout recente contém painéis neon, plataformas, indicadores visuais de liderança/empate e estilos responsivos de 800/520 px. Sua implementação foi preservada por reutilização dos blobs, incluindo HTML, CSS, renderização e teste DOM atualizado. O ZIP de origem não foi utilizado.

O manifesto de mídia estava obsoleto: os seis tamanhos nele registrados divergiam dos seis blobs publicados. O teste não poderia passar sua asserção de tamanho nesse estado. A migração corrige somente a referência de integridade e a forma de conferir o hash, tomando a main atual como origem.

## Movimentações

| Origem                                    | Destino                                    | Tratamento                                                                                    |
| ----------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| src/                                      | apps/frontend/src/                         | Mesmos blobs Git                                                                              |
| public/                                   | apps/frontend/public/                      | Mesma árvore Git, incluindo os seis WebM                                                      |
| index.html                                | apps/frontend/index.html                   | Mesmo blob Git                                                                                |
| tests/score.test.ts e tests/ui.test.ts    | apps/frontend/tests/                       | Mesmos blobs Git; oito cenários preservados sem edição                                        |
| tests/media.test.ts e media-manifest.json | apps/frontend/tests/                       | Mesmo cenário de integridade com referência corrigida para a main                             |
| tsconfig.json e vite.config.ts            | apps/frontend/                             | Mesmos blobs Git                                                                              |
| package.json                              | apps/frontend/package.json                 | Nome frontend; dependências de aplicação mantidas; Prettier e scripts globais na raiz         |
| package-lock.json                         | package-lock.json                          | Lock único v3 adaptado aos links dos workspaces; resoluções e integrities anteriores mantidas |
| README.md                                 | docs/historico/README-frontend.md          | Documento anterior preservado; novo README na raiz                                            |
| diagnostico.md                            | docs/historico/diagnostico-frontend.md     | Histórico preservado                                                                          |
| validacao.md                              | docs/historico/validacao-frontend.md       | Histórico preservado; não representa validação desta migração                                 |
| PUBLICAR-UBUNTU.md                        | docs/historico/PUBLICAR-FRONTEND-UBUNTU.md | Instruções antigas arquivadas                                                                 |
| .gitignore e .prettierrc.json             | Raiz                                       | Preservados sem edição                                                                        |
| .prettierignore                           | Raiz                                       | Caminho dos vídeos adaptado                                                                   |

A fundação adicionou o backend HTTP, testes e configurações sob apps/backend, scripts/dev.mjs e a documentação do monorepo. A configuração de ambiente foi posteriormente centralizada em /.env.example; os exemplos por workspace foram removidos, conforme correcoes-configuracao.md.

## Decisões

-   npm workspaces suficientes para duas aplicações. Nenhum workspace compartilhado vazio.
-   Dependências específicas declaradas no workspace consumidor. TypeScript/@types/node do backend têm as mesmas versões já presentes no frontend, permitindo o hoist pelo npm sem novas resoluções.
-   Prettier é ferramenta do repositório e fica na raiz.
-   Backend em ESM, HTTP nativo do Node e host fixo 127.0.0.1. Somente GET /health retorna 200; rotas/métodos restantes retornam 404.
-   Dev usa execução TypeScript nativa do Node >=24.15.0 na linha 24; build usa NodeNext e rewriteRelativeImportExtensions para produzir imports .js em dist.
-   BACKEND_PORT e BACKEND_HOST são validados antes de listen; frontend usa FRONTEND_PORT. Ambos localizam o .env opcional na raiz por caminhos de módulo, sem depender do cwd. Veja correcoes-configuracao.md para os detalhes atuais.
-   O teste HTTP usa porta efêmera no loopback para evitar conflito com a porta 3000.
-   Orquestração local via child_process, sem pacote adicional. Ctrl+C/terminação encerram os grupos de processos no Ubuntu; uma saída inesperada encerra o conjunto.
-   Eventos, regras e animações do frontend não dependem do novo backend.

## Publicação

Branch: chore/monorepo-foundation, baseada na main inspecionada. Commit descendente sem force push ou reescrita de histórico. Os movimentos reutilizam blobs/árvores Git existentes; renomes podem ser reconhecidos pelo GitHub no diff. A main não é alterada pela publicação desta branch.

As referências exatas dos seis vídeos e as limitações de execução estão no relatório de validação.
