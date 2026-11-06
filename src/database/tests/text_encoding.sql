BEGIN;

DO $test$
DECLARE
    probe CONSTANT TEXT := $probe$한글·日本語·café·é·🙂 | "쌍따옴표" '홑따옴표' | <script>alert('x')</script> & | '; DROP TABLE transfers; -- | 줄1
줄2	\끝$probe$;
    stored_label TEXT;
    stored_note TEXT;
BEGIN
    IF current_setting('server_encoding') <> 'UTF8'
       OR current_setting('client_encoding') <> 'UTF8' THEN
        RAISE EXCEPTION 'server and client encoding must both be UTF8';
    END IF;

    UPDATE dataset_addresses
    SET label = probe, note = probe
    WHERE (dataset_id, dataset_version, address) = (
        SELECT dataset_id, dataset_version, address
        FROM dataset_addresses
        ORDER BY dataset_id, dataset_version, address
        LIMIT 1
    )
    RETURNING label, note INTO stored_label, stored_note;
    IF NOT FOUND OR convert_to(stored_label, 'UTF8') <> convert_to(probe, 'UTF8')
                 OR convert_to(stored_note, 'UTF8') <> convert_to(probe, 'UTF8') THEN
        RAISE EXCEPTION 'dataset_addresses label/note encoding round trip failed';
    END IF;

    UPDATE blocks
    SET label = probe, note = probe
    WHERE (dataset_id, dataset_version, block_number) = (
        SELECT dataset_id, dataset_version, block_number
        FROM blocks
        ORDER BY dataset_id, dataset_version, block_number
        LIMIT 1
    )
    RETURNING label, note INTO stored_label, stored_note;
    IF NOT FOUND OR convert_to(stored_label, 'UTF8') <> convert_to(probe, 'UTF8')
                 OR convert_to(stored_note, 'UTF8') <> convert_to(probe, 'UTF8') THEN
        RAISE EXCEPTION 'blocks label/note encoding round trip failed';
    END IF;

    UPDATE transactions
    SET label = probe, note = probe
    WHERE (dataset_id, dataset_version, tx_hash) = (
        SELECT dataset_id, dataset_version, tx_hash
        FROM transactions
        ORDER BY dataset_id, dataset_version, tx_hash
        LIMIT 1
    )
    RETURNING label, note INTO stored_label, stored_note;
    IF NOT FOUND OR convert_to(stored_label, 'UTF8') <> convert_to(probe, 'UTF8')
                 OR convert_to(stored_note, 'UTF8') <> convert_to(probe, 'UTF8') THEN
        RAISE EXCEPTION 'transactions label/note encoding round trip failed';
    END IF;

    UPDATE transfers
    SET label = probe, note = probe
    WHERE transfer_id = (
        SELECT transfer_id
        FROM transfers
        ORDER BY transfer_id
        LIMIT 1
    )
    RETURNING label, note INTO stored_label, stored_note;
    IF NOT FOUND OR convert_to(stored_label, 'UTF8') <> convert_to(probe, 'UTF8')
                 OR convert_to(stored_note, 'UTF8') <> convert_to(probe, 'UTF8') THEN
        RAISE EXCEPTION 'transfers label/note encoding round trip failed';
    END IF;
END
$test$;

ROLLBACK;
