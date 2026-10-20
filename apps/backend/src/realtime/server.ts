import { timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createSimulationSession } from './session.ts';
import { exact, identity, record, rejected, type ServerMessage } from './protocol.ts';

export type RealtimeConfig = { enabled: boolean; origin: string; token: string };
export function attachRealtime(server: Server, config: RealtimeConfig) {
    const session = createSimulationSession(config.enabled);
    const wss = new WebSocketServer({
        noServer: true, maxPayload: 4096, perMessageDeflate: false,
    });
    const authorized = new Set<WebSocket>();
    const alive = new Set<WebSocket>();
    const send = (ws: WebSocket, message: ServerMessage) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > 65536) { ws.terminate(); return; }
        ws.send(JSON.stringify(message), (error) => { if (error) ws.terminate(); });
    };
    // Função nomeada permite remover o listener sem afetar outros protocolos.
    function onUpgrade(
        request: import('node:http').IncomingMessage,
        socket: import('node:stream').Duplex,
        head: Buffer,
    ) {
        const remote = request.socket.remoteAddress;
        if (!config.enabled || request.url !== '/realtime' ||
            request.headers.origin !== config.origin || wss.clients.size >= 32 ||
            !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? '')) {
            socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            return;
        }
        socket.on('error', () => socket.destroy());
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws);
        });
    }
    server.on('upgrade', onUpgrade);
    wss.on('connection', (ws) => {
        alive.add(ws);
        const deadline = setTimeout(() => ws.terminate(), 5000);
        let windowStart = Date.now();
        let count = 0;
        ws.on('error', () => ws.terminate());
        ws.on('pong', () => alive.add(ws));
        ws.on('close', () => {
            clearTimeout(deadline); authorized.delete(ws); alive.delete(ws);
        });
        ws.on('message', (data, binary) => {
            if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); count = 0; }
            if (++count > 30) { ws.close(1008, 'RATE_LIMIT'); return; }
            if (binary) { send(ws, rejected(null, 'TEXT_REQUIRED')); return; }
            let value: unknown;
            try { value = JSON.parse(data.toString()); }
            catch { send(ws, rejected(null, 'INVALID_JSON')); return; }
            if (!authorized.has(ws)) {
                const valid = record(value) &&
                    exact(value, ['type', 'correlationId', 'token']) &&
                    value.type === 'simulation.authorize' &&
                    identity(value.correlationId) &&
                    typeof value.token === 'string' &&
                    /^[A-Za-z0-9_-]{32,128}$/.test(value.token);
                const token = record(value) && typeof value.token === 'string'
                    ? Buffer.from(value.token) : Buffer.alloc(0);
                const expected = Buffer.from(config.token);
                if (!valid || token.length !== expected.length ||
                    !timingSafeEqual(token, expected)) {
                    send(ws, rejected(record(value) && identity(value.correlationId) ? value.correlationId : null, 'UNAUTHORIZED'));
                    ws.close(1008, 'UNAUTHORIZED');
                    return;
                }
                authorized.add(ws); clearTimeout(deadline);
                send(ws, { type: 'state.snapshot', protocol: 1, state: session.snapshot() });
                return;
            }
            const result = session.execute(value, true);
            if (result.changed) {
                for (const client of authorized) send(client, result.message);
            } else send(ws, result.message);
        });
    });
    const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
            if (!alive.delete(ws)) { ws.terminate(); continue; }
            ws.ping();
        }
    }, 15000);
    heartbeat.unref();
    return {
        session,
        close() {
            clearInterval(heartbeat);
            server.off('upgrade', onUpgrade);
            for (const ws of wss.clients) ws.terminate();
            wss.close();
        },
    };
}
