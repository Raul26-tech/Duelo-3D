import {
    readFileSync,
    statSync,
    openSync,
    closeSync,
    writeFileSync,
    fstatSync,
    lstatSync,
    unlinkSync,
    realpathSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repository = realpathSync(
    fileURLToPath(new URL('../../../', import.meta.url)),
);
export function readLocalJson(path: string): unknown {
    try {
        const stat = statSync(path);
        if (!stat.isFile() || stat.size > 65536) throw new Error();
        const data = readFileSync(path);
        if (data.length > 65536) throw new Error();
        return JSON.parse(data.toString('utf8'));
    } catch {
        throw new Error('Cannot read a regular JSON file of at most 64 KiB');
    }
}
/** Only new JSON files outside source/build. Existing catalogs are never overwritten. */
export function reserveLocalJson(path: string) {
    if (!isAbsolute(path) || !path.endsWith('.json'))
        throw new Error(
            'Output must be an absolute .json path outside the repository',
        );
    const filename = join(realpathSync(dirname(path)), basename(path));
    const child = relative(repository, filename);
    if (
        !child ||
        (!child.startsWith('..' + sep) && child !== '..' && !isAbsolute(child))
    )
        throw new Error('Output must be outside the repository and build');
    const fd = openSync(filename, 'wx', 0o600);
    const identity = fstatSync(fd, { bigint: true });
    let closed = false;
    const ownsPath = () => {
        try {
            const current = lstatSync(filename, { bigint: true });
            return current.dev === identity.dev && current.ino === identity.ino;
        } catch {
            return false;
        } // Removed/inaccessible output never grants permission to unlink another file.
    };
    return {
        save(value: unknown) {
            if (closed) throw new Error('Output already closed');
            try {
                const text = JSON.stringify(value, null, 4) + '\n';
                if (Buffer.byteLength(text) > 65536 || !ownsPath())
                    throw new Error('Output size or ownership invalid');
                writeFileSync(fd, text);
            } finally {
                closeSync(fd);
                closed = true;
            }
        },
        cancel() {
            if (closed) return;
            try {
                if (ownsPath()) unlinkSync(filename);
            } finally {
                closeSync(fd);
                closed = true;
            }
        },
    };
}
export function writeNewLocalJson(path: string, value: unknown) {
    const output = reserveLocalJson(path);
    try {
        output.save(value);
    } finally {
        output.cancel();
    }
}
