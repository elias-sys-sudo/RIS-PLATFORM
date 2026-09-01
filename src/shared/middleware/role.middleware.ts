import { Request, Response, NextFunction } from 'express';

/**
 * Role guard middleware factory.
 * Returns middleware that checks req.user.role against an allowed list.
 * Returns 403 Forbidden if the user's role is not in the list.
 *
 * Usage: router.get('/admin/route', authenticateJwt, createRoleGuard(['management', 'credit_officer']), handler)
 */
export function createRoleGuard(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      res.status(401).json({
        error: 'AUTH_ERROR',
        message: 'Authentication required',
      });
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
      return;
    }

    next();
  };
}
