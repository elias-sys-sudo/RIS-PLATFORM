/**
 * Checkers §5a — Document Comments thread.
 * Collapsible per document. Any authenticated user can see/post; the backend
 * enforces access (see src/services/documents/documents.service.ts).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { parseApiError } from '@/lib/parse-api-error';
import { formatAbsolute } from '@/lib/format-date';
import {
  listDocumentComments,
  postDocumentComment,
  type DocumentCommentView,
} from '../api/document-comments.api';

interface Props {
  documentId: string;
}

const MIN = 3;
const MAX = 2000;

export function DocumentCommentsSection({ documentId }: Props): React.ReactElement {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['document-comments', documentId],
    queryFn: () => listDocumentComments(documentId),
    enabled: expanded,
    staleTime: 30 * 1000,
  });

  const mutation = useMutation({
    mutationFn: (text: string) => postDocumentComment(documentId, text),
    onSuccess: () => {
      setDraft('');
      toast.success('Comment posted — document owner will be notified');
      void qc.invalidateQueries({ queryKey: ['document-comments', documentId] });
    },
    onError: (err) => toast.error(parseApiError(err)),
  });

  const canSubmit = draft.trim().length >= MIN && draft.trim().length <= MAX && !mutation.isPending;

  return (
    <div className="mt-3">
      <Button
        variant="ghost"
        size="sm"
        className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded((v) => !v)}
      >
        <MessageSquare className="mr-1 size-3" />
        {expanded ? 'Hide comments' : 'Comments'}
        {comments.length > 0 && (
          <span className="ml-1 text-[10px] text-muted-foreground">({comments.length})</span>
        )}
      </Button>

      {expanded && (
        <div className="mt-3 space-y-3 rounded-md border bg-muted/20 p-3">
          {isLoading && <p className="text-xs text-muted-foreground">Loading comments…</p>}

          {!isLoading && comments.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No comments on this document yet.</p>
          )}

          {comments.map((c: DocumentCommentView) => (
            <div key={c.id} className="flex gap-3">
              <Badge variant="outline" className="h-5 shrink-0 text-[10px] capitalize">
                {c.authorRole.replace(/_/g, ' ')}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-xs whitespace-pre-wrap break-words">{c.commentText}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {formatAbsolute(c.createdAt)}
                </p>
              </div>
            </div>
          ))}

          <div className="space-y-2 pt-2 border-t">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a review comment (document owner will be emailed)…"
              rows={2}
              maxLength={MAX}
              className="text-xs"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {draft.trim().length < MIN
                  ? `${MIN - draft.trim().length} chars to minimum`
                  : `${draft.trim().length} / ${MAX}`}
              </span>
              <Button
                size="sm"
                disabled={!canSubmit}
                onClick={() => mutation.mutate(draft.trim())}
              >
                {mutation.isPending && <Loader2 className="mr-2 size-3 animate-spin" />}
                Post comment
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
