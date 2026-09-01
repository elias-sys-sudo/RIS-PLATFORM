import { Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import type {
  LoginRequest,
  TwoFactorRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ChangePasswordRequest,
} from './auth.types';

const REFRESH_COOKIE_NAME = 'ris_refresh_token';
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/**
 * POST /auth/login
 * Authenticate with email and password.
 */
export async function loginHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body as LoginRequest;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await authService.login(email, password, ip, ua);

    if (!result.requiresTwoFactor && result.refreshToken !== undefined) {
      setRefreshCookie(res, result.refreshToken);
    }

    if (result.requiresTwoFactor) {
      res.status(200).json({
        accessToken: result.accessToken,
        requiresTwoFactor: true,
      });
      return;
    }

    res.status(200).json({
      user: result.user,
      accessToken: result.accessToken,
      tokenType: result.tokenType,
      expiresIn: result.expiresIn,
      requiresTwoFactor: result.requiresTwoFactor,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/2fa/verify
 * Verify TOTP code and issue full access token.
 */
export async function verifyTwoFactorHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { code, partialAuthToken } = req.body as TwoFactorRequest;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await authService.verifyTwoFactor(partialAuthToken, code, ip, ua);

    if (result.refreshToken !== undefined) {
      setRefreshCookie(res, result.refreshToken);
    }

    res.status(200).json({
      user: result.user,
      accessToken: result.accessToken,
      tokenType: result.tokenType,
      expiresIn: result.expiresIn,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/logout
 * Invalidate the current session.
 */
export async function logoutHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(200).json({ message: 'Logged out' });
      return;
    }

    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await authService.logout(user.sessionId, user.userId, ip, ua);

    res.clearCookie(REFRESH_COOKIE_NAME);
    res.status(200).json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/refresh
 * Issue a new access token from a valid refresh token cookie.
 */
export async function refreshHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

    if (refreshToken === undefined) {
      res.status(401).json({
        error: 'AUTH_ERROR',
        message: 'No refresh token provided',
      });
      return;
    }

    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await authService.refreshAccessToken(refreshToken, ip, ua);

    setRefreshCookie(res, result.refreshToken);

    res.status(200).json({
      accessToken: result.accessToken,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/forgot-password
 * Request a password reset link. Always returns 200.
 */
export async function forgotPasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email } = req.body as ForgotPasswordRequest;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await authService.requestPasswordReset(sanitize(email), ip, ua);

    res.status(200).json({
      message: 'If an account exists with that email, a reset link has been sent',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/reset-password
 * Reset password using a valid token.
 */
export async function resetPasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as ResetPasswordRequest & { confirm_password?: string };
    const token = body.token;
    const new_password = body.new_password;
    const confirm_password = body.confirm_password ?? new_password;
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await authService.resetPassword(token, new_password, confirm_password, ip, ua);

    res.status(200).json({ message: 'Password has been reset successfully' });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /auth/change-password
 * Change password for the authenticated user.
 */
export async function changePasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as ChangePasswordRequest & { confirm_password?: string };
    const current_password = body.current_password;
    const new_password = body.new_password;
    const confirm_password = body.confirm_password ?? new_password;
    const user = req.user;

    if (!user) {
      res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication required' });
      return;
    }

    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await authService.changePassword(
      user.userId,
      user.sessionId,
      current_password,
      new_password,
      confirm_password,
      ip,
      ua,
    );

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /suppliers/:supplier_id/buyers
 * List buyers associated with a supplier.
 * Suppliers may only access their own buyer list (ownership enforced here).
 */
export async function listSupplierBuyersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication required' });
      return;
    }

    const { supplier_id } = req.params;

    // Ownership check — suppliers can only list their own buyers, not other suppliers'.
    // credit_officer / finance_manager / management may access any supplier.
    if (user.role === 'supplier' && user.userId !== supplier_id) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied' });
      return;
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;

    const result = await authService.listBuyersForSupplier(supplier_id, {
      page,
      limit,
      search: search !== undefined ? sanitize(search) : undefined,
      status,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /auth/activity
 * Return recent login activity for the authenticated user.
 */
export async function getLoginActivityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication required' });
      return;
    }

    const activity = await authService.getLoginActivity(user.userId);
    res.status(200).json({ data: activity });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /auth/sessions
 * List all active sessions for the authenticated user.
 */
export async function getActiveSessionsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication required' });
      return;
    }

    const sessions = await authService.getActiveSessions(user.userId);
    res.status(200).json({ data: sessions });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /auth/sessions/:sessionId
 * Revoke a specific session belonging to the authenticated user.
 */
export async function revokeSessionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication required' });
      return;
    }

    const { sessionId } = req.params;
    await authService.revokeSession(sessionId, user.userId);
    res.status(200).json({ message: 'Session revoked' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/verify-email
 * Consume an email verification token (magic link). Public.
 */
export async function verifyEmailHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token } = req.body as { token: string };
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await authService.verifyEmail(token, ip, ua);

    res.status(200).json({ message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/resend-verification
 * Issue a fresh verification email. Always returns 200 to avoid enumeration.
 */
export async function resendVerificationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email } = req.body as { email: string };
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await authService.resendVerificationEmail(sanitize(email), ip, ua);

    res.status(200).json({
      message: 'If a matching unverified account exists, a new verification link has been sent.',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/2fa/backup-codes/generate
 * Issue 8 single-use backup codes. Caller MUST have step-up-verified in the
 * same session (the route stacks step-up before this handler). Returns the
 * raw codes ONLY on this response; never stored or returned again.
 */
export async function generateBackupCodesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication required' });
      return;
    }
    const { code } = req.body as { code: string };
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    // Step-up: TOTP must succeed before backup codes are issued.
    // Throws AuthError on invalid code; bubbles to error handler as 401.
    await authService.verifyStepUp(user.userId, code, ip, ua);

    const codes = await authService.generateBackupCodes(user.userId, ip, ua);
    res.status(200).json({ codes });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/step-up
 * Re-verify the caller's TOTP code before a sensitive action.
 * The caller must already hold a valid full JWT — this does not issue new tokens.
 */
export async function stepUpHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication required' });
      return;
    }

    const { code } = req.body as { code: string };
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    await authService.verifyStepUp(user.userId, code, ip, ua);

    res.status(200).json({ verified: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Strip HTML/script tags from user input to prevent XSS.
 */
function sanitize(input: string): string {
  return input.replace(/[<>]/g, '');
}

/**
 * Set httpOnly secure refresh token cookie.
 */
function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: REFRESH_COOKIE_MAX_AGE,
    path: '/auth/refresh',
  });
}
