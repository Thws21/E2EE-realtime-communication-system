export function getJwtClaim(accessToken: string, claim: string): string | undefined {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as Record<string, unknown>;
    const value = payload[claim];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}
