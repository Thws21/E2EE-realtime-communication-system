import type { AppConfig } from "../config.js";

export type DependencyCheck = {
  name: string;
  status: "ok" | "skipped" | "error";
  required: boolean;
  message: string;
  checkedAt: string;
};

export type ReadinessResult = {
  ready: boolean;
  status: "ready" | "degraded";
  checks: DependencyCheck[];
};

function okCheck(name: string, required: boolean, message: string): DependencyCheck {
  return {
    name,
    status: "ok",
    required,
    message,
    checkedAt: new Date().toISOString(),
  };
}

function skippedCheck(name: string, message: string): DependencyCheck {
  return {
    name,
    status: "skipped",
    required: false,
    message,
    checkedAt: new Date().toISOString(),
  };
}

function errorCheck(name: string, required: boolean, message: string): DependencyCheck {
  return {
    name,
    status: "error",
    required,
    message,
    checkedAt: new Date().toISOString(),
  };
}

async function checkInternalApi(config: AppConfig): Promise<DependencyCheck> {
  if (config.allowDevConversationAccess && config.allowDevMessagePersist) {
    return skippedCheck(
      "api-internal",
      "Skipped in local dev because conversation access and message persist are using dev fallbacks.",
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);

    const response = await fetch(`${config.apiInternalBaseUrl}/health`, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return errorCheck(
        "api-internal",
        true,
        `API internal health returned HTTP ${response.status}.`,
      );
    }

    return okCheck("api-internal", true, "API internal health endpoint is reachable.");
  } catch (error) {
    return errorCheck(
      "api-internal",
      true,
      error instanceof Error ? error.message : "API internal health check failed.",
    );
  }
}

function checkRuntimeConfig(config: AppConfig): DependencyCheck {
  if (config.nodeEnv === "production" && !config.jwtAccessSecret) {
    return errorCheck("runtime-config", true, "JWT_ACCESS_SECRET is required in production.");
  }

  if (config.nodeEnv === "production" && !config.apiInternalToken) {
    return errorCheck("runtime-config", true, "API_INTERNAL_TOKEN is required in production.");
  }

  return okCheck("runtime-config", true, "Required runtime configuration is present.");
}

export async function checkReadiness(config: AppConfig): Promise<ReadinessResult> {
  const checks = [checkRuntimeConfig(config), await checkInternalApi(config)];
  const ready = checks.every((check) => check.status !== "error" || !check.required);

  return {
    ready,
    status: ready ? "ready" : "degraded",
    checks,
  };
}
