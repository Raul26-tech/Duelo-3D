# Revisar a branch no Ubuntu

A migração é publicada por objetos Git existentes e arquivos de texto. Não é necessário reenviar vídeos por conectores nem usar o ZIP do protótipo.

Use um clone novo para preservar alterações locais de outras tarefas:

```bash
git clone --branch chore/monorepo-foundation --single-branch https://github.com/Raul26-tech/Duelo-3D.git Duelo-3D-monorepo
cd Duelo-3D-monorepo
node --version
npm --version
npm ci
npm run build
npm test
npm run dev
```

Node precisa ser 24+ e npm 11+. Os endereços padrão são http://127.0.0.1:5173 e http://127.0.0.1:3000/health. Veja validacao-monorepo.md para conferir os vídeos e o build em produção.

Se precisar corrigir algo após testar, faça commit somente na branch de trabalho:

```bash
git branch --show-current
git status --short
git diff
# Adicione explicitamente os arquivos revisados:
git add CAMINHOS_DOS_ARQUIVOS
git diff --cached
git commit -m "fix: validate monorepo foundation"
git push origin HEAD:refs/heads/chore/monorepo-foundation
```

Não inclua .env, node_modules, dist, backups ou experimentos. Não faça force push nem escreva diretamente em main. Se o push for rejeitado, faça fetch e inspecione as alterações remotas antes de integrar.

O PR deve ter base main e compare chore/monorepo-foundation e permanecer aberto para revisão. Não faça merge sem aprovação.
