import { assertLocalPath } from '../private-files.ts';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
    sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

/** Source and compiled modules have the same depth below the repository root. */
const repository = realpathSync(
    fileURLToPath(new URL('../../../../', import.meta.url)),
);
export const defaultScoringDatabasePath = () =>
    join(homedir(), '.local', 'state', 'duelo-3d', 'scoring.sqlite');

export function resolveDatabasePath(filename: string, create: boolean): string {
    if (!isAbsolute(filename))
        throw new Error(
            'Scoring database path must be absolute and outside the repository',
        );
    assertLocalPath(filename);
    function canonical(path: string): string {
        if (existsSync(path)) return realpathSync(path);
        const parent = dirname(path);
        if (parent === path)
            throw new Error('Database drive/root is unavailable');
        return join(canonical(parent), basename(path));
    }
    const resolved = canonical(resolve(filename));
    const child = relative(repository, resolved);
    if (
        !child ||
        (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))
    )
        throw new Error(
            'Scoring database must be outside the repository and builds',
        );
    if (create) mkdirSync(dirname(resolved), { recursive: true, mode: 0o700 });
    return resolved;
}
