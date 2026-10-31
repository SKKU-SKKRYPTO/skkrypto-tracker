BEGIN;

DELETE FROM dataset_transfers
WHERE (dataset_id, dataset_version) IN (
    ('collecting-demo', 'v1'),
    ('flow-demo', 'v1'),
    ('invalidated-demo', 'v1'),
    ('patterns-demo', 'v1')
);

DELETE FROM transfers transfer
WHERE (
        transfer.transfer_id LIKE 'fx:flow-demo-v1:%'
        OR transfer.transfer_id LIKE 'fx:patterns-demo-v1:%'
    )
  AND NOT EXISTS (
      SELECT 1
      FROM dataset_transfers dataset_transfer
      WHERE dataset_transfer.transfer_id = transfer.transfer_id
  );

DELETE FROM transactions
WHERE (dataset_id, dataset_version) IN (
    ('collecting-demo', 'v1'),
    ('flow-demo', 'v1'),
    ('invalidated-demo', 'v1'),
    ('patterns-demo', 'v1')
);

DELETE FROM ingestion_chunks
WHERE (dataset_id, dataset_version) IN (
    ('collecting-demo', 'v1'),
    ('flow-demo', 'v1'),
    ('invalidated-demo', 'v1'),
    ('patterns-demo', 'v1')
);

DELETE FROM blocks
WHERE (dataset_id, dataset_version) IN (
    ('collecting-demo', 'v1'),
    ('flow-demo', 'v1'),
    ('invalidated-demo', 'v1'),
    ('patterns-demo', 'v1')
);

DELETE FROM datasets
WHERE (dataset_id, dataset_version) IN (
    ('collecting-demo', 'v1'),
    ('flow-demo', 'v1'),
    ('invalidated-demo', 'v1'),
    ('patterns-demo', 'v1')
);

DELETE FROM assets asset
WHERE asset.chain_id = 84532
  AND asset.token_address = '0x0000000000000000000000000000000000001000'
  AND NOT EXISTS (
      SELECT 1
      FROM datasets dataset
      WHERE dataset.chain_id = asset.chain_id
        AND dataset.token_address = asset.token_address
  )
  AND NOT EXISTS (
      SELECT 1
      FROM transfers transfer
      WHERE transfer.chain_id = asset.chain_id
        AND transfer.token_address = asset.token_address
  );

COMMIT;
