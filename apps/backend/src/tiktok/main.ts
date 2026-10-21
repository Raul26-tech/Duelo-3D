import { loadOptionalEnv } from '../environment.ts';
import { readDiagnosticConfig } from './config.ts';
import { createDiagnosticLogger, createEventObserver } from './diagnostics.ts';
import { createDiagnosticClient } from './client.ts';
import { createGiftReport, withGiftReport } from './gift-report.ts';
import { reserveLocalJson } from '../local-json.ts';

let reportFile: ReturnType<typeof reserveLocalJson> | undefined;

const logger = createDiagnosticLogger((line) => {
    // Avoid unbounded stdout buffering when a consumer is slow.
    if (process.stdout.writableLength < 65_536)
        process.stdout.write(`${line}\n`);
});
try {
    loadOptionalEnv();
    const config = readDiagnosticConfig();
    if (!config.enabled) logger.lifecycle('disabled', 0);
    else {
        const { createProviderFactory } = await import('./provider.ts');
        const report = process.env.TIKTOK_GIFT_REPORT
            ? createGiftReport()
            : undefined;
        if (report)
            reportFile = reserveLocalJson(process.env.TIKTOK_GIFT_REPORT!);
        const baseObserver = createEventObserver(logger);
        const observer = report
            ? withGiftReport(baseObserver, report)
            : baseObserver;
        const client = createDiagnosticClient({
            enabled: true,
            factory: await createProviderFactory(config),
            logger,
            observer,
        });
        const tick = setInterval(() => observer.tick(), 1000);
        const maximum = setTimeout(() => {
            void stop();
        }, 5 * 60_000);
        let stopping = false;
        async function stop() {
            if (stopping) return;
            stopping = true;
            clearInterval(tick);
            clearTimeout(maximum);
            const force = setTimeout(
                () =>
                    process.exit(
                        process.exitCode ? Number(process.exitCode) : 0,
                    ),
                3000,
            );
            force.unref();
            await client.stop();
            try {
                if (report) reportFile?.save(report.snapshot());
            } catch {
                process.stderr.write(
                    '{"category":"gift_report_write_failed","domain":"observation","scoringEligible":false}\n',
                );
                process.exitCode = 1;
            }
            if (
                [
                    'retry_exhausted',
                    'provider_failure',
                    'connect_timeout',
                    'cleanup_timeout',
                ].includes(client.reason() ?? '')
            )
                process.exitCode = 1;
        }
        process.on('SIGINT', () => {
            void stop();
        });
        process.on('SIGTERM', () => {
            void stop();
        });
        const monitor = setInterval(() => {
            if (client.state() === 'stopped') {
                if (
                    [
                        'retry_exhausted',
                        'provider_failure',
                        'connect_timeout',
                        'cleanup_timeout',
                    ].includes(client.reason() ?? '')
                )
                    process.exitCode = 1;
                clearInterval(monitor);
                void stop();
            }
        }, 250);
        monitor.unref();
        client.start();
    }
} catch {
    reportFile?.cancel();
    // Configuration/provider errors can contain credentials: never serialize their content.
    process.stderr.write(
        '{"category":"diagnostic_start_failed","domain":"observation","scoringEligible":false}\n',
    );
    process.exitCode = 1;
}
