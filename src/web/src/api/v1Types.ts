// Generated from mocks/v1/openapi.json by scripts/sync-contract.mjs.
// API types preserve official field names; UI types live in src/types.ts.
export type Address = string

export type Hash = string

export type Amount = string

export type BlockNumber = string

export type DateTime = string

export type Asset = { chainId: number; tokenAddress: Address; symbol: string; decimals: number }

export type AssetSelector = { chainId: number; tokenAddress: Address; symbol?: string; decimals?: number }

export type Coverage = { startBlock: BlockNumber; endBlock: BlockNumber; startTime: DateTime; endTime: DateTime }

export type Dataset = { datasetId: string; datasetVersion: string; sourceMode: "FIXTURE" | "SNAPSHOT"; sourceNamespace: string; status: "READY" | "COLLECTING" | "FAILED" | "INVALIDATED"; asset: Asset; startBlock: BlockNumber; endBlock: BlockNumber; startTime: DateTime; endTime: DateTime; finalizedBlock: (null) | (BlockNumber); collectedAt: (null) | (DateTime); boundaryHashes: { [key: string]: Hash }; labels: { [key: string]: string }; notes: Array<string>; invalidationReason?: string }

export type Transfer = { id: string; label?: string; asset: Asset; transferType: "TRANSFER" | "MINT" | "BURN"; txHash: Hash; blockHash: Hash; blockNumber: BlockNumber; transactionIndex: number; logIndex: number; timestamp: DateTime; from: Address; to: Address; amountRaw: Amount }

export type Filter = { startBlock?: BlockNumber; endBlock?: BlockNumber; startTime?: DateTime; endTime?: DateTime; minAmountRaw?: Amount }

export type Limits = { maxNodes?: number; maxEdges?: number; maxPaths?: number; maxStates?: number; maxCandidates?: number; timeBudgetMs?: number }

export type AnalysisRequest = { datasetId: string; datasetVersion: string; asset?: AssetSelector; address: Address; targetAddress?: Address; startTransferId?: string; direction?: "outgoing" | "incoming"; maxDepth?: number; filter?: Filter; limits?: Limits }

export type PathsRequest = (AnalysisRequest) & ({ targetAddress: Address })

export type Node = { id: Address; label?: string }

export type Path = { id: string; transferIds: Array<string>; hops: number }

export type Pattern = { patternId: string; ruleId: "FAN_OUT" | "FAN_IN"; ruleVersion: string; asset: Asset; address: Address; direction: "outgoing" | "incoming"; windowStart: DateTime; windowEnd: DateTime; windowSeconds: number; threshold: number; uniqueCounterparties: number; counterparties: Array<Address>; evidenceIds: Array<string>; groupId: string; incomplete: boolean }

export type Summary = { uniqueTransferCount: number; uniqueAmountRaw: Amount }

export type Truncation = { reason: "PATH_LIMIT" | "STATE_LIMIT" | "CANDIDATE_LIMIT" | "NODE_LIMIT" | "EDGE_LIMIT" | "TIME_BUDGET"; reasons: Array<"PATH_LIMIT" | "STATE_LIMIT" | "CANDIDATE_LIMIT" | "NODE_LIMIT" | "EDGE_LIMIT" | "TIME_BUDGET"> }

export type AnalyzedUntil = { blockNumber: BlockNumber; timestamp: DateTime }

export type LimitStatus = { truncated: (null) | (Truncation); found: number; foundIsLowerBound: boolean; statesVisited: number; candidatesConsidered: number; analyzedUntil: (null) | (AnalyzedUntil); durationMs: number }

export type AnalysisResult = { transfers: Array<Transfer>; nodes: Array<Node>; paths: Array<Path>; patterns: Array<Pattern>; summary: Summary; limits: LimitStatus }

export type TransferConditions = { address?: Address; direction: "any" | "incoming" | "outgoing"; filter: Filter; limit: number }

export type Page = { limit: number; nextCursor: string | null }

export type Meta = { contractVersion: "v1"; ruleVersion: string; datasetId?: string; datasetVersion?: string; sourceMode?: "FIXTURE" | "SNAPSHOT"; coverage?: Coverage; conditions?: (AnalysisRequest) | (TransferConditions) | ({ txHash: Hash }); limits?: LimitStatus; page?: Page; limitations: Array<string> }

export type V1Error = { code: "INVALID_INPUT" | "INVALID_CURSOR" | "NOT_FOUND" | "DATASET_NOT_FOUND" | "TRANSACTION_NOT_FOUND" | "METHOD_NOT_ALLOWED" | "DATASET_NOT_READY" | "DATASET_INVALIDATED" | "VERSION_MISMATCH" | "OUT_OF_RANGE" | "UNSUPPORTED_ASSET" | "RATE_LIMITED" | "UNAVAILABLE" | "INVALID_DATA" | "REQUEST_TIMEOUT"; message: string; retryable: boolean }

export type ErrorEnvelope = { data: null; meta: Meta; error: V1Error }

export type SuccessEnvelope<T> = { data: T; meta: Meta; error: null }
export type TraceEnvelope = SuccessEnvelope<AnalysisResult> | ErrorEnvelope
