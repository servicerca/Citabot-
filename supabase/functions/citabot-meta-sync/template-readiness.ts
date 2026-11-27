export type ApprovedMarketingTemplate = {
  name: string;
  language: string;
};

export type TemplateReadiness =
  | {
      checked: true;
      complete: boolean;
      pages_checked: number;
      total_templates_seen: number;
      approved_marketing_templates: ApprovedMarketingTemplate[];
    }
  | {
      checked: false;
      meta_status: number | null;
      meta_code: number | string | null;
      reason: "permission_or_provider_error" | "invalid_response" | "network_error";
    };

type MetaTemplatePayload = {
  data?: unknown;
  paging?: {
    next?: unknown;
    cursors?: { after?: unknown };
  };
  error?: { code?: unknown };
};

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const GRAPH_BASE = "https://graph.facebook.com/v26.0";

function validTemplate(value: unknown): ApprovedMarketingTemplate | null {
  if (!value || typeof value !== "object") return null;
  const template = value as Record<string, unknown>;
  const name = typeof template.name === "string" ? template.name.trim() : "";
  const language = typeof template.language === "string" ? template.language.trim() : "";
  if (
    template.status !== "APPROVED" ||
    template.category !== "MARKETING" ||
    !/^[a-z0-9_]{1,512}$/i.test(name) ||
    !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)
  ) {
    return null;
  }
  return { name, language };
}

/**
 * Reads only approved MARKETING templates from the WABA. It never creates,
 * edits, sends, or approves a template. A page cap prevents unbounded provider
 * requests; an incomplete scan is reported explicitly.
 */
export async function readApprovedMarketingTemplates(
  wabaId: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<TemplateReadiness> {
  const waba = wabaId.trim();
  const token = accessToken.trim();
  if (!waba || !token) {
    return {
      checked: false,
      meta_status: null,
      meta_code: null,
      reason: "invalid_response",
    };
  }

  const templates = new Map<string, ApprovedMarketingTemplate>();
  let after: string | null = null;
  let pagesChecked = 0;
  let totalSeen = 0;
  let hasMore = false;

  try {
    while (pagesChecked < MAX_PAGES) {
      const url = new URL(GRAPH_BASE + "/" + encodeURIComponent(waba) + "/message_templates");
      url.searchParams.set("fields", "id,name,status,category,language");
      url.searchParams.set("limit", String(PAGE_SIZE));
      if (after) url.searchParams.set("after", after);

      const response = await fetcher(url.toString(), {
        headers: { Authorization: "Bearer " + token },
      });
      const payload = await response.json().catch(() => null) as MetaTemplatePayload | null;
      if (!response.ok) {
        const code = payload?.error?.code;
        return {
          checked: false,
          meta_status: response.status,
          meta_code: typeof code === "number" || typeof code === "string" ? code : null,
          reason: "permission_or_provider_error",
        };
      }
      if (!payload || !Array.isArray(payload.data)) {
        return {
          checked: false,
          meta_status: response.status,
          meta_code: null,
          reason: "invalid_response",
        };
      }

      pagesChecked += 1;
      totalSeen += payload.data.length;
      for (const item of payload.data) {
        const approved = validTemplate(item);
        if (approved) templates.set(approved.name + ":" + approved.language, approved);
      }

      const nextAfter = typeof payload.paging?.cursors?.after === "string"
        ? payload.paging.cursors.after
        : "";
      hasMore = Boolean(payload.paging?.next);
      if (!hasMore || !nextAfter) {
        hasMore = Boolean(payload.paging?.next);
        break;
      }
      after = nextAfter;
    }

    return {
      checked: true,
      complete: !hasMore,
      pages_checked: pagesChecked,
      total_templates_seen: totalSeen,
      approved_marketing_templates: [...templates.values()],
    };
  } catch {
    return {
      checked: false,
      meta_status: null,
      meta_code: null,
      reason: "network_error",
    };
  }
}
