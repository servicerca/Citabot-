/**
 * Only an explicitly configured, syntactically safe model may be sent to the
 * provider. Missing configuration must use CitaBot's deterministic fallback,
 * never a silently selected model that can become deprecated or change price.
 */
export function resolveConfiguredOpenAiModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  if (!model || model.length > 80 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model)) {
    return null;
  }
  return model;
}
