export const SCHEMA_VERSION = 1;
export const RULES_VERSION = 'scoring-v1';
export const APPLICATION_ID = 0x44334450;

export const SCHEMA = `
CREATE TABLE dispute (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    session_id TEXT NOT NULL UNIQUE,
    origin TEXT NOT NULL,
    room_id TEXT NOT NULL,
    domain TEXT NOT NULL CHECK (domain IN ('simulation', 'observation')),
    capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 10000),
    catalog_json TEXT NOT NULL CHECK (json_valid(catalog_json)),
    rules_version TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version BETWEEN 0 AND 9007199254740991),
    lula INTEGER NOT NULL CHECK (lula BETWEEN 0 AND 9007199254740991),
    flavio INTEGER NOT NULL CHECK (flavio BETWEEN 0 AND 9007199254740991),
    journal_count INTEGER NOT NULL CHECK (journal_count BETWEEN 0 AND 10000),
    digest TEXT NOT NULL CHECK (length(digest) = 64),
    CHECK (lula <= 9007199254740991 - flavio)
) STRICT;
CREATE TABLE journal (
    session_id TEXT NOT NULL REFERENCES dispute(session_id) DEFERRABLE INITIALLY DEFERRED,
    position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 10000),
    event_json TEXT NOT NULL CHECK (json_valid(event_json)),
    PRIMARY KEY (session_id, position)
) STRICT;
CREATE TABLE event_identities (
    session_id TEXT NOT NULL REFERENCES dispute(session_id) DEFERRABLE INITIALLY DEFERRED,
    identity TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    PRIMARY KEY (session_id, identity)
) STRICT;
CREATE TABLE gift_sequences (
    session_id TEXT NOT NULL REFERENCES dispute(session_id) DEFERRABLE INITIALLY DEFERRED,
    identity TEXT NOT NULL,
    gift_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 9007199254740991),
    final INTEGER NOT NULL CHECK (final IN (0, 1)),
    invalid INTEGER NOT NULL CHECK (invalid IN (0, 1)),
    PRIMARY KEY (session_id, identity)
) STRICT;
`;
