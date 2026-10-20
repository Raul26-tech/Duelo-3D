# Validação

Verificações executadas em 19/10/2026 no projeto já refatorado, sem reconstruí-lo após a interrupção da publicação.

| Verificação            | Resultado                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Node/npm               | Node 24.19.0; npm 11.9.0                                                                   |
| `npm ci`               | Aprovado; 59 pacotes instalados a partir do lockfile                                       |
| `npm run build`        | Aprovado; TypeScript sem erros e Vite 8.3.4 gerando dist                                   |
| `npm test`             | 9 testes aprovados, nenhum reprovado ou ignorado                                           |
| Inicialização          | Zero votos, empate, barras vazias                                                          |
| Votos                  | Incrementos independentes, estado anterior preservado                                      |
| Percentuais            | Proporções, zero votos e apenas um participante com votos                                  |
| Liderança/empate       | Ambos os líderes e empate positivo                                                         |
| Reset                  | Estado inicial e limpeza das classes de salto                                              |
| Entrada inválida       | Quantidade não positiva, fracionária, não finita, lado inválido e overflow rejeitados      |
| Store                  | Notificação, cópia de estado e remoção de assinatura                                       |
| Integração DOM virtual | Botões, placar, barras, textos, seleção de vídeos, reset e remoção de listeners            |
| Mídias                 | Seis nomes únicos; cabeçalho EBML, tamanho e SHA-256 iguais ao ZIP original                |
| CSS                    | Comparação byte a byte com o original aprovada                                             |
| HTTP do build          | Página e seis vídeos com status 200; MIME video/webm para as mídias e bytes iguais à fonte |

## Disponibilidade por HTTP

Servidor de preview Vite iniciado temporariamente em 127.0.0.1:4173 para conferir o build.

| Recurso                       | HTTP | Bytes   |
| ----------------------------- | ---- | ------- |
| `/`                           | 200  | 2084    |
| `/videos/flavio-feliz.webm`   | 200  | 7387321 |
| `/videos/flavio-pulando.webm` | 200  | 7375724 |
| `/videos/flavio-triste.webm`  | 200  | 6205774 |
| `/videos/lula-feliz.webm`     | 200  | 7394766 |
| `/videos/lula-pulando.webm`   | 200  | 6776912 |
| `/videos/lula-triste.webm`    | 200  | 7571982 |

## Limitações

O pacote Playwright está disponível no ambiente, mas o executável Chromium não está instalado; a tentativa de iniciar o navegador falhou por executável ausente. Não houve conferência visual, teste de reprodução/decodificação real dos vídeos ou avaliação responsiva em navegador. Os testes de DOM simulam pause/load/play e não substituem essa conferência. A preservação visual é sustentada pela estrutura e pelo CSS preservados, não por inspeção visual concluída.

Publicação GitHub incompleta: a branch existe, mas sua árvore está vazia após criar/remover o arquivo de teste. HEAD observado: `00f64c530847339e5957456fb1a4f9a044e2837b`. Main permanece `84014b762a2c19b9a3ea13d6d163c9306a78c275`. Não houve merge, nem criação de PR para o pacote ainda não publicado. Use `PUBLICAR-UBUNTU.md` para publicar.

## Conferência local recomendada

Execute `npm run dev`, abra no navegador e confira os dois participantes, votos alternados, liderança de cada lado, empate, reset e vídeos nos tamanhos desktop e celular. Depois de publicar, confirme também os seis vídeos no clone e repita os testes.
