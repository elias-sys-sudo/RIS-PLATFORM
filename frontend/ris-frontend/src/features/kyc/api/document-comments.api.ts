/**
 * Document comments API — Checkers §5a.
 * Backend: src/services/documents/documents.routes.ts
 */
import { apiClient } from '@/lib/axios';

export interface DocumentCommentView {
  id: string;
  authorRole: string;
  commentText: string;
  createdAt: string;
}

export async function listDocumentComments(documentId: string): Promise<DocumentCommentView[]> {
  const { data } = await apiClient.get<{ comments: DocumentCommentView[] }>(
    `/documents/${documentId}/comments`,
  );
  return data.comments ?? [];
}

export async function postDocumentComment(
  documentId: string,
  commentText: string,
): Promise<DocumentCommentView> {
  const { data } = await apiClient.post<DocumentCommentView>(
    `/documents/${documentId}/comments`,
    { comment_text: commentText },
  );
  return data;
}
