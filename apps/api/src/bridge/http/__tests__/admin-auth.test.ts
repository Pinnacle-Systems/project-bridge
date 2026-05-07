import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createAdminAuthMiddleware } from "../admin-auth.js";

function runMiddleware(headers: Record<string, string | undefined>, apiKey = "secret-key") {
  const middleware = createAdminAuthMiddleware({ apiKey });
  const req = {
    get(name: string) {
      return headers[name.toLowerCase()];
    }
  } as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  } as unknown as Response;
  const next = vi.fn();

  middleware(req, res, next);

  return { res, next };
}

describe("admin auth middleware", () => {
  it("allows requests with a matching x-admin-api-key header", () => {
    const { res, next } = runMiddleware({ "x-admin-api-key": "secret-key" });

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows requests with a matching bearer token", () => {
    const { res, next } = runMiddleware({ authorization: "Bearer secret-key" });

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects requests without an admin API key", () => {
    const { res, next } = runMiddleware({});

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Admin authentication required." });
  });

  it("rejects requests with the wrong admin API key", () => {
    const { res, next } = runMiddleware({ "x-admin-api-key": "wrong-key" });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("requires a configured admin API key", () => {
    expect(() => createAdminAuthMiddleware({ apiKey: "" })).toThrow("ADMIN_API_KEY is required");
  });
});
