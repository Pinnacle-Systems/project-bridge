import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export type AdminAuthOptions = {
  apiKey: string;
};

export function createAdminAuthMiddleware(options: AdminAuthOptions): RequestHandler {
  const expectedApiKey = options.apiKey.trim();
  if (!expectedApiKey) {
    throw new Error("ADMIN_API_KEY is required to protect admin APIs.");
  }

  return (req, res, next) => {
    const providedApiKey = getAdminApiKey(req);
    if (!providedApiKey || !secureEqual(providedApiKey, expectedApiKey)) {
      res.status(401).json({ error: "Admin authentication required." });
      return;
    }

    next();
  };
}

function getAdminApiKey(req: Parameters<RequestHandler>[0]): string | undefined {
  const explicitKey = req.get("x-admin-api-key");
  if (explicitKey) {
    return explicitKey;
  }

  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function secureEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}
