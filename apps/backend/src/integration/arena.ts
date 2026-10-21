import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { Decision, Snapshot } from '../scoring/contracts.ts';

export function arenaSnapshot(state: Snapshot) {
    return {
        mode: 'real' as const,
        sessionId: state.sessionId,
        version: state.version,
        scores: { a: state.scores.lula, b: state.scores.flavio },
    };
}
/** View-only channel: no authorize, vote, reset or TikTok ingestion capability. */
export function attachRealArena(
    server: Server,
    origin: string,
    snapshot: () => Snapshot,
) {
    const wss = new WebSocketServer({
        noServer: true,
        maxPayload: 4096,
        perMessageDeflate: false,
    });
    const alive = new Set<WebSocket>();
    function send(ws: WebSocket, message: unknown) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > 65536) {
            ws.terminate();
            return;
        }
        ws.send(JSON.stringify(message), (error) => {
            if (error) ws.terminate();
        });
    }
    function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
        if (
            request.url !== '/arena' ||
            request.headers.origin !== origin ||
            wss.clients.size >= 32 ||
            !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
                request.socket.remoteAddress ?? '',
            )
        ) {
            socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            return;
        }
        socket.on('error', () => socket.destroy());
        wss.handleUpgrade(request, socket, head, (ws) =>
            wss.emit('connection', ws),
        );
    }
    server.on('upgrade', upgrade);
    wss.on('connection', (ws) => {
        alive.add(ws);
        ws.on('error', () => ws.terminate());
        ws.on('pong', () => alive.add(ws));
        ws.on('close', () => alive.delete(ws));
        ws.on('message', () => {
            send(ws, {
                type: 'command.rejected',
                correlationId: null,
                code: 'READ_ONLY_REAL_ARENA',
            });
            ws.close(1008, 'READ_ONLY_REAL_ARENA');
        });
        try {
            send(ws, {
                protocol: 1,
                type: 'state.snapshot',
                state: arenaSnapshot(snapshot()),
            });
        } catch {
            ws.close(1011, 'PERSISTENCE_UNAVAILABLE');
        }
    });
    const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
            if (!alive.delete(ws)) ws.terminate();
            else ws.ping();
        }
    }, 15000);
    heartbeat.unref();
    return {
        publish(decision: Decision) {
            if (
                decision.status !== 'applied' ||
                decision.state.domain !== 'real'
            )
                return;
            const message = {
                protocol: 1,
                type: 'state.updated',
                state: arenaSnapshot(decision.state),
                effect: {
                    kind: 'vote',
                    side: decision.candidate === 'lula' ? 'a' : 'b',
                },
            };
            for (const ws of wss.clients) send(ws, message);
        },
        disconnectViewers() {
            for (const ws of wss.clients) ws.terminate();
        },
        close() {
            clearInterval(heartbeat);
            server.off('upgrade', upgrade);
            for (const ws of wss.clients) ws.terminate();
            wss.close();
        },
    };
}
