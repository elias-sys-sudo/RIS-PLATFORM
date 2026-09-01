/**
 * Checkers §5b — Send feedback to applicant.
 * Free-text message from staff to supplier, outside of approve/reject.
 * Backend queues an email to the supplier and audit-logs the event.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MessageCircle, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { parseApiError } from '@/lib/parse-api-error';
import { sendSupplierFeedback } from '../api/supplier-feedback.api';

interface Props {
  supplierId: string;
}

const MIN = 10;
const MAX = 2000;

export function SupplierFeedbackSection({ supplierId }: Props): React.ReactElement {
  const [message, setMessage] = useState('');

  const mutation = useMutation({
    mutationFn: (msg: string) => sendSupplierFeedback(supplierId, msg),
    onSuccess: () => {
      setMessage('');
      toast.success('Feedback sent — supplier will receive an email');
    },
    onError: (err) => toast.error(parseApiError(err)),
  });

  const trimmed = message.trim();
  const canSend = trimmed.length >= MIN && trimmed.length <= MAX && !mutation.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="size-4" />
          Send feedback to supplier
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Use this to request clarifications or share notes without
          approving or rejecting. The supplier receives an email and the
          event is audit-logged.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. Your Certificate of Incorporation image is hard to read — please re-upload a clearer PDF."
          rows={4}
          maxLength={MAX}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {trimmed.length < MIN
              ? `${MIN - trimmed.length} more characters needed`
              : `${trimmed.length} / ${MAX}`}
          </span>
          <Button onClick={() => mutation.mutate(trimmed)} disabled={!canSend}>
            {mutation.isPending
              ? <Loader2 className="mr-2 size-4 animate-spin" />
              : <Send className="mr-2 size-4" />}
            Send feedback
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
