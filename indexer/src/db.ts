import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { IndexedAgentEvent, IndexedJobEvent } from "@arclayer/sdk";
import {
  createSupabaseRestClientFromEnv,
  syncA2AJobsFromERC8183Events,
  type ERC8183IndexedLifecycleEvent,
} from "./a2a-lifecycle-sync";
import { projectAgentsFromEvents, projectJobsFromEvents } from "./projections";
import { ARC_ERC8004_ADDRESS, ARC_ERC8183_ADDRESS, OLD_ARCLAYER_AGENT_REGISTRY_ADDRESS } from "./config";

const currentDir = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.INDEXER_DB_PATH || resolve(currentDir, "../data/arclayer-indexer.sqlite");

mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    client TEXT NOT NULL,
    worker TEXT NOT NULL,
    evaluator TEXT NOT NULL,
    budget TEXT NOT NULL,
    funded_amount TEXT NOT NULL,
    created_at TEXT NOT NULL,
    job_spec_hash TEXT NOT NULL,
    deliverable_uri TEXT NOT NULL,
    proof_metadata_uri TEXT NOT NULL,
    approved INTEGER NOT NULL,
    status INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    token_id TEXT NOT NULL DEFAULT '',
    controller TEXT NOT NULL,
    skill_hash TEXT NOT NULL,
    metadata_uri TEXT NOT NULL,
    registered_at TEXT NOT NULL,
    reputation_score TEXT NOT NULL,
    score TEXT NOT NULL,
    jobs_json TEXT NOT NULL,
    proof_token_ids_json TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'erc8004_identity_registry',
    chain_id TEXT NOT NULL DEFAULT '5042002',
    registry_address TEXT NOT NULL DEFAULT '',
    contract_address TEXT NOT NULL DEFAULT '',
    tx_hash TEXT NOT NULL DEFAULT '',
    block_number TEXT NOT NULL DEFAULT '',
    imported_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS proofs (
    token_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    payer TEXT NOT NULL,
    amount_paid TEXT NOT NULL,
    minted_at TEXT NOT NULL,
    metadata_uri TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS job_events (
    event_key TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    type TEXT NOT NULL,
    block_number TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'erc8183_agentic_commerce'
  );

  CREATE TABLE IF NOT EXISTS agent_events (
    event_key TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    type TEXT NOT NULL,
    block_number TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'erc8004_identity_registry'
  );
`);

for (const statement of [
  "ALTER TABLE agents ADD COLUMN token_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE agents ADD COLUMN source TEXT NOT NULL DEFAULT 'erc8004_identity_registry'",
  "ALTER TABLE agents ADD COLUMN chain_id TEXT NOT NULL DEFAULT '5042002'",
  "ALTER TABLE agents ADD COLUMN registry_address TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE agents ADD COLUMN contract_address TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE agents ADD COLUMN tx_hash TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE agents ADD COLUMN block_number TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE agents ADD COLUMN imported_at TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE agents ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE job_events ADD COLUMN source TEXT NOT NULL DEFAULT 'erc8183_agentic_commerce'",
  "ALTER TABLE agent_events ADD COLUMN source TEXT NOT NULL DEFAULT 'erc8004_identity_registry'",
]) {
  try {
    db.exec(statement);
  } catch {
    // Column already exists.
  }
}

const upsertJob = db.prepare(`
  INSERT INTO jobs (
    id, agent_id, client, worker, evaluator, budget, funded_amount, created_at,
    job_spec_hash, deliverable_uri, proof_metadata_uri, approved, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    agent_id = excluded.agent_id,
    client = excluded.client,
    worker = excluded.worker,
    evaluator = excluded.evaluator,
    budget = excluded.budget,
    funded_amount = excluded.funded_amount,
    created_at = excluded.created_at,
    job_spec_hash = excluded.job_spec_hash,
    deliverable_uri = excluded.deliverable_uri,
    proof_metadata_uri = excluded.proof_metadata_uri,
    approved = excluded.approved,
    status = excluded.status
`);

const upsertAgent = db.prepare(`
  INSERT INTO agents (
    agent_id, token_id, controller, skill_hash, metadata_uri, registered_at, reputation_score, score, jobs_json, proof_token_ids_json,
    source, chain_id, registry_address, contract_address, tx_hash, block_number, imported_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(agent_id) DO UPDATE SET
    token_id = excluded.token_id,
    controller = excluded.controller,
    skill_hash = excluded.skill_hash,
    metadata_uri = excluded.metadata_uri,
    registered_at = excluded.registered_at,
    reputation_score = excluded.reputation_score,
    score = excluded.score,
    jobs_json = excluded.jobs_json,
    proof_token_ids_json = excluded.proof_token_ids_json,
    source = excluded.source,
    chain_id = excluded.chain_id,
    registry_address = excluded.registry_address,
    contract_address = excluded.contract_address,
    tx_hash = excluded.tx_hash,
    block_number = excluded.block_number,
    updated_at = excluded.updated_at
`);

const upsertMeta = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

const upsertJobEvent = db.prepare(`
  INSERT INTO job_events (event_key, job_id, agent_id, type, block_number, tx_hash, payload_json, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(event_key) DO UPDATE SET
    payload_json = excluded.payload_json,
    block_number = excluded.block_number,
    tx_hash = excluded.tx_hash
`);

const upsertAgentEvent = db.prepare(`
  INSERT INTO agent_events (event_key, agent_id, type, block_number, tx_hash, payload_json, source)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(event_key) DO UPDATE SET
    payload_json = excluded.payload_json,
    block_number = excluded.block_number,
    tx_hash = excluded.tx_hash
`);

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value, (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry));
}

function serializeEventKey(event: { transactionHash: `0x${string}`; logIndex: number }) {
  return `${event.transactionHash}:${event.logIndex}`;
}

export function writeMetaValue(key: string, value: string) {
  upsertMeta.run(key, value);
}

function normalizeJobForLegacySchema(job: ReturnType<typeof projectJobsFromEvents>[number]) {
  return {
    id: job.id,
    agentId: job.agentId || job.provider,
    client: job.client,
    worker: job.provider,
    evaluator: job.evaluator,
    budget: job.budget,
    fundedAmount: job.fundedAmount,
    createdAt: job.createdAtBlock,
    jobSpecHash: job.description,
    deliverableURI: job.deliverable,
    proofMetadataURI: job.completionReason,
    approved: job.status === 4,
    status: job.status,
  };
}

function normalizeAgentForLegacySchema(agent: ReturnType<typeof projectAgentsFromEvents>[number]) {
  const source = (agent as any).source === "imported_arclayer_registry"
    ? "imported_arclayer_registry"
    : "erc8004_identity_registry";
  const now = new Date().toISOString();
  const registryAddress = source === "imported_arclayer_registry" ? OLD_ARCLAYER_AGENT_REGISTRY_ADDRESS : ARC_ERC8004_ADDRESS;
  const tokenId = String(agent.tokenId ?? agent.agentId);
  return {
    agentId: `${source}:${tokenId}`,
    tokenId,
    controller: agent.controller,
    skillHash: (agent as any).skillHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
    metadataURI: agent.metadataURI,
    registeredAt: agent.registeredAtBlock,
    reputationScore: "0",
    score: "0",
    jobs: [] as string[],
    proofTokenIds: [] as string[],
    source,
    chainId: String((agent as any).chainId ?? 5042002),
    registryAddress,
    contractAddress: registryAddress,
    txHash: (agent as any).transactionHash ?? "",
    blockNumber: (agent as any).registeredAtBlock ?? "",
    importedAt: now,
    updatedAt: now,
  };
}

export async function syncProjectionStore(
  events: IndexedJobEvent[],
  agentEvents: IndexedAgentEvent[] = [],
) {
  db.exec("BEGIN");
  try {
    for (const event of events) {
      upsertJobEvent.run(
        serializeEventKey(event),
        String(event.jobId ?? "0"),
        String((event as any).provider ?? (event as any).client ?? "0"),
        event.eventName,
        event.blockNumber.toString(),
        event.transactionHash,
        stringifyJson({ ...event, source: "erc8183_agentic_commerce", chainId: 5042002, contractAddress: ARC_ERC8183_ADDRESS }),
        "erc8183_agentic_commerce",
      );
    }

    for (const event of agentEvents) {
      upsertAgentEvent.run(
        serializeEventKey(event),
        event.agentId.toString(),
        event.eventName,
        event.blockNumber.toString(),
        event.transactionHash,
        stringifyJson(event),
        ((event as any).source as string | undefined) ?? "erc8004_identity_registry",
      );
    }

    const allJobEvents = db.prepare(`SELECT payload_json FROM job_events`).all()
      .map((row) => parseJson((row as { payload_json: string }).payload_json) as IndexedJobEvent);
    const allAgentEvents = db.prepare(`SELECT payload_json FROM agent_events`).all()
      .map((row) => parseJson((row as { payload_json: string }).payload_json) as IndexedAgentEvent);

    const projectedJobs = projectJobsFromEvents(allJobEvents);
    const jobWallets = new Set<string>();
    for (const job of projectedJobs) {
      if (job.client) jobWallets.add(job.client.toLowerCase());
      if (job.provider) jobWallets.add(job.provider.toLowerCase());
      if (job.evaluator) jobWallets.add(job.evaluator.toLowerCase());
    }

    const jobs = projectedJobs.map(normalizeJobForLegacySchema);
    const agents = projectAgentsFromEvents(allAgentEvents, jobWallets).map(normalizeAgentForLegacySchema);

    db.exec("DELETE FROM jobs");
    db.exec("DELETE FROM agents");

    for (const job of jobs) {
      upsertJob.run(
        job.id,
        job.agentId,
        job.client,
        job.worker,
        job.evaluator,
        job.budget,
        job.fundedAmount,
        job.createdAt,
        job.jobSpecHash,
        job.deliverableURI,
        job.proofMetadataURI,
        job.approved ? 1 : 0,
        job.status,
      );
    }

    for (const agent of agents) {
      upsertAgent.run(
        agent.agentId,
        agent.tokenId,
        agent.controller,
        agent.skillHash,
        agent.metadataURI,
        agent.registeredAt,
        agent.reputationScore,
        agent.score,
        stringifyJson(agent.jobs),
        stringifyJson(agent.proofTokenIds),
        agent.source,
        agent.chainId,
        agent.registryAddress,
        agent.contractAddress,
        agent.txHash,
        agent.blockNumber,
        agent.importedAt,
        agent.updatedAt,
      );
    }

    const supabase = createSupabaseRestClientFromEnv();
    if (supabase) {
      await syncA2AJobsFromERC8183Events(
        events
          .filter((event) => ["JobCreated", "BudgetSet", "JobFunded", "JobSubmitted", "JobCompleted"].includes(event.eventName))
          .map((event) => ({
            ...event,
            transactionHash: event.transactionHash,
          })) as ERC8183IndexedLifecycleEvent[],
        supabase,
      );
    }

    upsertMeta.run("last_sync_at", Date.now().toString());
    const storedJobEvents = (db.prepare(`SELECT COUNT(*) AS count FROM job_events`).get() as { count: number }).count;
    const storedAgentEvents = (db.prepare(`SELECT COUNT(*) AS count FROM agent_events`).get() as { count: number }).count;
    upsertMeta.run("event_count", String(storedJobEvents + storedAgentEvents));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function readJobs() {
  return db.prepare(`SELECT * FROM jobs ORDER BY CAST(id AS INTEGER) DESC`).all().map((row) => ({
    id: row.id as string,
    agentId: row.agent_id as string,
    client: row.client as string,
    worker: row.worker as string,
    provider: row.worker as string,
    evaluator: row.evaluator as string,
    budget: row.budget as string,
    fundedAmount: row.funded_amount as string,
    createdAt: row.created_at as string,
    jobSpecHash: row.job_spec_hash as string,
    metadataURI: row.job_spec_hash as string,
    deliverableURI: row.deliverable_uri as string,
    submissionURI: row.deliverable_uri as string,
    proofMetadataURI: row.proof_metadata_uri as string,
    completionURI: row.proof_metadata_uri as string,
    approved: Boolean(row.approved),
    status: Number(row.status),
  }));
}

export function readJobById(jobId: string) {
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);
  if (!row) return null;
  return readJobs().find((job) => job.id === jobId) ?? null;
}

export function readAgents(source: "all" | "imported" | "erc8004" = "all") {
  const where = source === "imported"
    ? "WHERE source = 'imported_arclayer_registry'"
    : source === "erc8004"
      ? "WHERE source = 'erc8004_identity_registry'"
      : "";
  return db.prepare(`SELECT * FROM agents ${where} ORDER BY CAST(COALESCE(NULLIF(token_id, ''), agent_id) AS INTEGER) DESC`).all().map((row) => ({
    agentId: row.agent_id as string,
    tokenId: ((row.token_id as string | undefined) || row.agent_id) as string,
    controller: row.controller as string,
    skillHash: row.skill_hash as string,
    metadataURI: row.metadata_uri as string,
    registeredAt: row.registered_at as string,
    registeredAtBlock: row.registered_at as string,
    reputationScore: row.reputation_score as string,
    score: row.score as string,
    jobs: parseJson<string[]>(row.jobs_json as string),
    proofTokenIds: parseJson<string[]>(row.proof_token_ids_json as string),
    source: row.source as string,
    chainId: row.chain_id as string,
    registryAddress: row.registry_address as string,
    contractAddress: row.contract_address as string,
    transactionHash: row.tx_hash as string,
    txHash: row.tx_hash as string,
    blockNumber: row.block_number as string,
    importedAt: row.imported_at as string,
    updatedAt: row.updated_at as string,
    displayType: row.source === "imported_arclayer_registry" ? "ArcLayer Agent" : "ERC-8004 Agent",
  }));
}

export function readAgentById(agentId: string) {
  const exact = readAgents().find((agent) => agent.agentId === agentId);
  if (exact) return exact;
  return readAgents().find((agent) => agent.tokenId === agentId) ?? null;
}

export function readProofs() {
  return db.prepare(`SELECT * FROM proofs ORDER BY CAST(minted_at AS INTEGER) DESC`).all().map((row) => ({
    tokenId: row.token_id as string,
    jobId: row.job_id as string,
    agentId: row.agent_id as string,
    payer: row.payer as string,
    amountPaid: row.amount_paid as string,
    mintedAt: row.minted_at as string,
    metadataURI: row.metadata_uri as string,
  }));
}

export function readProofByJobId(jobId: string) {
  const row = db.prepare(`SELECT * FROM proofs WHERE job_id = ?`).get(jobId);
  if (!row) return null;
  return {
    tokenId: row.token_id as string,
    jobId: row.job_id as string,
    agentId: row.agent_id as string,
    payer: row.payer as string,
    amountPaid: row.amount_paid as string,
    mintedAt: row.minted_at as string,
    metadataURI: row.metadata_uri as string,
  };
}

export function readJobEvents() {
  return db.prepare(`SELECT payload_json FROM job_events ORDER BY CAST(block_number AS INTEGER) DESC`).all().map((row) => parseJson(row.payload_json as string));
}

export function readAgentEvents() {
  return db.prepare(`SELECT payload_json FROM agent_events ORDER BY CAST(block_number AS INTEGER) DESC`).all().map((row) => parseJson(row.payload_json as string));
}

export function readOverview() {
  const jobs = readJobs();
  const agents = readAgents();
  const proofs = readProofs();
  const eventCount = Number((db.prepare(`SELECT value FROM meta WHERE key = 'event_count'`).get() as { value?: string } | undefined)?.value || "0");

  const totalBudget = jobs.reduce((sum, job) => sum + BigInt(job.budget), BigInt(0));
  const totalFunded = jobs.reduce((sum, job) => sum + BigInt(job.fundedAmount), BigInt(0));
  const settledJobs = jobs.filter((job) => job.status === 4).length;
  const fundedJobs = jobs.filter((job) => BigInt(job.fundedAmount) > BigInt(0)).length;

  const importedAgents = agents.filter((agent) => agent.source === "imported_arclayer_registry").length;
  const erc8004Agents = agents.filter((agent) => agent.source === "erc8004_identity_registry").length;

  return {
    summary: {
      eventCount,
      jobs: jobs.length,
      agents: importedAgents + erc8004Agents,
      meta: {
        importedAgentCount: importedAgents,
        erc8004AgentCount: erc8004Agents,
      },
      agentBreakdown: {
        importedAgentCount: importedAgents,
        erc8004AgentCount: erc8004Agents,
        totalAgentCount: importedAgents + erc8004Agents,
      },
      jobBreakdown: {
        erc8183: jobs.length,
      },
      proofs: proofs.length,
      budgetedUsdc: totalBudget.toString(),
      fundedUsdc: totalFunded.toString(),
      totalBudget: totalBudget.toString(),
      totalFunded: totalFunded.toString(),
      settledJobs,
      fundedJobs,
    },
    jobs,
    agents,
    proofs,
  };
}

export function readCounts() {
  const importedAgentCount = readAgents("imported").length;
  const erc8004AgentCount = readAgents("erc8004").length;
  const erc8183JobCount = readJobs().length;
  return {
    importedAgentCount,
    erc8004AgentCount,
    erc8183JobCount,
    visibleAgentCount: importedAgentCount + erc8004AgentCount,
    totalAgentCount: importedAgentCount + erc8004AgentCount,
  };
}

export function readMetaValue(key: string) {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value?: string } | undefined;
  return row?.value ?? null;
}
