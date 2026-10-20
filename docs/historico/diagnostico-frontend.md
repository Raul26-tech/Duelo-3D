# Diagnóstico do protótipo

## Fonte inspecionada

O arquivo efetivamente anexado foi `personagens-3d-teste.zip`, embora a descrição inicial citasse `(3)`. A aplicação principal está na raiz `personagens-3d-teste/`: `index.html`, `main.js`, `style.css` e seis arquivos em `videos/`. A refatoração usa somente essa aplicação e essas mídias.

## Problemas e decisões

1. Um único JavaScript misturava estado global, regras de pontuação, consultas ao DOM, eventos e vídeos. Separado em módulos TypeScript, com núcleo independente do navegador e store em memória.
2. Ausência de gerenciador de build, tipagem, lockfile e testes. Adicionados Vite, TypeScript estrito, npm e testes nativos do Node; jsdom cobre os botões sem alegar reprodução real de vídeo.
3. O `LEIA-ME.txt` descrevia câmera arrastável e Three.js, ausentes na aplicação principal atual. Substituído por documentação do frontend com vídeos.
4. Backups e estudos coexistiam com a aplicação: `backup-original/`, `animacao-personagens/`, `personagens-novos/`, Blender, Python e imagens. Permanecem no ZIP original e foram excluídos da entrega.
5. A variável global `leader` era atribuída sem uso posterior. Liderança agora é calculada por função pura.
6. Reset não cancelava os timers/classes do salto. Agora os cancela, sem alterar a sequência normal dos votos.
7. O tratamento de erro no elemento video podia não capturar falhas de source. O registro usa fase de captura, preservando a apresentação.
8. O texto não explicava expressamente que a enquete não é uma votação oficial ou pesquisa representativa. Ajustada somente a nota, mantendo o desenho.

## Compatibilidade deliberada

Barras vazias no zero, empate inicial e prioridade do vídeo de salto até o próximo voto são comportamentos do protótipo e foram mantidos. O CSS e os seis WebM são byte a byte iguais à fonte. Nenhuma mídia foi convertida; não foram inseridos modelos 3D.

## GitHub

A inspeção inicial encontrou apenas `main`, no commit vazio `84014b762a2c19b9a3ea13d6d163c9306a78c275`. Foi criada `refactor/frontend-foundation` a partir dessa base. O teste pequeno de escrita gerou `279146f0fc7a79a1fb8015a711880b7a5d17914e`; sua remoção gerou `00f64c530847339e5957456fb1a4f9a044e2837b`.

Após a interrupção dos envios Base64 solicitada pelo usuário, a branch foi inspecionada novamente: HEAD `00f64c5`, árvore vazia `4b825dc642cb6eb9a060e54bf8d69288fbee4904`, comparação com main sem arquivos alterados. Portanto, nenhum arquivo do frontend ou vídeo está publicado na branch. O arquivo temporário existe somente no histórico do teste, não no estado atual. A main não foi modificada.

A publicação de vídeos pelo conector foi interrompida diante do erro `Invalid conversation body` relatado pelo usuário. Nenhuma nova tentativa de envio foi realizada após a instrução de parada. A entrega é um ZIP para publicação por Git local, sem force push, reinicialização, merge ou PR de conteúdo incompleto.
