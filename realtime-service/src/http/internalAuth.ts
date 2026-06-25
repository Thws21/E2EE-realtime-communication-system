import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../config.js";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isInternalRequestAuthorized(req: IncomingMessage, config: AppConfig): boolean {
  const authorization = req.headers.authorization ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token || !config.apiInternalToken) {
    return false;
  }
  return safeEqual(token, config.apiInternalToken);
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw) as unknown;
}
