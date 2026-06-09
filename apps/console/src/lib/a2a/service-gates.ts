import { getAddress } from "viem";
import { getSupabaseAdmin } from "@/lib/x402/supabaseClient";

const TABLE = "a2a_agent_service_gates";

export type ServiceGateRail = "circle-gateway" | "arc-native";

export type A2AAgentServiceGate = {
  id: string;
  service_agent_id: string;
  gate_key: string;
  category: string;
  service_role: string;
  scope: string;
  access_type: string;
  market: string;
  price_atomic: string;
  currency: "USDC" | string;
  rail: ServiceGateRail;
  pay_to: string | null;
  reputation_eligible: boolean;
  llm_receipt_required: boolean;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ServiceGateError = Error & {
  code: string;
  status: number;
  details?: unknown;
};

export type UpsertServiceGateInput = {
  serviceAgentId: string;
  gateKey: string;
  category?: string;
  serviceRole: string;
  scope: string;
  accessType: string;
  market?: string;
  priceAtomic: string;
  currency?: "USDC" | string;
  rail?: ServiceGateRail;
  payTo?: unknown;
  reputationEligible?: boolean;
  llmReceiptRequired?: boolean;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
};

export type GetActiveServiceGateInput = {
  serviceAgentId: string;
  gateKey?: string | null;
  category: string;
  serviceRole: string;
  scope: string;
  accessType: string;
  market: string;
  rail?: ServiceGateRail;
};

export function serviceGateError(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
): ServiceGateError {
  return Object.assign(new Error(message), { code, status, details });
}

export function normalizeServiceSlug(
  value: unknown,
  fieldName: string,
): string {
  const slug =
    typeof value === "string"
      ? value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9:_-]+/g, "-")
          .replace(/^-+|-+$/g, "")
      : "";

  if (!slug) {
    throw serviceGateError(
      `missing_${fieldName}`,
      `${fieldName} is required`,
      400,
      { fieldName },
    );
  }

  if (slug.length > 96) {
    throw serviceGateError(
      `${fieldName}_too_long`,
      `${fieldName} must be 96 characters or fewer`,
      400,
      { fieldName },
    );
  }

  return slug;
}

export function normalizeServiceRole(value: unknown): string {
  const role = normalizeServiceSlug(value, "service_role");
  if (role.length > 64) {
    throw serviceGateError(
      "service_role_too_long",
      "service_role must be 64 characters or fewer",
      400,
      {
        fieldName: "service_role",
      },
    );
  }
  return role;
}

export function assertPositiveAtomic(value: unknown): string {
  const atomic = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9]+$/.test(atomic) || BigInt(atomic) <= 0n) {
    throw serviceGateError(
      "invalid_price_atomic",
      "priceAtomic must be a positive integer string",
    );
  }
  return atomic;
}

export function normalizeOptionalAddress(value: unknown): `0x${string}` | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw serviceGateError(
      "invalid_pay_to",
      "payTo must be an EVM address when supplied",
    );
  }

  try {
    return getAddress(value.trim()) as `0x${string}`;
  } catch {
    throw serviceGateError(
      "invalid_pay_to",
      "payTo must be a valid EVM address",
    );
  }
}

function normalizeRail(value: unknown): ServiceGateRail {
  const rail = normalizeServiceSlug(value || "circle-gateway", "rail");
  if (rail !== "circle-gateway" && rail !== "arc-native") {
    throw serviceGateError(
      "invalid_rail",
      "rail must be circle-gateway or arc-native",
    );
  }
  return rail;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeMarket(value: unknown, fallback = "*"): string {
  const raw =
    value === undefined || value === null || value === "" ? fallback : value;
  return raw === "*" ? "*" : normalizeServiceSlug(raw, "market");
}

function normalizeServiceAgentId(value: unknown): string {
  const serviceAgentId = typeof value === "string" ? value.trim() : "";
  if (!serviceAgentId) {
    throw serviceGateError(
      "missing_service_agent_id",
      "serviceAgentId is required",
    );
  }
  if (serviceAgentId.length > 160) {
    throw serviceGateError(
      "service_agent_id_too_long",
      "serviceAgentId must be 160 characters or fewer",
    );
  }
  return serviceAgentId;
}

function isTableNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  const message = String(
    (error as { message?: unknown })?.message ?? "",
  ).toLowerCase();
  return (
    code === "42P01" ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

function asDbError(error: unknown, action: string): ServiceGateError {
  const message = isTableNotFound(error)
    ? "A2A service gate table is not available. Run the service-gate SQL in Supabase SQL Editor before using this endpoint."
    : `Unable to ${action} A2A service gates.`;
  const code = isTableNotFound(error)
    ? "service_gate_table_missing"
    : "service_gate_db_error";
  return serviceGateError(code, message, 500, {
    supabaseMessage: (error as { message?: unknown })?.message,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown })?.code === "23505";
}

type ServiceGateIdentity = {
  serviceAgentId: string;
  gateKey: string;
  category: string;
  serviceRole: string;
  scope: string;
  accessType: string;
  market: string;
  rail: ServiceGateRail;
};

function selectColumns() {
  return "id, service_agent_id, gate_key, category, service_role, scope, access_type, market, price_atomic, currency, rail, pay_to, reputation_eligible, llm_receipt_required, is_active, metadata, created_at, updated_at";
}

export async function listServiceGates(
  serviceAgentId: string,
): Promise<A2AAgentServiceGate[]> {
  const normalizedServiceAgentId = normalizeServiceAgentId(serviceAgentId);
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .select(selectColumns())
    .eq("service_agent_id", normalizedServiceAgentId)
    .order("created_at", { ascending: false });

  if (error) throw asDbError(error, "list");
  return (data ?? []) as unknown as A2AAgentServiceGate[];
}

async function findActiveServiceGateByIdentity(
  input: ServiceGateIdentity,
): Promise<A2AAgentServiceGate | null> {
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .select(selectColumns())
    .eq("service_agent_id", input.serviceAgentId)
    .eq("gate_key", input.gateKey)
    .eq("category", input.category)
    .eq("service_role", input.serviceRole)
    .eq("scope", input.scope)
    .eq("access_type", input.accessType)
    .eq("market", input.market)
    .eq("rail", input.rail)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data as unknown as A2AAgentServiceGate | null;
}

async function updateServiceGateById(
  id: string,
  row: Record<string, unknown>,
): Promise<A2AAgentServiceGate> {
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .update(row)
    .eq("id", id)
    .select(selectColumns())
    .single();

  if (error) throw error;
  return data as unknown as A2AAgentServiceGate;
}

async function insertServiceGateRow(
  row: Record<string, unknown>,
): Promise<A2AAgentServiceGate> {
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .insert(row)
    .select(selectColumns())
    .single();

  if (error) throw error;
  return data as unknown as A2AAgentServiceGate;
}

export async function upsertServiceGate(
  input: UpsertServiceGateInput,
): Promise<A2AAgentServiceGate> {
  const serviceAgentId = normalizeServiceAgentId(input.serviceAgentId);
  const gateKey = normalizeServiceSlug(input.gateKey, "gate_key");
  const category = normalizeServiceSlug(
    input.category || "prediction-market-bots",
    "category",
  );
  const serviceRole = normalizeServiceRole(input.serviceRole);
  const scope = normalizeServiceSlug(input.scope, "scope");
  const accessType = normalizeServiceSlug(input.accessType, "access_type");
  const market = normalizeMarket(input.market);
  const rail = normalizeRail(input.rail || "circle-gateway");
  const priceAtomic = assertPositiveAtomic(input.priceAtomic);
  const payTo = normalizeOptionalAddress(input.payTo);

  if (input.currency !== undefined && input.currency !== "USDC") {
    throw serviceGateError(
      "invalid_currency",
      "currency must be USDC",
      400,
      { currency: input.currency },
    );
  }

  const row = {
    service_agent_id: serviceAgentId,
    gate_key: gateKey,
    category,
    service_role: serviceRole,
    scope,
    access_type: accessType,
    market,
    price_atomic: priceAtomic,
    currency: "USDC",
    rail,
    pay_to: payTo,
    reputation_eligible: input.reputationEligible ?? true,
    llm_receipt_required: input.llmReceiptRequired ?? false,
    is_active: input.isActive ?? true,
    metadata: normalizeMetadata(input.metadata),
    updated_at: new Date().toISOString(),
  };

  const identity: ServiceGateIdentity = {
    serviceAgentId,
    gateKey,
    category,
    serviceRole,
    scope,
    accessType,
    market,
    rail,
  };

  try {
    const existing = await findActiveServiceGateByIdentity(identity);
    if (existing) {
      return await updateServiceGateById(existing.id, row);
    }

    try {
      return await insertServiceGateRow(row);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const racedExisting = await findActiveServiceGateByIdentity(identity);
      if (!racedExisting) throw error;

      return await updateServiceGateById(racedExisting.id, row);
    }
  } catch (error) {
    throw asDbError(error, "upsert");
  }
}


async function queryActiveServiceGates(input: {
  serviceAgentId: string;
  gateKey: string | null;
  category: string;
  serviceRole: string;
  scope: string;
  accessType: string;
  market: string;
  rail: ServiceGateRail;
}): Promise<A2AAgentServiceGate[]> {
  let query = getSupabaseAdmin()
    .from(TABLE)
    .select(selectColumns())
    .eq("service_agent_id", input.serviceAgentId)
    .eq("category", input.category)
    .eq("service_role", input.serviceRole)
    .eq("scope", input.scope)
    .eq("access_type", input.accessType)
    .eq("market", input.market)
    .eq("rail", input.rail)
    .eq("is_active", true);

  if (input.gateKey) query = query.eq("gate_key", input.gateKey);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as A2AAgentServiceGate[];
}

function resolveUniqueGate(
  rows: A2AAgentServiceGate[],
  gateKey: string | null,
): A2AAgentServiceGate | null {
  if (rows.length === 0) return null;
  if (gateKey || rows.length === 1) return rows[0];
  throw serviceGateError(
    "service_gate_ambiguous",
    "Multiple active service gates match this request. Provide gateKey.",
    409,
  );
}

export async function getActiveServiceGate(
  input: GetActiveServiceGateInput,
): Promise<A2AAgentServiceGate | null> {
  const normalized = {
    serviceAgentId: normalizeServiceAgentId(input.serviceAgentId),
    gateKey: input.gateKey
      ? normalizeServiceSlug(input.gateKey, "gate_key")
      : null,
    category: normalizeServiceSlug(input.category, "category"),
    serviceRole: normalizeServiceRole(input.serviceRole),
    scope: normalizeServiceSlug(input.scope, "scope"),
    accessType: normalizeServiceSlug(input.accessType, "access_type"),
    market: normalizeMarket(input.market, "default"),
    rail: normalizeRail(input.rail || "circle-gateway"),
  };

  try {
    const exact = await queryActiveServiceGates(normalized);
    const exactResolved = resolveUniqueGate(exact, normalized.gateKey);
    if (exactResolved) return exactResolved;

    if (normalized.market === "*") return null;

    const wildcard = await queryActiveServiceGates({
      ...normalized,
      market: "*",
    });
    return resolveUniqueGate(wildcard, normalized.gateKey);
  } catch (error) {
    if (isTableNotFound(error)) {
      console.warn(
        "[a2a/service-gates] service gate table missing; falling back to legacy seller profile pricing.",
      );
      return null;
    }
    throw error;
  }
}
