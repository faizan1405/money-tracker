import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { MoneyError } from "./money.js";
import { ConflictError, DuplicateRefError } from "./repo/types.js";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: { field: string; message: string }[]) {
    super(message);
  }
}

export const notImplemented = (what: string) => new HttpError(501, `${what} is not available yet on this server.`, "not_implemented");

/** Wraps async handlers so rejected promises reach the error middleware. */
export const ah = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler => (req, res, next) => {
  fn(req, res, next).catch(next);
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, code: err.code, details: err.details });
  if (err instanceof ZodError)
    return res.status(422).json({ message: "Some fields are invalid", code: "validation", details: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
  if (err instanceof MoneyError) return res.status(422).json({ message: err.message, code: "invalid_amount" });
  if (err instanceof DuplicateRefError) return res.status(409).json({ message: err.message, code: "duplicate_ref" });
  if (err instanceof ConflictError) return res.status(409).json({ message: err.message, code: "conflict" });
  if (err && typeof err === "object" && "type" in err && (err as { type: string }).type === "entity.parse.failed")
    return res.status(400).json({ message: "Malformed JSON", code: "bad_json" });
  console.error(err);
  return res.status(500).json({ message: "Something went wrong on the server", code: "server_error" });
}
