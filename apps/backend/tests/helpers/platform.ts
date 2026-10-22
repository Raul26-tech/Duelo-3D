import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Invoke npm's JS entrypoint, never npm.cmd through a shell. */
export function npmArguments(args: string[]): string[] {
    const cli = process.env.npm_execpath;
    if (cli) return [cli, ...args];
    const fallback = join(
        dirname(process.execPath),
        'node_modules',
        'npm',
        'bin',
        'npm-cli.js',
    );
    if (existsSync(fallback)) return [fallback, ...args];
    throw new Error('Run these tests through npm test (npm_execpath required)');
}
/** Deliberately insecure synthetic fixture, to prove ACL checks fail closed. */
export function makePublicFixture(path: string) {
    if (process.platform !== 'win32') {
        chmodSync(path, 0o644);
        return;
    }
    execFileSync(
        join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'),
        [path, '/grant', '*S-1-1-0:(R)'],
        { stdio: 'ignore', windowsHide: true },
    );
}
