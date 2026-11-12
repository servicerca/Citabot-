export type AiQuotaRpcResult = {
  allowed?: boolean;
  reason?: string;
  remaining?: number;
  max_output_tokens?: number;
  used?: number;
  limit?: number;
};

export type AiQuotaDecision = {
  allowed: boolean;
  status: 429 | 503;
  code: "AI_QUOTA_NOT_CONFIGURED" | "AI_MONTHLY_LIMIT_REACHED" | "AI_QUOTA_UNAVAILABLE";
  message: string;
  maxOutputTokens: number;
};

export function decideAiQuota(
  data: AiQuotaRpcResult | null | undefined,
  error: unknown,
): AiQuotaDecision {
  if (error || !data || data.allowed !== true) {
    if (!error && data?.reason === "monthly_limit") {
      return {
        allowed: false,
        status: 429,
        code: "AI_MONTHLY_LIMIT_REACHED",
        message: "Este negocio alcanzó su límite mensual de solicitudes de IA.",
        maxOutputTokens: 0,
      };
    }
    if (!error && data?.reason === "not_configured") {
      return {
        allowed: false,
        status: 503,
        code: "AI_QUOTA_NOT_CONFIGURED",
        message: "La IA está temporalmente desactivada hasta configurar sus límites de uso.",
        maxOutputTokens: 0,
      };
    }
    return {
      allowed: false,
      status: 503,
      code: "AI_QUOTA_UNAVAILABLE",
      message: "No se pudo verificar el límite de uso de IA. No se realizó ninguna solicitud al proveedor.",
      maxOutputTokens: 0,
    };
  }
  const maxOutputTokens = Number(data.max_output_tokens);
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 300) {
    return {
      allowed: false,
      status: 503,
      code: "AI_QUOTA_UNAVAILABLE",
      message: "La configuración de límites de IA no es válida. No se realizó ninguna solicitud al proveedor.",
      maxOutputTokens: 0,
    };
  }
  return {
    allowed: true,
    status: 503,
    code: "AI_QUOTA_UNAVAILABLE",
    message: "",
    maxOutputTokens,
  };
}
