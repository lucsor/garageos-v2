// Export CSV (con protezione dalla formula injection).

// Excel/LibreOffice interpretano come formula le celle che iniziano con = + - @ TAB CR: prefisso apostrofo
export function csvSafe(c) {
  const v = String(c ?? '');
  return typeof c !== 'number' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}
export function downloadCSV(filename, rows) {
  const csv = '﻿' + rows.map(r =>
    r.map(c => `"${csvSafe(c).replace(/"/g, '""')}"`).join(';')
  ).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
