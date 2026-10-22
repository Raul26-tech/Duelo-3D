import {
    experimentTemplate,
    experimentStatus,
    prepareExperiment,
    parseExperimentManifest,
} from './experiment.ts';
import { catalogStatus, prepareExtension } from './phase56.ts';
import { assessGiftEvidence, assessRuntimeEvidence } from './evidence.ts';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    loadReference,
    parseReviews,
    pendingReview,
    prepareActive,
    reviewTemplate,
    verifyActive,
} from './catalog.ts';
import { readLocalJson, writeNewLocalJson } from '../local-json.ts';

const usage =
    'catalog:gifts: list [reviews.json] | template --output /new/reviews.json | validate reviews.json | prepare reviews.json --output /new/active.json | verify reviews.json active.json | status [active.json] | assess report.json --output /new/assessment.json | extend active.json full-reviews.json --output /new/active.json | experiment-template active.json --output /new/plan.json | experiment-status plan.json | experiment-prepare active.json plan.json --output /new/manifest.json | experiment-verify manifest.json';
export function runCatalogCli(
    args: string[],
    write: (line: string) => void = console.log,
) {
    const reference = loadReference();
    const [command, ...rest] = args;
    if (
        command === 'experiment-template' &&
        rest.length === 3 &&
        rest[1] === '--output'
    ) {
        writeNewLocalJson(rest[2], experimentTemplate(readLocalJson(rest[0])));
        write('Pending experimental plan created; zero new gifts authorized.');
    } else if (command === 'experiment-status' && rest.length === 1) {
        write(
            JSON.stringify(experimentStatus(readLocalJson(rest[0])), null, 4),
        );
    } else if (
        command === 'experiment-prepare' &&
        rest.length === 4 &&
        rest[2] === '--output'
    ) {
        writeNewLocalJson(
            rest[3],
            prepareExperiment(readLocalJson(rest[1]), readLocalJson(rest[0])),
        );
        write(
            'New experimental-only manifest prepared. Not a production catalog; no dispute or environment changed.',
        );
    } else if (command === 'experiment-verify' && rest.length === 1) {
        const result = parseExperimentManifest(readLocalJson(rest[0]));
        write(
            JSON.stringify({
                valid: true,
                rules: result.manifest.rules.length,
                purpose: result.manifest.purpose,
                productionValidated: false,
            }),
        );
    } else if (command === 'status' && rest.length <= 1) {
        write(
            JSON.stringify(
                catalogStatus(
                    reference,
                    rest.length ? readLocalJson(rest[0]) : undefined,
                ),
                null,
                4,
            ),
        );
    } else if (
        command === 'assess' &&
        rest.length === 3 &&
        rest[1] === '--output'
    ) {
        const evidence = readLocalJson(rest[0]);
        const runtime =
            evidence !== null &&
            typeof evidence === 'object' &&
            'schema' in evidence &&
            evidence.schema === 'real-runtime-report-v1';
        writeNewLocalJson(
            rest[2],
            runtime
                ? assessRuntimeEvidence(reference, evidence)
                : assessGiftEvidence(reference, evidence),
        );
        write('Observation assessment created; zero authorizations granted.');
    } else if (
        command === 'extend' &&
        rest.length === 4 &&
        rest[2] === '--output'
    ) {
        const active = prepareExtension(
            reference,
            readLocalJson(rest[0]),
            readLocalJson(rest[1]),
        );
        writeNewLocalJson(rest[3], active);
        write(
            `New candidate catalog created: ${active.length} explicitly reviewed rules; existing rules preserved. No environment or dispute modified.`,
        );
    } else if (command === 'list' && rest.length <= 1) {
        const reviews = rest.length
            ? parseReviews(readLocalJson(rest[0]), reference)
            : reviewTemplate(reference);
        write(
            JSON.stringify(
                reference.map((entry) => {
                    const review = reviews.find(
                        (item) => item.giftId === entry.giftId,
                    );
                    const pending = pendingReview(entry, review);
                    return {
                        ...entry,
                        reviewedDelivery: review?.delivery ?? null,
                        operatorApproved: review?.operatorApproved ?? false,
                        eligible: pending.length === 0,
                        pending,
                    };
                }),
                null,
                4,
            ),
        );
    } else if (
        command === 'template' &&
        rest.length === 2 &&
        rest[0] === '--output'
    ) {
        writeNewLocalJson(rest[1], reviewTemplate(reference));
        write('Pending review template created; zero gifts authorized.');
    } else if (command === 'validate' && rest.length === 1) {
        const reviews = readLocalJson(rest[0]);
        const active = prepareActive(reference, reviews);
        write(
            JSON.stringify({
                valid: true,
                authorized: active.length,
                pending: reference.length - active.length,
            }),
        );
    } else if (
        command === 'prepare' &&
        rest.length === 3 &&
        rest[1] === '--output'
    ) {
        const active = prepareActive(reference, readLocalJson(rest[0]));
        writeNewLocalJson(rest[2], active);
        write(
            `New operational catalog created: ${active.length} authorized gifts. No dispute or environment modified.`,
        );
    } else if (command === 'verify' && rest.length === 2) {
        const active = verifyActive(
            reference,
            readLocalJson(rest[0]),
            readLocalJson(rest[1]),
        );
        write(JSON.stringify({ valid: true, authorized: active.length }));
    } else throw new Error(usage);
}
if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
    try {
        runCatalogCli(process.argv.slice(2));
    } catch (error) {
        // Only our validated review reasons are public. Filesystem errors may contain private paths.
        const message =
            error instanceof Error && !('code' in error)
                ? error.message
                : 'Cannot create or access a new local catalog file';
        process.stderr.write(message + '\n');
        process.exitCode = 1;
    }
}
