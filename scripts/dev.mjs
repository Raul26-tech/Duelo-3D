import { spawn } from 'node:child_process';

// npm fornece seu próprio executável JS; não depende de shell ou pacote externo.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Execute este script usando npm run dev.');
const root = new URL('../', import.meta.url);
const grouped = process.platform !== 'win32';
const children = [];
let stopping = false;

function signalChild(child, signal) {
    if (!child.pid) return;
    try {
        // No Ubuntu, inclui npm, Vite, watcher e servidor no encerramento.
        if (grouped) process.kill(-child.pid, signal);
        else child.kill(signal);
    } catch (error) {
        if (error.code !== 'ESRCH') console.error(error);
    }
}
function stop(code) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) signalChild(child, 'SIGTERM');
    const timer = setTimeout(() => {
        for (const child of children) signalChild(child, 'SIGKILL');
    }, 4000);
    timer.unref();
}
process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));
for (const workspace of ['frontend', 'backend']) {
    const child = spawn(process.execPath, [
        npmCli, 'run', 'dev', '--workspace', workspace,
    ], { cwd: root, stdio: 'inherit', detached: grouped });
    children.push(child);
    child.on('error', (error) => {
        console.error(`Não foi possível iniciar ${workspace}:`, error.message);
        stop(1);
    });
    child.on('exit', (code, signal) => {
        if (!stopping) {
            console.error(`${workspace} encerrou (${signal ?? code}); encerrando o conjunto.`);
            stop(code || 1);
        }
    });
}
