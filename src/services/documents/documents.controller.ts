// =============================================================================
// Documents — Controller (parse request, call service, return response)
// =============================================================================

import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import * as service from './documents.service';

// ---------------------------------------------------------------------------
// POST /documents/:document_id/comments
// ---------------------------------------------------------------------------

/** Add a comment to a specific document. */
export async function addCommentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { document_id } = req.params;
    const { comment_text } = req.body as { comment_text: string };
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const result = await service.addDocumentComment(
      document_id,
      comment_text,
      userId,
      role,
      ip,
      ua,
    );

    res.status(201).json({ commentId: result.commentId, message: 'Comment added' });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /documents/:document_id/comments
// ---------------------------------------------------------------------------

/** List comments on a document. */
export async function listCommentsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { document_id } = req.params;
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';

    const comments = await service.listDocumentComments(document_id, userId, role);

    res.status(200).json({ comments });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /documents/:document_id/download
// ---------------------------------------------------------------------------

/** Document download endpoint handler. */
export async function downloadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { document_id } = req.params;
    const userId = req.user?.userId ?? '';
    const role = req.user?.role ?? '';
    const ip = req.ip ?? 'unknown';
    const ua = req.get('user-agent') ?? 'unknown';

    const { doc, filePath } = await service.getDocumentForDownload(
      document_id,
      userId,
      role,
      ip,
      ua,
    );

    const stream = service.createFileStream(filePath);
    if (!stream) {
      res.status(404).json({
        error: 'File not found on storage',
      });
      return;
    }

    const filename = `${doc.document_type}${path.extname(filePath) || '.bin'}`;

    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', doc.file_size_bytes.toString());

    stream.pipe(res);

    stream.on('error', (err) => {
      if (!res.headersSent) {
        next(err);
      }
    });
  } catch (err) {
    next(err);
  }
}
