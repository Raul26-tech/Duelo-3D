import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Only the isolated build output, never arbitrary filesystem paths or source files. */
export function loadHomologationArena() {
    const directory = fileURLToPath(
        new URL(
            '../../../../apps/frontend/homologation-dist/',
            import.meta.url,
        ),
    );
    const files = new Map<string, { type: string; data: Buffer }>();
    const read = (path: string, type: string) => {
        const filename = join(directory, path);
        if (!lstatSync(filename).isFile())
            throw new Error('Bundle isolado inválido');
        files.set('/' + path, { type, data: readFileSync(filename) });
    };
    if (!lstatSync(directory).isDirectory())
        throw new Error('Bundle isolado inválido');
    read('index.html', 'text/html; charset=utf-8');
    for (const sub of ['assets', 'videos']) {
        if (!lstatSync(join(directory, sub)).isDirectory())
            throw new Error('Bundle isolado inválido');
        for (const name of readdirSync(join(directory, sub))) {
            if (sub === 'assets' && /^[a-zA-Z0-9_.-]+\.(js|css)$/u.test(name))
                read(
                    sub + '/' + name,
                    name.endsWith('.js')
                        ? 'text/javascript; charset=utf-8'
                        : 'text/css; charset=utf-8',
                );
            if (sub === 'videos' && /^[a-zA-Z0-9_.-]+\.webm$/u.test(name))
                read(sub + '/' + name, 'video/webm');
        }
    }
    if (
        [...files.keys()].filter((path) => path.startsWith('/videos/'))
            .length !== 6 ||
        ![...files.keys()].some((path) => path.endsWith('.js'))
    )
        throw new Error('Build isolado incompleto');
    return (request: IncomingMessage, response: ServerResponse): boolean => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return false;
        const path = (request.url ?? '/').split('?')[0];
        const asset = files.get(path === '/' ? '/index.html' : path);
        if (!asset) return false;
        response.setHeader('Content-Type', asset.type);
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        );
        const length = asset.data.length;
        let start = 0,
            end = length - 1;
        if (request.headers.range) {
            const match = /^bytes=(\d*)-(\d*)$/u.exec(request.headers.range);
            if (match && (match[1] || match[2])) {
                start = match[1]
                    ? Number(match[1])
                    : Math.max(0, length - Number(match[2]));
                end =
                    match[1] && match[2]
                        ? Math.min(Number(match[2]), length - 1)
                        : length - 1;
            } else start = -1;
            if (
                !Number.isSafeInteger(start) ||
                !Number.isSafeInteger(end) ||
                start < 0 ||
                start > end ||
                start >= length
            ) {
                response.writeHead(416, {
                    'Content-Range': `bytes */${length}`,
                });
                response.end();
                return true;
            }
            response.setHeader(
                'Content-Range',
                `bytes ${start}-${end}/${length}`,
            );
        }
        response.setHeader('Accept-Ranges', 'bytes');
        response.setHeader('Content-Length', end - start + 1);
        response.writeHead(request.headers.range ? 206 : 200);
        response.end(
            request.method === 'HEAD'
                ? undefined
                : asset.data.subarray(start, end + 1),
        );
        return true;
    };
}
