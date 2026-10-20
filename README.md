# Duelo 3D

Frontend de uma enquete informal de entretenimento entre Lula e Flávio Bolsonaro. Não tem vínculo com votação eleitoral oficial nem constitui pesquisa representativa. Todos os votos são simulados localmente; o placar é perdido ao atualizar a página.

## Requisitos e execução

Use Node.js 24 ou superior e npm. A instalação precisa de acesso ao registro npm. Após a instalação, o frontend e seus vídeos não dependem de serviços externos.

```bash
npm ci
npm run dev
```

Abra o endereço mostrado no terminal (normalmente http://127.0.0.1:5173). Não abra o HTML diretamente com file://.

```bash
npm run build
npm run preview
npm test
npm run check:media
npm run format
npm run format:check
```

O build executa a checagem TypeScript e gera `dist/`, incluindo os vídeos. O preview serve esse build em http://127.0.0.1:4173. Os testes usam o executor nativo do Node e jsdom para o DOM; jsdom não reproduz vídeos.

O Prettier padroniza TypeScript, CSS, HTML, JSON e Markdown. Use `npm run format` para formatar os arquivos e `npm run format:check` para conferir a formatação. As regras estão em `.prettierrc.json`; arquivos gerados, o lockfile e vídeos são excluídos por `.prettierignore`, e os padrões do `.gitignore` também são respeitados.

## Arquitetura

| Caminho                        | Responsabilidade                                                               |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `src/core/score.ts`            | Estado inicial, votos, percentuais e liderança; funções sem dependência do DOM |
| `src/core/store.ts`            | Estado em memória, despacho de eventos e assinaturas                           |
| `src/config/participants.ts`   | Participantes, identificadores e catálogo das seis animações                   |
| `src/components/elements.ts`   | Referências obrigatórias da interface                                          |
| `src/components/render.ts`     | Apresentação do placar, barras e status                                        |
| `src/components/animations.ts` | Vídeos, salto CSS e timers                                                     |
| `src/events/simulation.ts`     | Botões manuais convertidos em eventos de voto/reset                            |
| `src/main.ts`                  | Composição dos módulos e limpeza no hot reload                                 |
| `src/styles/main.css`          | Arena responsiva, painéis neon e plataformas em perspectiva                    |
| `public/videos/`               | Seis WebM originais, sem conversão                                             |
| `tests/`                       | Regras, interação via DOM virtual e integridade das mídias                     |

O fluxo é: botão → evento → store/regras → renderização/animações. Um futuro adaptador poderá despachar eventos `vote` com `side` e `amount` pelo mesmo contrato, sem modificar os cálculos. Não há integração externa implementada. Valores de voto precisam ser inteiros positivos, com proteção do limite seguro do JavaScript.

## Comportamento da aplicação

- Lula e Flávio, seis vídeos WebM, placar individual e barra proporcional.
- Liderança, desvantagem e empate, inclusive status EMPATE no placar inicial.
- Voto manual +1, reset e animação CSS de salto.
- Sem votos, ambas as barras têm largura zero, como no JavaScript original.
- O voto dá prioridade ao vídeo de salto, que permanece em loop até outro evento de renderização, como no protótipo; a classe CSS de salto é retirada após 1,4 s.
- Reset também cancela os timers de salto e remove a classe imediatamente.
- Arena com painéis de nomes e pontuação no topo, barras individuais, plataformas iluminadas e controles responsivos. O salto CSS movimenta somente o vídeo do personagem. A nota de rodapé explicita a natureza informal da enquete.

Autoplay continua mudo e pode depender das políticas do navegador. Consulte `validacao.md` para distinguir testes automatizados de validação visual.

## Escopo e evolução

Vite e TypeScript organizam o frontend sem framework de interface ou backend. Não há TikTok, comentários, presentes, WebSockets, banco de dados ou persistência. A evolução poderá acrescentar adaptadores de entrada, revisão de acessibilidade e testes em navegador, mediante escopo próprio.

O ZIP original continua sendo a fonte de preservação dos backups e experimentos. Esses materiais não foram copiados para esta entrega. `.gitignore` exclui dependências, build, ambientes, arquivos Blender e diretórios experimentais.

Consulte `diagnostico.md`, `validacao.md` e `PUBLICAR-UBUNTU.md`.
