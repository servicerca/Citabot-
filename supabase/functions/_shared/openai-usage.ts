export type OpenAiUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
};

export type OpenAiRateCard = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  scheduleVersion: string;
};

export type OpenAiRateCardInput = {
  inputUsdPerMillion?: string | null;
  outputUsdPerMillion?: string | null;
  cachedInputUsdPerMillion?: string | null;
  scheduleVersion?: string | null;
};

function readCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function readRate(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value.trim())) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function safeLabel(value: unknown, maxLength = 80): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, maxLength);
  return normalized || null;
}

function safeBusinessId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}

export function extractOpenAiUsage(response: unknown): OpenAiUsage | null {
  if (!response || typeof response !== "object" || Array.isArray(response)) return null;
  const usageValue = (response as Record<string, unknown>).usage;
  if (!usageValue || typeof usageValue !== "object" || Array.isArray(usageValue)) return null;

  const usage = usageValue as Record<string, unknown>;
  const inputTokens = readCount(usage.input_tokens);
  const outputTokens = readCount(usage.output_tokens);
  const reportedTotal = readCount(usage.total_tokens);
  if (inputTokens === null || outputTokens === null) return null;

  const detailsValue = usage.input_tokens_details;
  const details = detailsValue && typeof detailsValue === "object" && !Array.isArray(detailsValue)
    ? detailsValue as Record<string, unknown>
    : {};
  const cachedInputTokens = readCount(details.cached_tokens) ?? 0;
  if (cachedInputTokens > inputTokens) return null;

  return {
    inputTokens,
    outputTokens,
    totalTokens: reportedTotal ?? inputTokens + outputTokens,
    cachedInputTokens,
  };
}

export function parseOpenAiRateCard(input: OpenAiRateCardInput): OpenAiRateCard | null {
  const inputUsdPerMillion = readRate(input.inputUsdPerMillion);
  const outputUsdPerMillion = readRate(input.outputUsdPerMillion);
  if (inputUsdPerMillion === null || outputUsdPerMillion === null) return null;

  const cachedInputUsdPerMillion = input.cachedInputUsdPerMillion == null || input.cachedInputUsdPerMillion.trim() === ""
    ? inputUsdPerMillion
    : readRate(input.cachedInputUsdPerMillion);
  if (cachedInputUsdPerMillion === null) return null;

  const scheduleVersion = safeLabel(input.scheduleVersion);
  if (!scheduleVersion) return null;
  return {
    inputUsdPerMillion,
    outputUsdPerMillion,
    cachedInputUsdPerMillion,
    scheduleVersion,
  };
}

export function estimateOpenAiCostUsd(usage: OpenAiUsage, rateCard: OpenAiRateCard): number {
  const uncachedInputTokens = usage.inputTokens - usage.cachedInputTokens;
  const inputCost = uncachedInputTokens * rateCard.inputUsdPerMillion;
  const cachedInputCost = usage.cachedInputTokens * rateCard.cachedInputUsdPerMillion;
  const outputCost = usage.outputTokens * rateCard.outputUsdPerMillion;
  return Number(((inputCost + cachedInputCost + outputCost) / 1_000_000).toFixed(8));
}

export type OpenAiUsageEventInput = {
  source: "assistant" | "whatsapp_webhook";
  businessId: unknown;
  model: unknown;
  requestId: unknown;
  response: unknown;
  rateCard: OpenAiRateCard | null;
};

export function buildOpenAiUsageEvent(input: OpenAiUsageEventInput): Record<string, unknown> {
  const usage = extractOpenAiUsage(input.response);
  return {
    business_id: safeBusinessId(input.businessId),
    source: input.source,
    model: safeLabel(input.model),
    provider_request_id: safeLabel(input.requestId),
    usage_available: usage !== null,
    input_tokens: usage?.inputTokens ?? null,
    cached_input_tokens: usage?.cachedInputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    total_tokens: usage?.totalTokens ?? null,
    estimated_cost_usd: usage && input.rateCard
      ? estimateOpenAiCostUsd(usage, input.rateCard)
      : null,
    cost_estimate_scope: "input_output_and_cached_input_only",
    cache_write_cost_included: false,
    price_schedule_version: input.rateCard?.scheduleVersion ?? null,
  };
}
