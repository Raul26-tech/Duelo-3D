import {
    closeSync,
    lstatSync,
    openSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { resolveDatabasePath } from '../persistence/paths.ts';

/** Exclusive local operator lease. A crash leaves a lock and requires manual verification.
 * Never auto-delete stale locks: PID reuse or another machine must not grant authority.
 */
export function acquireAuthority(filename: string) {
    const database = resolveDatabasePath(filename, true);
    const path = database + '.authority.lock';
    const fd = openSync(path, 'wx', 0o600);
    writeFileSync(
        fd,
        JSON.stringify({
            pid: process.pid,
            startedAt: new Date().toISOString(),
        }) + '\n',
    );
    const identity = lstatSync(path, { bigint: true });
    let released = false;
    function assertHeld() {
        if (released) throw new Error('Authority lease released');
        const current = lstatSync(path, { bigint: true });
        if (current.dev !== identity.dev || current.ino !== identity.ino)
            throw new Error('Authority lock removed or replaced');
    }
    return Object.freeze({
        assertHeld,
        release() {
            if (released) return;
            // Never remove another operator's replacement lock.
            let held = false;
            try {
                assertHeld();
                held = true;
            } catch {
                /* Processing already fails closed. */
            }
            released = true;
            closeSync(fd);
            if (held) unlinkSync(path);
        },
    });
}
