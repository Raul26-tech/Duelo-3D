import { assertPrivateFile, readPrivateFile } from '../private-files.ts';
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { statSync, realpathSync } from 'node:fs';
import { relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { record, exact } from '../scoring/validation.ts';
export type Credential = Readonly<{
    version: 1;
    operator: string;
    salt: string;
    hash: string;
}>;
const parameters = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
export function makeCredential(operator: string, password: string): Credential {
    if (
        !/^[a-zA-Z0-9_.-]{3,64}$/u.test(operator) ||
        password.length < 16 ||
        password.length > 1024
    )
        throw new Error(
            'Operador inválido ou senha fora do intervalo 16–1024 caracteres',
        );
    const salt = randomBytes(32).toString('hex');
    return Object.freeze({
        version: 1,
        operator,
        salt,
        hash: scryptSync(password, salt, 64, parameters).toString('hex'),
    });
}
export function readCredential(path: string): Credential {
    assertPrivateFile(path);
    const resolved = realpathSync(path);
    const repository = fileURLToPath(new URL('../../../../', import.meta.url));
    const child = relative(repository, resolved);
    const stat = statSync(resolved);
    if (
        !isAbsolute(path) ||
        !child ||
        (!child.startsWith('..' + sep) &&
            child !== '..' &&
            !isAbsolute(child)) ||
        !stat.isFile() ||
        stat.size > 4096
    )
        throw new Error(
            'Credencial deve estar fora do projeto, em arquivo privado (0600 no Unix; ACL restrita no Windows)',
        );
    const data = readPrivateFile(path, 4096);
    let value: unknown;
    try {
        value = JSON.parse(data.toString('utf8'));
    } catch {
        throw new Error('Credencial inválida');
    }
    if (
        !record(value) ||
        !exact(value, ['version', 'operator', 'salt', 'hash']) ||
        value.version !== 1 ||
        typeof value.operator !== 'string' ||
        !/^[a-zA-Z0-9_.-]{3,64}$/u.test(value.operator) ||
        typeof value.salt !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(value.salt) ||
        typeof value.hash !== 'string' ||
        !/^[a-f0-9]{128}$/u.test(value.hash)
    )
        throw new Error('Credencial inválida');
    return Object.freeze({ ...value }) as Credential;
}
export function verifyCredential(
    credential: Credential,
    operator: unknown,
    password: unknown,
): Promise<boolean> {
    if (
        typeof operator !== 'string' ||
        typeof password !== 'string' ||
        password.length > 1024
    )
        return Promise.resolve(false);
    return new Promise((resolve, reject) =>
        scrypt(password, credential.salt, 64, parameters, (error, key) =>
            error
                ? reject(error)
                : resolve(
                      timingSafeEqual(
                          key,
                          Buffer.from(credential.hash, 'hex'),
                      ) && operator === credential.operator,
                  ),
        ),
    );
}
