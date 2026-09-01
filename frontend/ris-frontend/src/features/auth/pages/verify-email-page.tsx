import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertTriangle, ArrowLeft, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';

import { verifyEmail } from '../api/auth.api';
import { parseApiError } from '@/lib/parse-api-error';

// 64-character hex token format issued by the backend.
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

type VerifyState =
  | { kind: 'loading' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

// ── Sub-components ───────────────────────────────────────────────────────────

function LoadingState(): React.ReactElement {
  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Verifying your email</CardTitle>
        <CardDescription>Hold on while we confirm your link.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="size-12 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Verifying your email...</p>
      </CardContent>
    </Card>
  );
}

function SuccessState({ onContinue }: { onContinue: () => void }): React.ReactElement {
  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Email verified successfully</CardTitle>
        <CardDescription>Your account is ready.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 py-8">
        <CheckCircle2 className="size-12 text-green-600" />
        <p className="text-center text-sm text-muted-foreground">
          You can now sign in.
        </p>
        <Button className="w-full" onClick={onContinue}>
          Continue to login
        </Button>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message }: { message: string }): React.ReactElement {
  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Verification failed</CardTitle>
        <CardDescription>We couldn't verify your email.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 py-8">
        <AlertTriangle className="size-12 text-destructive" />
        <p className="text-center text-sm text-muted-foreground">{message}</p>
        <div className="flex w-full flex-col gap-2">
          <Link to="/resend-verification" className="w-full">
            <Button variant="outline" className="w-full">
              <Mail className="mr-2 size-4" />
              Request a new verification link
            </Button>
          </Link>
          <Link to="/login" className="w-full">
            <Button variant="ghost" className="w-full">
              <ArrowLeft className="mr-2 size-4" />
              Back to login
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function VerifyEmailPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';

  // Validate token format without ever logging the token itself.
  const tokenLooksValid = TOKEN_PATTERN.test(token);

  const [state, setState] = useState<VerifyState>(
    tokenLooksValid
      ? { kind: 'loading' }
      : { kind: 'error', message: 'This verification link is invalid or missing.' },
  );

  useEffect(() => {
    if (!tokenLooksValid) return;

    let cancelled = false;
    (async () => {
      try {
        await verifyEmail(token);
        if (!cancelled) setState({ kind: 'success' });
      } catch (err) {
        if (!cancelled) {
          setState({ kind: 'error', message: parseApiError(err) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, tokenLooksValid]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      {state.kind === 'loading' && <LoadingState />}
      {state.kind === 'success' && (
        <SuccessState onContinue={() => navigate('/login', { replace: true })} />
      )}
      {state.kind === 'error' && <ErrorState message={state.message} />}
    </div>
  );
}

export default VerifyEmailPage;
