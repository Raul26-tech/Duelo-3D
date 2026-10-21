import Database from 'better-sqlite3';
import { closeSync, openSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { EngineCheckpoint, ScoringEvent } from '../scoring/contracts.ts';
import { createScoringEngine, type EngineOptions } from '../scoring/engine.ts';
import { parseEvent } from '../scoring/validation.ts';
import { createScoringCoordinator } from './coordinator.ts';
import {
    ScoringIntegrityError,
    type ScoringStore,
    type ScoringTransaction,
    type StoredScoring,
} from './port.ts';
import {
    APPLICATION_ID,
    RULES_VERSION,
    SCHEMA,
    SCHEMA_VERSION,
} from './schema.ts';
import { defaultScoringDatabasePath, resolveDatabasePath } from './paths.ts';

type Metadata = {
    session_id: string;
    origin: string;
    room_id: string;
    source_policy?: string | null;
    domain: EngineCheckpoint['state']['domain'];
    capacity: number;
    catalog_json: string;
    rules_version: string;
    version: number;
    lula: number;
    flavio: number;
    journal_count: number;
    digest: string;
};
const digest = (data: StoredScoring) => {
    const { rulesVersion, ...legacyConfiguration } =
        data.checkpoint.configuration;
    // Preserve the exact v1 digest format; never rewrite historical decisions as v2.
    const checkpoint =
        rulesVersion === 'scoring-v1'
            ? { ...data.checkpoint, configuration: legacyConfiguration }
            : data.checkpoint;
    return createHash('sha256')
        .update(
            JSON.stringify({
                rules: rulesVersion,
                checkpoint,
                journal: data.journal,
            }),
        )
        .digest('hex');
};
const compareIdentity = (a: { identity: string }, b: { identity: string }) =>
    a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0;

class SqliteScoringStore implements ScoringStore {
    readonly db: Database.Database;
    private readonly filename: string;
    private readonly fileIdentity: string;
    constructor(filename: string, mode: 'create' | 'resume') {
        this.filename = filename;
        if (mode === 'create') closeSync(openSync(filename, 'wx', 0o600));
        this.fileIdentity = this.identifyFile();
        // Missing files in resume never create a replacement zero-score dispute.
        this.db = new Database(filename, {
            fileMustExist: true,
            timeout: 5000,
        });
        try {
            this.db.pragma('foreign_keys = ON');
            this.db.pragma('synchronous = FULL');
            if (mode === 'create') {
                this.db.pragma('journal_mode = WAL');
                this.db
                    .transaction(() => {
                        this.db.exec(SCHEMA);
                        this.db.pragma(`application_id = ${APPLICATION_ID}`);
                        this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
                    })
                    .immediate();
            }
            this.validateFile();
        } catch (error) {
            this.db.close();
            throw error;
        }
    }
    private identifyFile() {
        const stat = statSync(this.filename, { bigint: true });
        if (stat.nlink !== 1n)
            throw new ScoringIntegrityError(
                'database aliases/hard links are not supported',
            );
        return `${stat.dev}:${stat.ino}`;
    }
    private checkFileIdentity() {
        try {
            if (this.identifyFile() === this.fileIdentity) return;
        } catch {
            /* Fail closed below. */
        }
        throw new ScoringIntegrityError(
            'database file was removed or replaced',
        );
    }
    private validateFile() {
        if (
            this.db.pragma('application_id', { simple: true }) !==
                APPLICATION_ID ||
            ![1, SCHEMA_VERSION].includes(
                Number(this.db.pragma('user_version', { simple: true })),
            ) ||
            this.db.pragma('journal_mode', { simple: true }) !== 'wal' ||
            this.db.pragma('foreign_keys', { simple: true }) !== 1 ||
            this.db.pragma('integrity_check', { simple: true }) !== 'ok' ||
            (this.db.pragma('foreign_key_check') as unknown[]).length !== 0
        )
            throw new ScoringIntegrityError(
                'SQLite schema, file or foreign keys failed verification',
            );
    }
    private read(): StoredScoring {
        try {
            // Detect incomplete/foreign-context projections even if another connection ignored FKs.
            if (
                this.db.pragma('application_id', { simple: true }) !==
                    APPLICATION_ID ||
                ![1, SCHEMA_VERSION].includes(
                    Number(this.db.pragma('user_version', { simple: true })),
                ) ||
                (this.db.pragma('foreign_key_check') as unknown[]).length
            )
                throw new Error('foreign keys');
            const rows = this.db
                .prepare('SELECT * FROM dispute LIMIT 2')
                .all() as Metadata[];
            if (rows.length !== 1) throw new Error('missing dispute');
            const meta = rows[0];
            const rulesVersion = meta.rules_version;
            if (rulesVersion !== 'scoring-v1' && rulesVersion !== RULES_VERSION)
                throw new Error('unsupported rules version');
            const journalRows = this.db
                .prepare(
                    'SELECT session_id, position, event_json FROM journal ORDER BY position LIMIT 10001',
                )
                .all() as {
                session_id: string;
                position: number;
                event_json: string;
            }[];
            const eventRows = this.db
                .prepare(
                    'SELECT session_id, identity, fingerprint FROM event_identities LIMIT 10001',
                )
                .all() as {
                session_id: string;
                identity: string;
                fingerprint: string;
            }[];
            const sequenceRows = this.db
                .prepare('SELECT * FROM gift_sequences LIMIT 10001')
                .all() as {
                session_id: string;
                identity: string;
                gift_id: string;
                actor_id?: string | null;
                quantity: number;
                final: number;
                invalid: number;
            }[];
            if (
                journalRows.length > 10000 ||
                eventRows.length + sequenceRows.length > meta.capacity ||
                journalRows.length !== meta.journal_count ||
                [...journalRows, ...eventRows, ...sequenceRows].some(
                    (row) => row.session_id !== meta.session_id,
                )
            )
                throw new Error('incomplete history or context');
            const journal = journalRows.map((row, index) => {
                const event = parseEvent(JSON.parse(row.event_json));
                if (
                    row.position !== index + 1 ||
                    !event ||
                    JSON.stringify(event) !== row.event_json
                )
                    throw new Error('invalid journal');
                return event;
            });
            const checkpoint: EngineCheckpoint = {
                configuration: {
                    origin: meta.origin,
                    roomId: meta.room_id,
                    domain: meta.domain,
                    capacity: meta.capacity,
                    rulesVersion,
                    ...(meta.source_policy != null
                        ? { sourcePolicy: meta.source_policy }
                        : {}),
                    catalog: JSON.parse(meta.catalog_json),
                },
                state: {
                    sessionId: meta.session_id,
                    domain: meta.domain,
                    version: meta.version,
                    scores: { lula: meta.lula, flavio: meta.flavio },
                },
                events: eventRows
                    .map(({ identity, fingerprint }) => ({
                        identity,
                        fingerprint,
                    }))
                    .sort(compareIdentity),
                sequences: sequenceRows
                    .map((row) => ({
                        identity: row.identity,
                        ...(row.actor_id != null
                            ? { actorId: row.actor_id }
                            : {}),
                        giftId: row.gift_id,
                        quantity: row.quantity,
                        final: row.final === 1,
                        invalid: row.invalid === 1,
                    }))
                    .sort(compareIdentity),
            };
            const stored = { checkpoint, journal };
            if (digest(stored) !== meta.digest)
                throw new Error('digest mismatch');
            return stored;
        } catch (error) {
            throw new ScoringIntegrityError(
                `stored data invalid (${error instanceof Error ? error.message : 'unknown'})`,
            );
        }
    }
    private writeProjection(
        checkpoint: EngineCheckpoint,
        journal: readonly ScoringEvent[],
        initialize: boolean,
    ) {
        const { configuration: config, state } = checkpoint;
        if (initialize) {
            this.db
                .prepare(
                    `INSERT INTO dispute (singleton, session_id, origin, room_id, domain, capacity, catalog_json, rules_version, version, lula, flavio, journal_count, digest)
                VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    state.sessionId,
                    config.origin,
                    config.roomId,
                    config.domain,
                    config.capacity,
                    JSON.stringify(config.catalog),
                    config.rulesVersion,
                    state.version,
                    state.scores.lula,
                    state.scores.flavio,
                    journal.length,
                    digest({ checkpoint, journal }),
                );
            if (
                this.db.pragma('user_version', { simple: true }) ===
                SCHEMA_VERSION
            )
                this.db
                    .prepare('UPDATE dispute SET source_policy = ?')
                    .run(config.sourcePolicy ?? null);
        }
        this.db.prepare('DELETE FROM event_identities').run();
        const insertEvent = this.db.prepare(
            'INSERT INTO event_identities VALUES (?, ?, ?)',
        );
        for (const event of checkpoint.events)
            insertEvent.run(state.sessionId, event.identity, event.fingerprint);
        this.db.prepare('DELETE FROM gift_sequences').run();
        const modern =
            this.db.pragma('user_version', { simple: true }) === SCHEMA_VERSION;
        const insertSequence = this.db.prepare(
            modern
                ? 'INSERT INTO gift_sequences (session_id, identity, gift_id, quantity, final, invalid, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
                : 'INSERT INTO gift_sequences VALUES (?, ?, ?, ?, ?, ?)',
        );
        for (const sequence of checkpoint.sequences)
            insertSequence.run(
                state.sessionId,
                sequence.identity,
                sequence.giftId,
                sequence.quantity,
                Number(sequence.final),
                Number(sequence.invalid),
                ...(modern ? [sequence.actorId ?? null] : []),
            );
        if (!initialize)
            this.db
                .prepare(
                    `UPDATE dispute SET version = ?, lula = ?, flavio = ?, journal_count = ?, digest = ? WHERE singleton = 1`,
                )
                .run(
                    state.version,
                    state.scores.lula,
                    state.scores.flavio,
                    journal.length,
                    digest({ checkpoint, journal }),
                );
    }
    transaction<T>(work: (tx: ScoringTransaction) => T): T {
        this.checkFileIdentity();
        const result = this.db
            .transaction(() =>
                work({
                    load: () => this.read(),
                    initialize: (checkpoint) => {
                        for (const table of [
                            'dispute',
                            'journal',
                            'event_identities',
                            'gift_sequences',
                        ]) {
                            if (
                                (
                                    this.db
                                        .prepare(
                                            `SELECT COUNT(*) AS n FROM ${table}`,
                                        )
                                        .get() as { n: number }
                                ).n !== 0
                            )
                                throw new ScoringIntegrityError(
                                    'refusing to initialize existing data',
                                );
                        }
                        this.writeProjection(checkpoint, [], true);
                    },
                    append: (event, checkpoint) => {
                        const previous = this.read();
                        const journal = [...previous.journal, event];
                        this.db
                            .prepare('INSERT INTO journal VALUES (?, ?, ?)')
                            .run(
                                checkpoint.state.sessionId,
                                journal.length,
                                JSON.stringify(event),
                            );
                        this.writeProjection(checkpoint, journal, false);
                    },
                }),
            )
            .immediate();
        this.checkFileIdentity();
        return result;
    }
    close() {
        if (this.db.open) this.db.close();
    }
}

export function openSqliteScoring(options: {
    filename?: string;
    mode: 'create' | 'resume';
    engine: EngineOptions;
}) {
    if (options.mode !== 'create' && options.mode !== 'resume')
        throw new Error('Specify create or resume explicitly');
    // Validate before touching the filesystem; the coordinator also freezes validated configuration.
    const configuration = createScoringEngine(options.engine).checkpoint()
        .configuration;
    const filename = resolveDatabasePath(
        options.filename ?? defaultScoringDatabasePath(),
        options.mode === 'create',
    );
    const store = new SqliteScoringStore(filename, options.mode);
    try {
        return createScoringCoordinator(
            store,
            {
                ...configuration,
                // Omitted means adopt the persisted version on resume, not force current rules.
                rulesVersion: options.engine.rulesVersion,
                catalog: configuration.catalog,
                ...(options.engine.enableRealScoring
                    ? { enableRealScoring: true as const }
                    : {}),
            },
            options.mode,
        );
    } catch (error) {
        store.close();
        throw error;
    }
}
