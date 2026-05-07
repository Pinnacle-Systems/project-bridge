import type { ErrorRequestHandler } from "express";

export type HttpErrorDetail = {
  field?: string;
  message: string;
};

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: HttpErrorDetail[];
  readonly expose = true;

  constructor(statusCode: number, code: string, message: string, details?: HttpErrorDetail[]) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: HttpErrorDetail[]): HttpError {
  return new HttpError(400, "INVALID_REQUEST", message, details);
}

export const jsonErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = typeof req.header("x-request-id") === "string" ? req.header("x-request-id") : undefined;
  const statusCode = getExposedStatusCode(err);
  const body =
    statusCode < 500
      ? {
          error: {
            code: getExposedCode(err),
            message: getExposedMessage(err),
            details: getExposedDetails(err)
          },
          requestId
        }
      : {
          error: "Internal server error.",
          requestId
        };

  console.error("Unhandled request error", {
    method: req.method,
    path: req.originalUrl,
    requestId,
    error: err
  });

  res.status(statusCode).json(body);
};

function getExposedStatusCode(err: unknown): number {
  if (err instanceof HttpError) {
    return err.statusCode;
  }
  if (isPrismaUniqueConstraintError(err)) {
    return 409;
  }
  return 500;
}

function getExposedCode(err: unknown): string {
  if (err instanceof HttpError) {
    return err.code;
  }
  if (isPrismaUniqueConstraintError(err)) {
    return "UNIQUE_CONSTRAINT";
  }
  return "INTERNAL_SERVER_ERROR";
}

function getExposedMessage(err: unknown): string {
  if (err instanceof HttpError) {
    return err.message;
  }
  if (isPrismaUniqueConstraintError(err)) {
    return "Unique constraint violated.";
  }
  return "Request failed.";
}

function getExposedDetails(err: unknown): HttpErrorDetail[] | undefined {
  if (err instanceof HttpError) {
    return err.details;
  }
  if (isPrismaUniqueConstraintError(err)) {
    return [{ message: "A record with the same unique fields already exists." }];
  }
  return undefined;
}

function isPrismaUniqueConstraintError(err: unknown): boolean {
  return isRecord(err) && err.code === "P2002";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
