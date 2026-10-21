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
    'catalog:gifts: list [reviews.json] | template --output /new/reviews.json | validate reviews.json | prepare reviews.json --output /new/active.json | verify reviews.json active.json';
export function runCatalogCli(
    args: string[],
    write: (line: string) => void = console.log,
) {
    const reference = loadReference();
    const [command, ...rest] = args;
    if (command === 'list' && rest.length <= 1) {
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
