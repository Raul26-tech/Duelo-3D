import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { startAdministrationHomologation } from './homologation.ts';

export async function runHomologation(args = process.argv.slice(2)) {
    // No .env loader, main/dev entrypoint, SDK import or operational config reader.
    if (
        args.length !== 3 ||
        args[0] !== '--isolated' ||
        args[1] !== '--credential' ||
        !args[2]
    )
        throw new Error(
            'Uso: npm run homologate:admin -- --isolated --credential /caminho/credencial-de-teste.json',
        );
    let terminal: ReturnType<typeof createInterface> | undefined;
    let stopping: Promise<void> | undefined;
    let startup: ReturnType<typeof startAdministrationHomologation>;
    const removeSignals = () => {
        process.off('SIGINT', shutdown);
        process.off('SIGTERM', shutdown);
        process.off('SIGHUP', shutdown);
    };
    const shutdown = () => {
        stopping ??= (async () => {
            terminal?.close();
            try {
                const application = await startup;
                await application.close();
            } finally {
                // A paused pipe can still own an OS handle. Release the CLI's input
                // after closing the application; never force process.exit().
                if (!process.stdin.isTTY) process.stdin.destroy();
                removeSignals();
            }
        })();
        void stopping.catch(() => {
            console.error('Falha ao encerrar homologação');
            process.exitCode = 1;
        });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGHUP', shutdown);
    startup = startAdministrationHomologation({
        isolated: true,
        credentialFile: args[2],
    });
    let application: Awaited<typeof startup>;
    try {
        application = await startup;
    } catch (error) {
        removeSignals();
        throw error;
    }
    if (stopping) {
        await stopping;
        return;
    }
    terminal = createInterface({ input: process.stdin, terminal: false });
    terminal.on('line', (line) => {
        if (line.trim() === 'r')
            void application.recover().then(
                () =>
                    console.log(
                        'Recuperação concluída; autentique-se novamente.',
                    ),
                () => {
                    console.error(
                        'Recuperação bloqueada; homologação encerrada sem reinicializar o placar.',
                    );
                    shutdown();
                },
            );
        if (line.trim() === 'q') shutdown();
    });
    console.log(
        'HOMOLOGAÇÃO ISOLADA: provedor sintético; nenhum TikTok conectado.',
    );
    console.log(`Painel: ${application.administrationUrl}`);
    console.log(`Arena: ${application.arenaUrl}/`);
    console.log('Banco descartável: ' + application.directory);
    console.log(
        'r + Enter: recuperar a mesma disputa; q + Enter ou Ctrl+C: encerrar e remover o banco.',
    );
}
if (
    process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
    runHomologation().catch(() => {
        console.error(
            'Homologação não iniciada. Exige --isolated, --credential externo privado, build:homologation e ambiente sem configurações operacionais/preloads. Portas 5173 e 3001 devem estar livres.',
        );
        process.exitCode = 1;
    });
