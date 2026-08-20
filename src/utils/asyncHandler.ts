import type { NextFunction, Request, Response } from "express";

/**
 * Express 4 ne capture pas automatiquement les rejets de Promise dans les
 * handlers async. Ce wrapper transmet toute erreur au middleware
 * errorHandler via next(), au lieu de faire planter le serveur.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
