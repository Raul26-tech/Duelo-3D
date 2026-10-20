# Configuração central do monorepo

## Organização final

Arquivo local único: /.env, opcional e ignorado pelo Git.
Exemplo versionado único: /.env.example.

```dotenv
FRONTEND_PORT=5173
BACKEND_PORT=3000
BACKEND_HOST=127.0.0.1
```

Os exemplos antes localizados em apps/frontend e apps/backend foram removidos do versionamento. Nenhum arquivo .env real foi lido, publicado ou apagado nesta operação. Migre valores locais para a raiz e substitua PORT por BACKEND_PORT.

## Implementação

Backend: resolveRootEnvPath usa import.meta.url e ../../../.env. src e dist ficam à mesma profundidade. loadOptionalEnv usa a API nativa process.loadEnvFile, ignora somente ENOENT e mantém prioridade do terminal. O watcher recebe somente o entrypoint. Host validado por lista explícita: 127.0.0.1 ou ::1; a porta BACKEND_PORT deve ser um inteiro de 1 a 65535, padrão 3000. GET /health permanece com o mesmo contrato.

Frontend: root deriva da localização de vite.config.ts; envDir deriva de ../../ em relação ao mesmo módulo. loadEnv recebe esse diretório central e lê somente o prefixo FRONTEND_ para configurar a porta. server.host continua 127.0.0.1, strictPort true, base './'. Não houve alteração de envPrefix ou criação de define para expor valores ao cliente. Variáveis privadas não usam VITE_.

Vite mantém o suporte nativo a variantes de arquivo por modo na raiz. A configuração comum suportada pelos dois serviços é somente /.env: não use variantes para valores que precisam ser compartilhados, pois o backend carrega exclusivamente esse arquivo.

## Regressões corrigidas

- Arquivo opcional ausente não é registrado diretamente no watcher.
- Caminhos não dependem do cwd do npm ou do processo.
- Subprocessos de teste desativam cores com NO_COLOR=1 e remoção de FORCE_COLOR.
- Resultados de configuração são emitidos como JSON, sem comparar números coloridos.
- Os fixtures criam monorepos temporários e arquivos deliberadamente divergentes por workspace/cwd para confirmar que só a raiz é usada.
- Hosts públicos, curingas e nomes externos são rejeitados antes de listen.
- Testes incluem origens src/dist e processos --watch com/sem arquivo central.

## Formatação

Configurações JSON e recuos TypeScript foram ajustados de forma controlada. .prettierrc mantém as mesmas opções. docs/historico foi excluído explicitamente da formatação para preservar os arquivos arquivados. Vídeos e arquivos de layout não foram alterados.

Sem executor, não foi possível aplicar o Prettier real ou confirmar que os 20 apontamentos relatados foram todos eliminados. npm run format:check permanece como verificação pendente, sem esconder código ou configurações por meio de novas exclusões. Uma revisão local deve limitar qualquer formatação complementar aos arquivos apontados, sem alterar documentos históricos.

## Validação

Veja validacao-monorepo.md. As verificações por Node/npm não foram executadas nesta sessão. A revisão estática de caminhos, opções e preservação de arquivos não constitui aprovação dos testes ou do build.
