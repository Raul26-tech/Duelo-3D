# Validação da migração para monorepo

## Estado da sessão

Não há ambiente de execução utilizável nesta sessão. A tentativa de acessar o executor retornou: "No usable execution environment is available". Não foi possível instalar pacotes, executar Node/npm, iniciar servidores ou abrir um navegador. A validação visual local relatada pelo usuário pertence ao frontend antes desta migração.

| Verificação | Estado desta entrega |
| --- | --- |
| Inspeção main e último layout | Realizada via integração GitHub |
| Preservação HTML/CSS/src/configurações frontend | Conferência estática por identidade dos objetos Git |
| Preservação dos seis vídeos | Mesmos hashes Git e tamanhos da main |
| Nove cenários frontend | Mantidos; execução pendente |
| Health check | Um teste implementado; execução pendente |
| package-lock v3 | Estrutura de workspaces revisada; dependências/resoluções existentes preservadas; npm ci pendente |
| npm ci | Não executado |
| npm run build | Não executado |
| npm test | Não executado; esperado: nove cenários frontend e um backend |
| npm run dev e encerramento conjunto | Não executados |
| HTTP frontend/backend e seis WebM | Não executado |
| Conferência visual/responsiva | Não realizada |
| Alteração visual intencional | Nenhuma; blobs visuais preservados |

## Mídias da main de origem

| Arquivo | Bytes | SHA do blob Git |
| --- | --- | --- |
| flavio-feliz.webm | 11369128 | `d9ec3a0f06e4d858083a6201bb26c662aef0e2e3` |
| flavio-pulando.webm | 8075207 | `a4318905f60394fd96cfc56843bec32f764e3137` |
| flavio-triste.webm | 8968264 | `84c812bc00cdb8c328df03780b4f3dbf5764cdef` |
| lula-feliz.webm | 11862570 | `035896a08fda46824698209f74f2f8cd640141e7` |
| lula-pulando.webm | 7228610 | `a30f08b6ab6c46da86712bb14b8a6041db74ed8c` |
| lula-triste.webm | 13146419 | `c11b7a48e12f6a9d88bf5d9a9d69b26dc6a03ecc` |

O catálogo possui seis arquivos. Os mesmos objetos foram referenciados em apps/frontend/public/videos, sem baixar/regravar ou reenviar seu conteúdo. O manifesto antigo registrava outros tamanhos e SHA-256; foi substituído por tamanhos e SHA dos blobs atuais. O teste calcula o SHA-1 com o cabeçalho de objeto Git e verifica nome, quantidade, tamanho, assinatura EBML e conteúdo completo. Não requer Git instalado ou rede.

## Conferência a executar num clone

```bash
node --version
npm --version
npm ci
npm run build
npm test
npm run check:media
npm run dev
```

Em outro terminal:

```bash
curl --fail http://127.0.0.1:3000/health
curl --fail --output /dev/null http://127.0.0.1:5173/
for nome in flavio-feliz flavio-pulando flavio-triste lula-feliz lula-pulando lula-triste; do
  curl --fail --output /dev/null "http://127.0.0.1:5173/videos/$nome.webm" || break
done
```

Confirme a resposta exata do health check, a página e os seis vídeos. Confira em navegador votos dos dois lados, liderança/empate, barras individuais, reset, troca de vídeos e responsividade no layout atual. Encerre o dev com Ctrl+C e confirme que as portas foram liberadas.

Depois de encerrar o dev, confira o build de produção:

```bash
npm run preview --workspace frontend
# Outro terminal:
curl --fail --output /dev/null http://127.0.0.1:4173/
for nome in flavio-feliz flavio-pulando flavio-triste lula-feliz lula-pulando lula-triste; do
  curl --fail --output /dev/null "http://127.0.0.1:4173/videos/$nome.webm" || break
done
```

Para o backend compilado: `npm start --workspace backend`, seguido de `curl --fail http://127.0.0.1:3000/health` em outro terminal. Registre os resultados antes do merge; esta documentação não afirma que verificações pendentes passaram.
