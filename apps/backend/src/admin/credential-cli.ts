import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { makeCredential } from './credentials.ts';
import { writeNewLocalJson } from '../local-json.ts';
export async function createCredentialFile(args: string[]) {
    if (
        args.length !== 4 ||
        args[0] !== '--operator' ||
        args[2] !== '--output' ||
        process.stdin.isTTY
    )
        throw new Error(
            'Use --operator NOME --output /caminho/novo.json, com senha pela entrada padrão (sem eco)',
        );
    process.stdin.setEncoding('utf8');
    let password = '';
    for await (const chunk of process.stdin) {
        password += chunk.toString();
        if (password.length > 1026) throw new Error('Senha muito longa');
    }
    password = password.replace(/\r?\n$/u, '');
    writeNewLocalJson(args[3], makeCredential(args[1], password));
    password = '';
    console.log('Credencial privada criada. Nenhum serviço foi habilitado.');
}
if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
    try {
        await createCredentialFile(process.argv.slice(2));
    } catch {
        process.stderr.write(
            'Não foi possível criar a credencial. Use senha de 16–1024 caracteres via stdin e arquivo novo fora do projeto.\n',
        );
        process.exitCode = 1;
    }
}
