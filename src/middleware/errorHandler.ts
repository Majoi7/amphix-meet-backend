import type { NextFunction, Request, Response } from "express";

export class ApiRequestError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: "not_found",
    message: `Route inconnue : ${req.method} ${req.path}`,
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof ApiRequestError) {
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }

  // eslint-disable-next-line no-console
  console.error("[errorHandler] Erreur non gérée:", err);
  res.status(500).json({
    error: "internal_error",
    message: "Une erreur inattendue est survenue.",
  });
}
