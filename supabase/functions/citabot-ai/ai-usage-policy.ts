export type AiQuotaRpcResult = {
  allowed?: boolean;
  reason?: string;
  remaining?: number;
  used?: number;
  limit?: number;
};

export type AiQuotaDecision = {
  allowed: boolean;
  status: 429 | 503;
  code: "AI_QUOTA_NOT_CONFIGURED" | "AI_MONTHLY_LIMIT_REACHED" | "AI_QUOTA_UNAVAILABLE";
  message: string;
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
      };
    }
    if (!error && data?.reason === "not_configured") {
      return {
        allowed: false,
        status: 503,
        code: "AI_QUOTA_NOT_CONFIGURED",
        message: "La IA está temporalmente desactivada hasta configurar sus límites de uso.",
      };
    }
    return {
      allowed: false,
      status: 503,
      code: "AI_QUOTA_UNAVAILABLE",
      message: "No se pudo verificar el límite de uso de IA. No se realizó ninguna solicitud al proveedor.",
    };
  }
  return {
    allowed: true,
    status: 503,
    code: "AI_QUOTA_UNAVAILABLE",
    message: "",
  };
}
