import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, Copy, Check, Download, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { parseApiError } from '@/lib/parse-api-error';
import { setup2fa, confirm2fa, type TwoFactorSetupResponse } from '../api/settings.api';

type SetupStep = 'idle' | 'scanning' | 'confirming' | 'done';

export function TwoFactorSetupPage(): React.ReactElement {
  const [step, setStep] = useState<SetupStep>('idle');
  const [setupData, setSetupData] = useState<TwoFactorSetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleEnable(): Promise<void> {
    setIsLoading(true);
    try {
      const data = await setup2fa();
      setSetupData(data);
      setStep('scanning');
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConfirm(): Promise<void> {
    if (code.length !== 6) return;
    setIsLoading(true);
    try {
      await confirm2fa(code);
      setStep('done');
      toast.success('Two-factor authentication enabled');
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setIsLoading(false);
    }
  }

  function copySecret(): void {
    if (!setupData) return;
    void navigator.clipboard.writeText(setupData.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadBackupCodes(): void {
    if (!setupData) return;
    const content = [
      'RIS Platform - Two-Factor Authentication Backup Codes',
      '=====================================================',
      '',
      'Store these codes in a safe place.',
      'Each code can only be used once.',
      '',
      ...setupData.backupCodes.map((c, i) => `${i + 1}. ${c}`),
      '',
      `Generated: ${new Date().toLocaleDateString('en-UG')}`,
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ris-2fa-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  function printBackupCodes(): void {
    window.print();
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-display">Two-Factor Authentication</h1>
        <p className="text-sm text-muted-foreground">Add an extra layer of security to your account.</p>
      </div>

      {step === 'idle' && (
        <Card>
          <CardHeader className="text-center">
            <ShieldCheck className="mx-auto size-12 text-muted-foreground" />
            <CardTitle className="text-lg">Enable 2FA</CardTitle>
            <CardDescription>
              Use an authenticator app like Google Authenticator or Authy to generate time-based codes.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={handleEnable} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
              Enable Two-Factor Authentication
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'scanning' && setupData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Scan QR Code</CardTitle>
            <CardDescription>
              Scan this QR code with your authenticator app, or enter the secret key manually.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-center">
              <img src={setupData.qrCodeUrl} alt="Scan with authenticator app" className="rounded-lg border" />
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono break-all">
                {setupData.secret}
              </code>
              <Button variant="outline" size="icon" onClick={copySecret}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <Button className="w-full" onClick={() => setStep('confirming')}>
              I&apos;ve scanned the code
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'confirming' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Verify Code</CardTitle>
            <CardDescription>
              Enter the 6-digit code from your authenticator app to confirm setup.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              autoFocus
              autoComplete="one-time-code"
              className="text-center text-2xl tracking-[0.5em] font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <Button className="w-full" onClick={handleConfirm} disabled={isLoading || code.length !== 6}>
              {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
              Verify & Enable
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'done' && setupData && (
        <Card>
          <CardHeader className="text-center">
            <Check className="mx-auto size-12 text-green-600" />
            <CardTitle className="text-lg">2FA Enabled</CardTitle>
            <CardDescription>
              Two-factor authentication is now active on your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-amber-50 border-amber-200">
              <AlertTitle className="text-amber-800">Save Your Backup Codes</AlertTitle>
              <AlertDescription className="text-amber-700">
                Store these codes in a safe place. You can use them to access your account if you lose your authenticator device.
              </AlertDescription>
            </Alert>
            <div className="grid grid-cols-2 gap-2">
              {setupData.backupCodes.map((bc) => (
                <code key={bc} className="rounded bg-muted px-3 py-2 text-center text-sm font-mono">
                  {bc}
                </code>
              ))}
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={downloadBackupCodes}>
                <Download className="mr-2 size-4" />
                Download Codes
              </Button>
              <Button variant="outline" className="flex-1" onClick={printBackupCodes}>
                <Printer className="mr-2 size-4" />
                Print Codes
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default TwoFactorSetupPage;
