BEGIN;

CREATE TABLE assets (
    chain_id BIGINT NOT NULL,
    token_address TEXT NOT NULL,
    symbol TEXT NOT NULL,
    decimals SMALLINT NOT NULL,
    CONSTRAINT assets_pkey PRIMARY KEY (chain_id, token_address),
    CONSTRAINT assets_chain_id_positive CHECK (chain_id > 0),
    CONSTRAINT assets_token_address_format CHECK (token_address ~ '^0x[0-9a-f]{40}$'),
    CONSTRAINT assets_symbol_not_empty CHECK (btrim(symbol) <> ''),
    CONSTRAINT assets_decimals_range CHECK (decimals BETWEEN 0 AND 255)
);

CREATE TABLE datasets (
    dataset_id TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    source_mode TEXT NOT NULL,
    source_namespace TEXT NOT NULL,
    status TEXT NOT NULL,
    chain_id BIGINT NOT NULL,
    token_address TEXT NOT NULL,
    start_block BIGINT NOT NULL,
    end_block BIGINT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    finalized_block BIGINT,
    collected_at TIMESTAMPTZ,
    invalidation_reason TEXT,
    CONSTRAINT datasets_pkey PRIMARY KEY (dataset_id, dataset_version),
    CONSTRAINT datasets_asset_fkey
        FOREIGN KEY (chain_id, token_address)
        REFERENCES assets (chain_id, token_address),
    CONSTRAINT datasets_id_not_empty CHECK (btrim(dataset_id) <> ''),
    CONSTRAINT datasets_version_not_empty CHECK (btrim(dataset_version) <> ''),
    CONSTRAINT datasets_namespace_not_empty CHECK (btrim(source_namespace) <> ''),
    CONSTRAINT datasets_source_mode_valid CHECK (source_mode IN ('FIXTURE', 'SNAPSHOT')),
    CONSTRAINT datasets_status_valid
        CHECK (status IN ('COLLECTING', 'READY', 'FAILED', 'INVALIDATED')),
    CONSTRAINT datasets_block_range_valid
        CHECK (start_block >= 0 AND end_block >= start_block),
    CONSTRAINT datasets_time_range_valid CHECK (start_time <= end_time),
    CONSTRAINT datasets_finality_valid CHECK (
        (
            source_mode = 'SNAPSHOT'
            AND finalized_block IS NOT NULL
            AND finalized_block >= 0
            AND end_block <= finalized_block
        )
        OR (
            source_mode = 'FIXTURE'
            AND finalized_block IS NULL
        )
    ),
    CONSTRAINT datasets_ready_collected_at CHECK (
        status <> 'READY' OR collected_at IS NOT NULL
    ),
    CONSTRAINT datasets_invalidated_reason CHECK (
        status <> 'INVALIDATED'
        OR (invalidation_reason IS NOT NULL AND btrim(invalidation_reason) <> '')
    )
);

CREATE TABLE blocks (
    dataset_id TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    label TEXT,
    note TEXT,
    CONSTRAINT blocks_pkey PRIMARY KEY (dataset_id, dataset_version, block_number),
    CONSTRAINT blocks_dataset_fkey
        FOREIGN KEY (dataset_id, dataset_version)
        REFERENCES datasets (dataset_id, dataset_version),
    CONSTRAINT blocks_number_nonnegative CHECK (block_number >= 0),
    CONSTRAINT blocks_hash_format CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
    CONSTRAINT blocks_label_not_empty CHECK (label IS NULL OR btrim(label) <> ''),
    CONSTRAINT blocks_note_not_empty CHECK (note IS NULL OR btrim(note) <> '')
);

CREATE TABLE ingestion_chunks (
    chunk_id BIGINT GENERATED ALWAYS AS IDENTITY,
    dataset_id TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    start_block BIGINT NOT NULL,
    end_block BIGINT NOT NULL,
    CONSTRAINT ingestion_chunks_pkey PRIMARY KEY (chunk_id),
    CONSTRAINT ingestion_chunks_dataset_fkey
        FOREIGN KEY (dataset_id, dataset_version)
        REFERENCES datasets (dataset_id, dataset_version),
    CONSTRAINT ingestion_chunks_end_block_fkey
        FOREIGN KEY (dataset_id, dataset_version, end_block)
        REFERENCES blocks (dataset_id, dataset_version, block_number),
    CONSTRAINT ingestion_chunks_block_range_valid
        CHECK (start_block >= 0 AND end_block >= start_block)
);

CREATE TABLE transactions (
    dataset_id TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_index INTEGER NOT NULL,
    label TEXT,
    note TEXT,
    CONSTRAINT transactions_pkey PRIMARY KEY (dataset_id, dataset_version, tx_hash),
    CONSTRAINT transactions_dataset_fkey
        FOREIGN KEY (dataset_id, dataset_version)
        REFERENCES datasets (dataset_id, dataset_version),
    CONSTRAINT transactions_block_fkey
        FOREIGN KEY (dataset_id, dataset_version, block_number)
        REFERENCES blocks (dataset_id, dataset_version, block_number),
    CONSTRAINT transactions_position_unique
        UNIQUE (dataset_id, dataset_version, block_number, transaction_index),
    CONSTRAINT transactions_hash_format CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
    CONSTRAINT transactions_index_nonnegative CHECK (transaction_index >= 0),
    CONSTRAINT transactions_label_not_empty CHECK (label IS NULL OR btrim(label) <> ''),
    CONSTRAINT transactions_note_not_empty CHECK (note IS NULL OR btrim(note) <> '')
);

CREATE TABLE transfers (
    transfer_id TEXT NOT NULL,
    source_mode TEXT NOT NULL,
    fixture_namespace TEXT,
    fixture_record_id TEXT,
    chain_id BIGINT NOT NULL,
    token_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    amount_raw NUMERIC(78, 0) NOT NULL,
    label TEXT,
    note TEXT,
    CONSTRAINT transfers_pkey PRIMARY KEY (transfer_id),
    CONSTRAINT transfers_asset_fkey
        FOREIGN KEY (chain_id, token_address)
        REFERENCES assets (chain_id, token_address),
    CONSTRAINT transfers_source_mode_valid CHECK (source_mode IN ('FIXTURE', 'SNAPSHOT')),
    CONSTRAINT transfers_fixture_source_valid CHECK (
        (
            source_mode = 'FIXTURE'
            AND fixture_namespace IS NOT NULL
            AND btrim(fixture_namespace) <> ''
            AND fixture_record_id IS NOT NULL
            AND btrim(fixture_record_id) <> ''
        )
        OR (
            source_mode = 'SNAPSHOT'
            AND fixture_namespace IS NULL
            AND fixture_record_id IS NULL
        )
    ),
    CONSTRAINT transfers_tx_hash_format CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
    CONSTRAINT transfers_log_index_nonnegative CHECK (log_index >= 0),
    CONSTRAINT transfers_from_address_format CHECK (from_address ~ '^0x[0-9a-f]{40}$'),
    CONSTRAINT transfers_to_address_format CHECK (to_address ~ '^0x[0-9a-f]{40}$'),
    CONSTRAINT transfers_label_not_empty CHECK (label IS NULL OR btrim(label) <> ''),
    CONSTRAINT transfers_note_not_empty CHECK (note IS NULL OR btrim(note) <> ''),
    CONSTRAINT transfers_amount_uint256 CHECK (
        amount_raw >= 0
        AND amount_raw <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
    )
);

CREATE TABLE dataset_transfers (
    dataset_id TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    transfer_id TEXT NOT NULL,
    CONSTRAINT dataset_transfers_pkey
        PRIMARY KEY (dataset_id, dataset_version, transfer_id),
    CONSTRAINT dataset_transfers_dataset_fkey
        FOREIGN KEY (dataset_id, dataset_version)
        REFERENCES datasets (dataset_id, dataset_version),
    CONSTRAINT dataset_transfers_transfer_fkey
        FOREIGN KEY (transfer_id)
        REFERENCES transfers (transfer_id)
);

CREATE UNIQUE INDEX transfers_snapshot_source_unique
    ON transfers (chain_id, tx_hash, log_index)
    WHERE source_mode = 'SNAPSHOT';

CREATE UNIQUE INDEX transfers_fixture_source_unique
    ON transfers (fixture_namespace, fixture_record_id)
    WHERE source_mode = 'FIXTURE';

CREATE INDEX datasets_status_idx
    ON datasets (status, dataset_id, dataset_version);

CREATE INDEX datasets_asset_status_idx
    ON datasets (chain_id, token_address, status);

CREATE INDEX ingestion_chunks_position_idx
    ON ingestion_chunks (dataset_id, dataset_version, start_block);

CREATE INDEX transfers_tx_hash_idx
    ON transfers (chain_id, tx_hash);

CREATE INDEX transfers_from_address_idx
    ON transfers (chain_id, token_address, from_address);

CREATE INDEX transfers_to_address_idx
    ON transfers (chain_id, token_address, to_address);

CREATE INDEX dataset_transfers_transfer_idx
    ON dataset_transfers (transfer_id, dataset_id, dataset_version);

COMMIT;
