import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { fail } from "../http.js";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function internalAuthRequired(req: Request, res: Response, next: NextFunction) {
  const authorization = req.header("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!token || !safeEqual(token, config.apiInternalToken)) {
    return fail(res, 401, "AUTH_INVALID_CREDENTIALS", "Invalid internal service token");
  }

  return next();
}
