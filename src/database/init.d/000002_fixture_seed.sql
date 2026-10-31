BEGIN;

-- api-server/testdata/fixtures의 공개 개발 Fixture 4개를 적재한다.
-- Fixture에는 RPC finality가 없으므로 datasets.finalized_block은 NULL로 둔다.
-- Dataset labels/notes와 transferType은 현재 DB에 별도 컬럼이 없거나
-- from_address/to_address에서 계산하므로 저장하지 않는다.

INSERT INTO assets (chain_id, token_address, symbol, decimals)
VALUES (
    84532,
    '0x0000000000000000000000000000000000001000',
    'SKK',
    2
)
ON CONFLICT (chain_id, token_address) DO NOTHING;

INSERT INTO datasets (
    dataset_id,
    dataset_version,
    source_mode,
    source_namespace,
    status,
    chain_id,
    token_address,
    start_block,
    end_block,
    start_time,
    end_time,
    finalized_block,
    collected_at,
    invalidation_reason
)
VALUES
    (
        'collecting-demo', 'v1', 'FIXTURE', 'collecting-demo-v1', 'COLLECTING',
        84532, '0x0000000000000000000000000000000000001000',
        18204211, 18206309,
        '2026-10-26T11:50:04Z', '2026-10-26T13:00:00Z',
        NULL, '2026-10-26T13:05:00Z', NULL
    ),
    (
        'flow-demo', 'v1', 'FIXTURE', 'flow-demo-v1', 'READY',
        84532, '0x0000000000000000000000000000000000001000',
        18204211, 18206309,
        '2026-10-26T11:50:04Z', '2026-10-26T13:00:00Z',
        NULL, '2026-10-26T13:05:00Z', NULL
    ),
    (
        'invalidated-demo', 'v1', 'FIXTURE', 'invalidated-demo-v1', 'INVALIDATED',
        84532, '0x0000000000000000000000000000000000001000',
        18204211, 18206309,
        '2026-10-26T11:50:04Z', '2026-10-26T13:00:00Z',
        NULL, '2026-10-26T13:05:00Z',
        '경계 블록 해시가 바뀌어 다시 수집해야 합니다.'
    ),
    (
        'patterns-demo', 'v1', 'FIXTURE', 'patterns-demo-v1', 'READY',
        84532, '0x0000000000000000000000000000000000001000',
        20000, 20100,
        '2026-10-26T13:50:00Z', '2026-10-26T14:30:00Z',
        NULL, '2026-10-26T14:35:00Z', NULL
    )
ON CONFLICT (dataset_id, dataset_version) DO NOTHING;

INSERT INTO blocks (
    dataset_id,
    dataset_version,
    block_number,
    block_hash,
    block_time,
    label,
    note
)
VALUES
    ('collecting-demo', 'v1', 18204211, '0xfdd7101ff957f79a9dcad8506ffd684c1846129bf2ced00853aff3813508ab73', '2026-10-26T11:50:04Z', NULL, NULL),
    ('collecting-demo', 'v1', 18206309, '0x9d5e7c47448997aa8e8d08416c21d21d7009b5f613b5e5ff510422342eb0779b', '2026-10-26T13:00:00Z', NULL, NULL),

    ('flow-demo', 'v1', 18204211, '0x00c72a31b632d1a0fa1d326bad617f0b26df2ec7cd9d69b6e214ae6ec48360fd', '2026-10-26T11:50:04Z', NULL, NULL),
    ('flow-demo', 'v1', 18204511, '0x8fe8b1f5695d5b5b2755b6ce5a0289a2be1ef6f9598074c44334658e7b0c0d11', '2026-10-26T12:00:04Z', NULL, NULL),
    ('flow-demo', 'v1', 18204566, '0x0907a9f62ae09c9739c67f3661cbf2b8e6772c11966a0abc57c13088e5d6c21b', '2026-10-26T12:01:54Z', NULL, NULL),
    ('flow-demo', 'v1', 18204782, '0x9a8152206a9399e4d8aa534975c9c13d495e8e8e1524354b41a5ea537794c70f', '2026-10-26T12:09:06Z', NULL, NULL),
    ('flow-demo', 'v1', 18205040, '0x6d15b8cdf71b0d33e870997805b9ad194ff1e75ee1841f21cf13ab443884f8b3', '2026-10-26T12:17:42Z', NULL, NULL),
    ('flow-demo', 'v1', 18205103, '0x55bf924fa8b11757f5603e1452038843a4ee252363a8395c52e5961a30b97873', '2026-10-26T12:19:48Z', NULL, NULL),
    ('flow-demo', 'v1', 18205410, '0xfc14980ba80eb655ff464c81a7290d048e5684905c6987fd00fdbe26a54b9610', '2026-10-26T12:30:02Z', NULL, NULL),
    ('flow-demo', 'v1', 18205900, '0xbc4615c11261f7a80a117c17b9be8a7c91a51b8200611d8d1de644bf951eebc2', '2026-10-26T12:46:22Z', NULL, NULL),
    ('flow-demo', 'v1', 18206300, '0x206158beab8793b8111c9a83e757bb55aff54006e60bc75c8cc383520c88267c', '2026-10-26T12:59:42Z', NULL, NULL),
    ('flow-demo', 'v1', 18206309, '0x2b196e94e2de23b37305ede63e785e5fe8f229efc157e11022d8d5cb0b6c7903', '2026-10-26T13:00:00Z', NULL, NULL),

    ('invalidated-demo', 'v1', 18204211, '0x1781ce3c77ebee8c31366f5dc28e3507b4e9aeab519a23f19520b7995b58d764', '2026-10-26T11:50:04Z', NULL, NULL),
    ('invalidated-demo', 'v1', 18206309, '0x0a6e6da4912404a555bc9d4040cc871093212719a6db43acf1df934ebf9c5fc8', '2026-10-26T13:00:00Z', NULL, NULL),

    ('patterns-demo', 'v1', 20000, '0x94e5b3caeacf1d8830423a29dbfc88e128015a044c0da5cb997acfa4d247d978', '2026-10-26T13:50:00Z', NULL, NULL),
    ('patterns-demo', 'v1', 20001, '0xe2d606ec8fe8528a1ec8dbbc5dd9ed8c51ecfe8a8efa4d30a050fd5a995a6055', '2026-10-26T14:00:00Z', NULL, NULL),
    ('patterns-demo', 'v1', 20002, '0x9e8c31ac63d32264a779f0dd3605d66147d690be19ddb101bd8c35824baf1ee6', '2026-10-26T14:03:20Z', NULL, NULL),
    ('patterns-demo', 'v1', 20003, '0xe94dc1f1140f89174d55e9df47ffaa4be74a7f0df3e48cd93242372dc20482e4', '2026-10-26T14:09:59Z', NULL, NULL),
    ('patterns-demo', 'v1', 20004, '0xf5a340893d1999303604e7a499c0c070c9c08bcc06494f9cc208af57411cc41e', '2026-10-26T14:10:00Z', NULL, NULL),
    ('patterns-demo', 'v1', 20005, '0xbca6af3548b79fccf5b225ccc07dfbba23a8ad51e0f18b559f18adee90157f96', '2026-10-26T14:12:00Z', NULL, NULL),
    ('patterns-demo', 'v1', 20007, '0x64b360a952f7a4898bec6c4a734fe78883e59d1039aefd54ea0840475b6982eb', '2026-10-26T14:20:00Z', NULL, NULL),
    ('patterns-demo', 'v1', 20008, '0xd57e4e431b3e8649edc8453947936791b81a68a7a79df0c5e9f5c97a6b33d81a', '2026-10-26T14:21:00Z', NULL, NULL),
    ('patterns-demo', 'v1', 20009, '0x4a9c66c97079f4a34e8d2f679dfa60344d4f2a27cb4172a8d7d5c332848e16d1', '2026-10-26T14:22:00Z', NULL, NULL),
    ('patterns-demo', 'v1', 20010, '0xa701d85f6eac3beb0a55eda1fcb3a7af1c773b5c21cd8650455346abdbbd5427', '2026-10-26T14:23:00Z', NULL, NULL),
    ('patterns-demo', 'v1', 20100, '0xe28ad07bf5874f4b8f9bd5eb8db5c3b239e9f55ec629315199ee60336a4e02d2', '2026-10-26T14:30:00Z', NULL, NULL)
ON CONFLICT (dataset_id, dataset_version, block_number) DO NOTHING;

INSERT INTO ingestion_chunks (dataset_id, dataset_version, start_block, end_block)
SELECT seed.dataset_id, seed.dataset_version, seed.start_block, seed.end_block
FROM (
    VALUES
        ('flow-demo', 'v1', 18204211::BIGINT, 18206309::BIGINT),
        ('invalidated-demo', 'v1', 18204211::BIGINT, 18206309::BIGINT),
        ('patterns-demo', 'v1', 20000::BIGINT, 20100::BIGINT)
) AS seed(dataset_id, dataset_version, start_block, end_block)
WHERE NOT EXISTS (
    SELECT 1
    FROM ingestion_chunks existing
    WHERE existing.dataset_id = seed.dataset_id
      AND existing.dataset_version = seed.dataset_version
      AND existing.start_block = seed.start_block
      AND existing.end_block = seed.end_block
);

INSERT INTO transactions (
    dataset_id,
    dataset_version,
    tx_hash,
    block_number,
    transaction_index,
    label,
    note
)
VALUES
    ('flow-demo', 'v1', '0x0000000000000000000000000000000000000000000000000000000000000001', 18204511, 3, NULL, NULL),
    ('flow-demo', 'v1', '0x0000000000000000000000000000000000000000000000000000000000000002', 18204566, 1, NULL, NULL),
    ('flow-demo', 'v1', '0x0000000000000000000000000000000000000000000000000000000000000003', 18204782, 0, NULL, NULL),
    ('flow-demo', 'v1', '0x0000000000000000000000000000000000000000000000000000000000000004', 18205040, 5, NULL, NULL),
    ('flow-demo', 'v1', '0x0000000000000000000000000000000000000000000000000000000000000005', 18205103, 2, NULL, NULL),
    ('flow-demo', 'v1', '0x0000000000000000000000000000000000000000000000000000000000000006', 18205900, 4, NULL, NULL),
    ('flow-demo', 'v1', '0x0000000000000000000000000000000000000000000000000000000000000007', 18206300, 1, NULL, NULL),
    ('flow-demo', 'v1', '0x0000000000000000000000000000000000000000000000000000000000000008', 18205410, 7, NULL, NULL),

    ('patterns-demo', 'v1', '0x00000000000000000000000000000000000000000000000000000000000003e9', 20001, 0, NULL, NULL),
    ('patterns-demo', 'v1', '0x00000000000000000000000000000000000000000000000000000000000003ea', 20002, 0, NULL, NULL),
    ('patterns-demo', 'v1', '0x00000000000000000000000000000000000000000000000000000000000003eb', 20003, 0, NULL, NULL),
    ('patterns-demo', 'v1', '0x00000000000000000000000000000000000000000000000000000000000003ec', 20004, 0, NULL, NULL),
    ('patterns-demo', 'v1', '0x00000000000000000000000000000000000000000000000000000000000003ed', 20005, 0, NULL, NULL),
    ('patterns-demo', 'v1', '0x00000000000000000000000000000000000000000000000000000000000003ef', 20007, 0, NULL, NULL),
    ('patterns-demo', 'v1', '0x00000000000000000000000000000000000000000000000000000000000003f0', 20008, 0, NULL, NULL),
    ('patterns-demo', 'v1', '0x00000000000000000000000000000000000000000000000000000000000003f1', 20009, 0, NULL, NULL),
    ('patterns-demo', 'v1', '0x00000000000000000000000000000000000000000000000000000000000003f2', 20010, 0, NULL, NULL)
ON CONFLICT DO NOTHING;

INSERT INTO transfers (
    transfer_id,
    source_mode,
    fixture_namespace,
    fixture_record_id,
    chain_id,
    token_address,
    tx_hash,
    log_index,
    from_address,
    to_address,
    amount_raw,
    label,
    note
)
VALUES
    (
        'fx:flow-demo-v1:e1', 'FIXTURE', 'flow-demo-v1', 'e1',
        84532, '0x0000000000000000000000000000000000001000',
        '0x0000000000000000000000000000000000000000000000000000000000000001', 0,
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
        '120000', 'e1', NULL
    ),
    (
        'fx:flow-demo-v1:e2', 'FIXTURE', 'flow-demo-v1', 'e2',
        84532, '0x0000000000000000000000000000000000001000',
        '0x0000000000000000000000000000000000000000000000000000000000000002', 2,
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000003',
        '250000', 'e2', NULL
    ),
    (
        'fx:flow-demo-v1:e3', 'FIXTURE', 'flow-demo-v1', 'e3',
        84532, '0x0000000000000000000000000000000000001000',
        '0x0000000000000000000000000000000000000000000000000000000000000003', 1,
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000004',
        '90000', 'e3', NULL
    ),
    (
        'fx:flow-demo-v1:e4', 'FIXTURE', 'flow-demo-v1', 'e4',
        84532, '0x0000000000000000000000000000000000001000',
        '0x0000000000000000000000000000000000000000000000000000000000000004', 0,
        '0x0000000000000000000000000000000000000002',
        '0x0000000000000000000000000000000000000005',
        '115000', 'e4', NULL
    ),
    (
        'fx:flow-demo-v1:e5', 'FIXTURE', 'flow-demo-v1', 'e5',
        84532, '0x0000000000000000000000000000000000001000',
        '0x0000000000000000000000000000000000000000000000000000000000000005', 1,
        '0x0000000000000000000000000000000000000003',
        '0x0000000000000000000000000000000000000005',
        '248000', 'e5', NULL
    ),
    (
        'fx:flow-demo-v1:e6', 'FIXTURE', 'flow-demo-v1', 'e6',
        84532, '0x0000000000000000000000000000000000001000',
        '0x0000000000000000000000000000000000000000000000000000000000000006', 3,
        '0x0000000000000000000000000000000000000005',
        '0x0000000000000000000000000000000000000007',
        '360000', 'e6', NULL
    ),
    (
        'fx:flow-demo-v1:e7', 'FIXTURE', 'flow-demo-v1', 'e7',
        84532, '0x0000000000000000000000000000000000001000',
        '0x0000000000000000000000000000000000000000000000000000000000000007', 0,
        '0x0000000000000000000000000000000000000004',
        '0x0000000000000000000000000000000000000006',
        '88000', 'e7', NULL
    ),
    (
        'fx:flow-demo-v1:e8', 'FIXTURE', 'flow-demo-v1', 'e8',
        84532, '0x0000000000000000000000000000000000001000',
        '0x0000000000000000000000000000000000000000000000000000000000000008', 2,
        '0x0000000000000000000000000000000000000006',
        '0x0000000000000000000000000000000000000007',
        '87000', 'e8', NULL
    ),

    (
        'fx:patterns-demo-v1:p1', 'FIXTURE', 'patterns-demo-v1', 'p1',
        84532, '0x0000000000000000000000000000000000001000',
        '0x00000000000000000000000000000000000000000000000000000000000003e9', 0,
        '0x0000000000000000000000000000000000000065',
        '0x0000000000000000000000000000000000000069',
        '100', 'p1', NULL
    ),
    (
        'fx:patterns-demo-v1:p2', 'FIXTURE', 'patterns-demo-v1', 'p2',
        84532, '0x0000000000000000000000000000000000001000',
        '0x00000000000000000000000000000000000000000000000000000000000003ea', 0,
        '0x0000000000000000000000000000000000000066',
        '0x0000000000000000000000000000000000000069',
        '200', 'p2', NULL
    ),
    (
        'fx:patterns-demo-v1:p3', 'FIXTURE', 'patterns-demo-v1', 'p3',
        84532, '0x0000000000000000000000000000000000001000',
        '0x00000000000000000000000000000000000000000000000000000000000003eb', 0,
        '0x0000000000000000000000000000000000000067',
        '0x0000000000000000000000000000000000000069',
        '300', 'p3', NULL
    ),
    (
        'fx:patterns-demo-v1:p4', 'FIXTURE', 'patterns-demo-v1', 'p4',
        84532, '0x0000000000000000000000000000000000001000',
        '0x00000000000000000000000000000000000000000000000000000000000003ec', 0,
        '0x0000000000000000000000000000000000000068',
        '0x0000000000000000000000000000000000000069',
        '400', 'p4', NULL
    ),
    (
        'fx:patterns-demo-v1:p5', 'FIXTURE', 'patterns-demo-v1', 'p5',
        84532, '0x0000000000000000000000000000000000001000',
        '0x00000000000000000000000000000000000000000000000000000000000003ed', 0,
        '0x0000000000000000000000000000000000000065',
        '0x0000000000000000000000000000000000000066',
        '50', 'p5', NULL
    ),
    (
        'fx:patterns-demo-v1:p6', 'FIXTURE', 'patterns-demo-v1', 'p6',
        84532, '0x0000000000000000000000000000000000001000',
        '0x00000000000000000000000000000000000000000000000000000000000003ed', 1,
        '0x0000000000000000000000000000000000000066',
        '0x0000000000000000000000000000000000000069',
        '50', 'p6', NULL
    ),
    (
        'fx:patterns-demo-v1:p7', 'FIXTURE', 'patterns-demo-v1', 'p7',
        84532, '0x0000000000000000000000000000000000001000',
        '0x00000000000000000000000000000000000000000000000000000000000003ef', 0,
        '0x0000000000000000000000000000000000000065',
        '0x0000000000000000000000000000000000000066',
        '115792089237316195423570985008687907853269984665640564039457584007913129639935',
        'p7', NULL
    ),
    (
        'fx:patterns-demo-v1:p8', 'FIXTURE', 'patterns-demo-v1', 'p8',
        84532, '0x0000000000000000000000000000000000001000',
        '0x00000000000000000000000000000000000000000000000000000000000003f0', 0,
        '0x0000000000000000000000000000000000000065',
        '0x0000000000000000000000000000000000000069',
        '0', 'p8', NULL
    ),
    (
        'fx:patterns-demo-v1:p9', 'FIXTURE', 'patterns-demo-v1', 'p9',
        84532, '0x0000000000000000000000000000000000001000',
        '0x00000000000000000000000000000000000000000000000000000000000003f1', 0,
        '0x0000000000000000000000000000000000000065',
        '0x0000000000000000000000000000000000000065',
        '100', 'p9', NULL
    ),
    (
        'fx:patterns-demo-v1:p10', 'FIXTURE', 'patterns-demo-v1', 'p10',
        84532, '0x0000000000000000000000000000000000001000',
        '0x00000000000000000000000000000000000000000000000000000000000003f2', 0,
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000069',
        '100', 'p10', NULL
    )
ON CONFLICT DO NOTHING;

INSERT INTO dataset_transfers (dataset_id, dataset_version, transfer_id)
VALUES
    ('flow-demo', 'v1', 'fx:flow-demo-v1:e1'),
    ('flow-demo', 'v1', 'fx:flow-demo-v1:e2'),
    ('flow-demo', 'v1', 'fx:flow-demo-v1:e3'),
    ('flow-demo', 'v1', 'fx:flow-demo-v1:e4'),
    ('flow-demo', 'v1', 'fx:flow-demo-v1:e5'),
    ('flow-demo', 'v1', 'fx:flow-demo-v1:e6'),
    ('flow-demo', 'v1', 'fx:flow-demo-v1:e7'),
    ('flow-demo', 'v1', 'fx:flow-demo-v1:e8'),
    ('patterns-demo', 'v1', 'fx:patterns-demo-v1:p1'),
    ('patterns-demo', 'v1', 'fx:patterns-demo-v1:p2'),
    ('patterns-demo', 'v1', 'fx:patterns-demo-v1:p3'),
    ('patterns-demo', 'v1', 'fx:patterns-demo-v1:p4'),
    ('patterns-demo', 'v1', 'fx:patterns-demo-v1:p5'),
    ('patterns-demo', 'v1', 'fx:patterns-demo-v1:p6'),
    ('patterns-demo', 'v1', 'fx:patterns-demo-v1:p7'),
    ('patterns-demo', 'v1', 'fx:patterns-demo-v1:p8'),
    ('patterns-demo', 'v1', 'fx:patterns-demo-v1:p9'),
    ('patterns-demo', 'v1', 'fx:patterns-demo-v1:p10')
ON CONFLICT (dataset_id, dataset_version, transfer_id) DO NOTHING;

COMMIT;
