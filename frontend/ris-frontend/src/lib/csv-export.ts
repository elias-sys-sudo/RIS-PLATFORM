/** Escape a CSV cell value — wrap in quotes if it contains commas, quotes, or newlines */
function escapeCell(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Build a CSV string from headers and rows */
export function buildCsv(
  headers: string[],
  rows: (string | number)[][],
): string {
  const headerLine = headers.map(escapeCell).join(',');
  const dataLines = rows.map((row) => row.map(escapeCell).join(','));
  return [headerLine, ...dataLines].join('\n');
}

/** Trigger a browser file download */
export function downloadFile(
  content: string,
  filename: string,
  mimeType = 'text/csv',
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Build CSV and trigger download in one call */
export function exportCsv(
  filename: string,
  headers: string[],
  rows: (string | number)[][],
): void {
  const csv = buildCsv(headers, rows);
  downloadFile(csv, filename);
}
