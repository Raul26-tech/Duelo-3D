# Publicar pelo terminal Ubuntu

O ZIP contém `Duelo-3D/` com o frontend completo, sem `.git`, dependências ou build. A branch remota `refactor/frontend-foundation` já existe. Use um clone novo para preservar trabalhos locais de outras tarefas. Não execute `git init`, não recrie main, não use force push.

Requisitos: Git, unzip, Node.js 24+ e npm. Para HTTPS, use a autenticação GitHub configurada no computador (por exemplo, `gh auth login` e `gh auth setup-git`, se possuir GitHub CLI). O GitHub não aceita a senha da conta como senha do Git; não coloque tokens nos arquivos do projeto ou na URL.

## 1. Extraia e clone em uma pasta nova

Ajuste somente o caminho do ZIP na primeira variável. Execute os comandos na mesma sessão do terminal:

```bash
arquivo_zip="$HOME/Downloads/duelo-3d-frontend-final.zip"
area_publicacao="$(mktemp -d "$HOME/duelo-3d-publicacao.XXXXXX")"
unzip "$arquivo_zip" -d "$area_publicacao/pacote"
git clone --branch refactor/frontend-foundation --single-branch \
  https://github.com/Raul26-tech/Duelo-3D.git "$area_publicacao/repo"
cd "$area_publicacao/repo"
git fetch origin
git pull --ff-only origin refactor/frontend-foundation
git status --short
git log --oneline -5
```

A conferência realizada em 19/10/2026 encontrou HEAD `00f64c530847339e5957456fb1a4f9a044e2837b` e nenhum arquivo na árvore. Antes de copiar, verifique:

```bash
git rev-parse HEAD
git ls-tree -r --name-only HEAD
```

Se a branch estiver em outro commit ou listar arquivos adicionados por outra tarefa, pare e compare-os com o pacote antes de copiar. Não sobreponha trabalho remoto novo sem revisar.

## 2. Copie, valide e revise

No estado vazio verificado acima:

```bash
cp -a "$area_publicacao/pacote/Duelo-3D/." .
npm ci
npm run build
npm test
git add .gitignore index.html package.json package-lock.json tsconfig.json vite.config.ts \
  src public/videos tests README.md diagnostico.md validacao.md PUBLICAR-UBUNTU.md
git diff --cached --stat
git diff --cached --name-only
git status --short
```

Confira que há exatamente seis WebM em `public/videos/` e que nenhum backup, `.env`, `node_modules`, `dist`, Blender ou experimento aparece na lista. O pacote final possui 30 arquivos. Não adicione arquivos do ZIP original. Para testar visualmente, execute `npm run dev`, abra o endereço informado e depois encerre com Ctrl+C.

## 3. Publique exclusivamente a branch

```bash
git branch --show-current
git commit -m "refactor: establish Vite TypeScript frontend foundation"
git push origin HEAD:refs/heads/refactor/frontend-foundation
```

O nome mostrado deve ser `refactor/frontend-foundation`. Não há comandos de escrita em main. Caso o push seja rejeitado porque a branch avançou, não force: execute `git fetch origin`, inspecione as alterações e resolva a integração antes de tentar novamente.

## 4. Abra o Pull Request, sem merge

Após o push, abra:

https://github.com/Raul26-tech/Duelo-3D/compare/main...refactor/frontend-foundation

Crie o PR com base `main` e compare `refactor/frontend-foundation`. Título sugerido: `refactor: fundação do frontend Duelo 3D com Vite e TypeScript`.

Na descrição informe: modularização de estado, participantes, pontuação, renderização, animações e eventos simulados; preservação do CSS e dos seis WebM; enquete informal; nove testes aprovados; instalação/build aprovados; HTTP 200 para página e vídeos; conferência visual pendente no ambiente de origem. Se conferir visualmente no seu computador, registre o resultado adicional. Mantenha o PR aberto, sem realizar merge.
