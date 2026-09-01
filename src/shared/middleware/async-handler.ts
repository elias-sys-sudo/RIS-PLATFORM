import { Request, Response, NextFunction } from 'express';

/**
 * Wraps an async Express handler to catch rejected promises
 * and forward them to Express error handling.
 * Prevents @typescript-eslint/no-misused-promises lint errors.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
