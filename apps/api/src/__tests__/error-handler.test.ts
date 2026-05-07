import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { badRequest, jsonErrorHandler } from "../error-handler.js";

function makeResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  } as unknown as Response;
}

describe("json error handler", () => {
  it("returns a generic JSON error without leaking exception details", () => {
    const req = {
      method: "GET",
      originalUrl: "/bridge/connections/1",
      header: vi.fn().mockReturnValue("req-1")
    } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn() as unknown as NextFunction;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    jsonErrorHandler(new Error("database stack detail"), req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Internal server error.",
      requestId: "req-1"
    });
    expect(JSON.stringify(vi.mocked(res.json).mock.calls)).not.toContain("database stack detail");

    consoleError.mockRestore();
  });

  it("returns safe details for intentional 4xx errors", () => {
    const req = {
      method: "GET",
      originalUrl: "/bridge/connections/1",
      header: vi.fn().mockReturnValue(undefined)
    } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn() as unknown as NextFunction;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    jsonErrorHandler(
      badRequest("Route parameter 'id' must be a valid UUID.", [
        { field: "id", message: "Expected a UUID, received '1'." }
      ]),
      req,
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "INVALID_REQUEST",
        message: "Route parameter 'id' must be a valid UUID.",
        details: [{ field: "id", message: "Expected a UUID, received '1'." }]
      },
      requestId: undefined
    });

    consoleError.mockRestore();
  });

  it("returns a safe conflict response for unique constraint errors", () => {
    const req = {
      method: "POST",
      originalUrl: "/bridge/connections",
      header: vi.fn().mockReturnValue(undefined)
    } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn() as unknown as NextFunction;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    jsonErrorHandler(
      {
        code: "P2002",
        message: "Raw Prisma unique error with query details"
      },
      req,
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "UNIQUE_CONSTRAINT",
        message: "Unique constraint violated.",
        details: [{ message: "A record with the same unique fields already exists." }]
      },
      requestId: undefined
    });
    expect(JSON.stringify(vi.mocked(res.json).mock.calls)).not.toContain("Raw Prisma");

    consoleError.mockRestore();
  });
});
