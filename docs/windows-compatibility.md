# Compatibilidade Windows: correções e validação pendente

## Escopo e diagnóstico

Base: `main` em `015d46d3ba8475703a8d79a752f9eef898025172`, PR #12 integrado. Branch `fix/windows-compatibility`, inexistente antes desta tarefa. Os 281 aprovados/40 falhos/3 cancelados/1 ignorado relatados no notebook correspondem a uma execução interrompida, não a uma suíte completa.

| Causa identificada no código                                                                                                                                                      | Correção                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Helpers registravam `t.after(rmSync)` antes de `storage.close`/`runtime.close`; hooks são FIFO. Linux permite desvincular muitos arquivos abertos, mascarando a ordem inadequada. | Escopo de recursos LIFO compartilhado nos seis arquivos de testes envolvidos. Aguarda encerramentos assíncronos antes da remoção; erros são reunidos em `AggregateError`, sem silenciar falhas.                                        |
| `reserveLocalJson.cancel` tentava excluir antes de fechar seu próprio descritor.                                                                                                  | Fecha antes de excluir, preservando a verificação de identidade e a proibição de sobrescrita.                                                                                                                                          |
| Fechamento HTTP/WS não oferecia confirmação aguardável.                                                                                                                           | Administração retorna Promise; homologação, runtime, entrypoint e testes aguardam os encerramentos relevantes. SQLite/lease são liberados em `finally` no runtime. Sem alteração no protocolo WS.                                      |
| Configuração real exigia prefixo `/` em banco, manifesto e relatório.                                                                                                             | Validação nativa aceita unidades Windows, `C:\...` e `C:/...`, sem aceitar caminho relativo à unidade ou à raiz, UNC/dispositivo, ADS ou componentes reservados. Linux mantém caminhos absolutos nativos.                              |
| `.pathname` de URL não é caminho Windows; asserções usavam `/` literal; teste removia banco ativo sem considerar bloqueio do SO.                                                  | `fileURLToPath`, `join`/`relative`; verifica o bloqueio do Windows quando a remoção é negada, e a remoção após fechamento. Onde a remoção é permitida, mantém a verificação de bloqueio por identidade.                                |
| `spawnSync('npm')` depende da resolução de `.cmd`/shell no Windows.                                                                                                               | Subprocessos invocam `process.execPath` e o entrypoint JS do npm fornecido por `npm_execpath`.                                                                                                                                         |
| `chmod(0600)` não prova privacidade no Windows.                                                                                                                                   | Criação e leitura privadas usam DACL nativa, sem aceitar o modo POSIX emulado como autorização.                                                                                                                                        |
| `child.kill('SIGINT')` não reproduz Ctrl+C de console Windows; matar somente o watcher pode deixar filho executando.                                                              | Teste CLI usa `q` no Windows para encerramento gracioso; teste POSIX de grupo continua específico de Unix. Fixture descartável de `--watch` encerra a árvore Windows com `taskkill /T /F` e aguarda a saída antes de remover arquivos. |

Estas são causas verificadas por inspeção e regressões reproduzidas/testadas no Linux. Não foi recebido o relatório detalhado das 40 falhas do notebook; não se atribui automaticamente cada uma delas a uma causa única. A execução nativa Windows continua obrigatória.

## Arquivos privados e caminhos

- Linux: arquivos novos continuam `wx`/`0600`; leitura exige arquivo regular sem acesso de grupo/outros. Não há alteração de credenciais existentes.
- Windows: usa **Windows PowerShell 5.1** e .NET Framework presentes no Windows 10. Não requer dependência npm nem alteração permanente de Execution Policy. Executável nativo em `SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe`, sem profile, shell ou interpolação do caminho em código.
- O arquivo nasce por `FileStream`/`CreateNew` com DACL protegida, proprietário atual e FullControl apenas para o SID atual. Uma ACE explícita adicional para SYSTEM é aceita na leitura. Outros SIDs, herança, ACEs de negação ou falta de controle do proprietário fazem falhar com segurança. Não se tenta calcular permissões a partir de nomes de grupos/localização do Windows.
- ACLs incompatíveis **não são corrigidas automaticamente**. A CLI não sobrescreve arquivos. Não rode comandos de alteração de ACL nas credenciais privadas do operador para contornar erros; use arquivo de teste novo para homologação.
- A leitura de credenciais é limitada a 4096 bytes pelo mesmo descritor, com fechamento em `finally`, verificações de identidade/hard links/ACL antes e depois, e erro genérico para JSON malformado. Não registra conteúdo, senha, salt ou hash.
- Ancestrais por symlink/junction são recusados. No Windows também verifica o atributo nativo ReparsePoint. Use diretório local fora do checkout, sem OneDrive, compartilhamento, junction ou pasta sincronizada. Caminhos de rede e namespaces de dispositivo não são suportados para autoridade SQLite local.
- A homologação protege somente o diretório temporário que acabou de criar. Não aplica ACL/chmod em diretórios existentes do operador.
- O banco continua externo, com CreateNew exclusivo, comparação de identidade, WAL/FULL, transações, replay e contexto estritos. Nenhuma migração ou mudança de schema/eventos/regras/catálogo foi feita. Na identificação do arquivo usa `lstat` para não seguir um link substituto.
- O diretório operacional do SQLite precisa continuar sob controle do operador, inclusive WAL/SHM/lock. Esta correção não modifica ACLs de bancos/diretórios históricos. A política não protege contra administrador da máquina ou código executando como o próprio operador.

Referências técnicas: [limitações de chmod do Node](https://nodejs.org/docs/latest-v24.x/api/fs.html#fschmodpath-mode-callback), [FileStream com segurança na criação](https://learn.microsoft.com/en-us/dotnet/api/system.io.filestream.-ctor?view=netframework-4.8.1), [DACL protegida](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.objectsecurity.setaccessruleprotection?view=netframework-4.8.1).

## Atualizar e testar no notebook da Carine

Use um PowerShell novo e um **worktree limpo separado**. Isso mantém `.env`, catálogos, credenciais e bancos do checkout operacional intactos. Não execute `npm run dev` no checkout operacional durante esta validação.

```powershell
# No clone existente; primeiro conferir e preservar qualquer trabalho local.
git status --short
git fetch origin
# Se esse diretório já existir, escolha outro nome novo; não o apague automaticamente.
git worktree add --detach ..\Duelo-3D-windows-check origin/fix/windows-compatibility
Set-Location ..\Duelo-3D-windows-check
node --version
npm.cmd --version
```

Versão esperada no notebook: Node 24.22.0 e npm 11.19.1; mínimo do projeto permanece Node 24.15.0. Instale o Node oficial Windows com arquitetura correspondente ao notebook. Os testes usam `better-sqlite3` do backend; não substituem o adaptador pelo `node:sqlite`.

Verifique isolamento antes de qualquer execução. O teste não exige nem lê bancos históricos. Este bloco só recusa o ambiente, sem imprimir valores sensíveis ou remover configurações:

```powershell
$forbidden = Get-ChildItem Env: | Where-Object {
    $_.Name -match '^(TIKTOK_|ADMIN_|VITE_)' -or
    $_.Name -in @('DUEL_MODE','NODE_OPTIONS','FRONTEND_PORT','BACKEND_PORT','BACKEND_HOST')
}
if ($forbidden -or (Test-Path .env) -or $env:NODE_ENV -eq 'production') {
    throw 'Use terminal novo, sem configuracoes operacionais e worktree sem .env.'
}
```

Execute um comando por vez e confira `$LASTEXITCODE`. `npm.cmd` evita o wrapper `npm.ps1` em computadores com política de scripts restrita. Não é necessário desabilitar políticas do Windows.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run build:homologation
npm.cmd test
npm.cmd run check:media
npm.cmd run format:check
```

Para investigar sem iniciar LIVE: `npm.cmd test --workspace backend -- --test-name-pattern ...` não posiciona necessariamente flags antes do glob. Use diretamente, dentro de `apps/backend`, `node --test tests/windows-compatibility.test.ts` para a suíte específica (não depende do npm); para a suíte de homologação, rode via `npm.cmd test` para fornecer `npm_execpath`.

Registrar versão do SO/Node/npm, resumo completo de cada suíte, falhas e cancelamentos. O teste de sinais de **grupo POSIX** já era ignorado no Windows: sua ausência não comprova Ctrl+C Windows. Não acrescentamos exclusões. Os testes nativos de ACL/junction e os ramos Windows de subprocessos precisam ser executados no notebook; os testes de sintaxe `win32` no Linux não os substituem.

## Homologação visual isolada no Windows

No worktree limpo e terminal isolado acima, crie **uma nova credencial de teste**, fora do projeto. Nenhuma credencial operacional será carregada. Use uma senha exclusivamente de teste com 16–1024 caracteres, anotada de forma privada para o login. Não a coloque em argumentos, exemplos ou histórico.

```powershell
$testDirectory = Join-Path $env:LOCALAPPDATA ('Duelo3D-Test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDirectory | Out-Null
$testCredential = Join-Path $testDirectory 'credential.json'
$securePassword = Read-Host 'Senha exclusiva de homologacao' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$oldEncoding = $OutputEncoding
try {
    $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) |
        node .\apps\backend\src\admin\credential-cli.ts --operator carine-test --output $testCredential
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar credencial privada de teste.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    $OutputEncoding = $oldEncoding
    Remove-Variable securePassword, bstr -ErrorAction SilentlyContinue
}
npm.cmd run homologate:admin -- --isolated --credential $testCredential
```

A CLI existente cria a DACL antes de gravar o hash; o comando acima não escreve senha em disco. Não publique o arquivo gerado ou a senha. Não substitua o caminho pela credencial operacional.

- Painel: `http://127.0.0.2:3001/admin/`.
- Arena isolada: `http://127.0.0.1:5173/`.
- Banco: novo diretório temporário pertencente exclusivamente a essa execução, nunca `live-fase54-tuneldotempodjtim-01.sqlite`.
- Provedor sintético; nenhum TikTok, `.env` operacional ou catálogo privado. Não usar `ADMIN_ENABLED=true` para esta homologação.

Checklist manual: acesso negado sem login; login; lançamento Lula/Flávio pelas duas regras **sintéticas**; duplo envio sem pontos adicionais; justificativas/histórico; estorno sem estorno duplo; correção vinculada; arena atualizada; `r` + Enter mantém placar, histórico e sessão da disputa, exige novo login; logout. Finalizar uma execução com `q` + Enter e outra com **Ctrl+C real no console**, verificando remoção do diretório descartável mostrado e liberação das duas portas. A credencial externa permanece preservada.

```powershell
# Depois do encerramento, não deve haver listeners destas duas aplicações.
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @(5173,3001) }
```

Se houver listener, identifique o processo antes de qualquer ação: não mate processos alheios ou um serviço operacional. `Stop-Process`, `taskkill` e `child.kill('SIGINT')` não equivalem ao evento Ctrl+C gracioso do console. O teste programático Windows da CLI usa `q`; a conferência de Ctrl+C fica neste checklist nativo.

## Resultados e limites

A linha de base executada no Linux foi **348/348** (26 frontend + 322 backend), sem falhas, cancelamentos ou testes ignorados. Validação final no Linux, Node 24.15.0 / npm 11.9.0: `npm ci`, `npm audit` (zero vulnerabilidades reportadas), `npm run build`, `npm run build:homologation`, `npm test` (**361/361: 26 frontend + 335 backend**, sem falhas/cancelamentos/skips), `npm run check:media` (seis arquivos íntegros) e `npm run format:check` aprovados. Foram acrescentados 12 casos de teste e um subteste. Node 24.19.0 também foi usado na linha de base; Node 24.22.0/npm 11.19.1 Windows não foram executados aqui.

Este ambiente Work **não disponibiliza Windows**. Não foram executados PowerShell/ACL nativos, a suíte Windows, login visual no notebook, Ctrl+C Windows ou validação visual da arena. A compatibilidade Windows permanece **pendente de homologação nativa**, mesmo com build e testes Linux aprovados. Não confundir revisão estática, unit tests de `path.win32` e ramos Unix com aprovação Windows.

Os testes adicionados cobrem sintaxe Windows, caminhos com espaços/Unicode, criação exclusiva e cancelamento de arquivos, credenciais e ACL insegura/herdada (ramo nativo quando no Windows), aliases por hard link/junction, isolamento do repositório, teardown LIFO, rollback, recuperação/dedup e remoção após fechamento. Os testes anteriores continuam cobrindo login/logout/CSRF, lançamentos, correções/estornos, auditoria/replay legado e catálogo experimental.

Não houve conexão TikTok, LIVE, disputa operacional criada, alteração em `.env`, catálogo privado, credencial existente ou banco histórico. Os 14 presentes, políticas de entrega, manifestos e limite de 35 minutos foram preservados. Não houve migração de schema nem mudança em HTML, CSS, frontend, vídeos ou pontuação.
