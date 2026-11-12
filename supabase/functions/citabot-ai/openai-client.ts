const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export type OpenAiResponseResult = {
  ok: boolean;
  data: Record<string, unknown>;
  status: number | null;
  attempts: number;
  failureKind: string | null;
  requestId: string | null;
  errorCode: string | null;
  errorType: string | null;
};

export type OpenAiRequestOptions = {
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
};

function safeProviderField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80);
  return normalized || null;
}

function getProviderError(data: unknown): { code: string | null; type: string | null } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { code: null, type: null };
  }
  const error = (data as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return { code: null, type: null };
  }
  const record = error as Record<string, unknown>;
  return {
    code: safeProviderField(record.code),
    type: safeProviderField(record.type),
  };
}

export async function createOpenAiResponse(
  apiKey: string,
  payload: Record<string, unknown>,
  options: OpenAiRequestOptions = {},
): Promise<OpenAiResponseResult> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const wait = options.wait ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  let lastData: Record<string, unknown> = {};
  let lastStatus: number | null = null;
  let lastRequestId: string | null = null;
  let lastErrorCode: string | null = null;
  let lastErrorType: string | null = null;
  let failureKind: string | null = null;
  let attempts = 0;

  // One provider attempt per reserved quota unit; client retries require a new reservation.
  for (let attempt = 1; attempt <= 1; attempt++) {
    attempts = attempt;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetcher("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      lastStatus = response.status;
      lastRequestId = safeProviderField(response.headers.get("x-request-id"));
      lastData = await response.json().catch(() => ({}));
      const providerError = getProviderError(lastData);
      lastErrorCode = providerError.code;
      lastErrorType = providerError.type;

      if (response.ok) {
        return {
          ok: true,
          data: lastData,
          status: response.status,
          attempts,
          failureKind: null,
          requestId: lastRequestId,
          errorCode: null,
          errorType: null,
        };
      }

      failureKind = "http_error";
      if (!RETRYABLE_STATUS_CODES.has(response.status)) break;
    } catch (error) {
      failureKind = error instanceof Error
        ? (error.name === "AbortError" ? "timeout" : error.name)
        : "UnknownError";
      lastStatus = null;
      lastRequestId = null;
      lastErrorCode = null;
      lastErrorType = null;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < 3) await wait(400 * attempt);
  }

  return {
    ok: false,
    data: lastData,
    status: lastStatus,
    attempts,
    failureKind: failureKind ?? "http_error",
    requestId: lastRequestId,
    errorCode: lastErrorCode,
    errorType: lastErrorType,
  };
}
