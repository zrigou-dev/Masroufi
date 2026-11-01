import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export type PrintSection = { title: string; rows: [string, string][] };

export function buildPrintableHtml(title: string, subtitle: string, sections: PrintSection[], rtl: boolean): string {
  const body = sections
    .map((s) => `<h2>${escapeHtml(s.title)}</h2><table>${s.rows
      .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td class="v">${escapeHtml(value)}</td></tr>`)
      .join('')}</table>`)
    .join('');
  return `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
    body{font-family:'Noto Naskh Arabic','Noto Sans Arabic',Tahoma,Arial,sans-serif;color:#17201d;margin:32px;font-size:13px}
    h1{font-size:22px;margin:0 0 4px} h2{font-size:15px;margin:24px 0 8px} .s{color:#5b6a65;margin:0 0 16px}
    table{width:100%;border-collapse:collapse} td{padding:7px 4px;border-bottom:1px solid #e3e8e6}
    td.v{text-align:end;font-variant-numeric:tabular-nums;white-space:nowrap}
  </style></head><body><h1>${escapeHtml(title)}</h1><p class="s">${escapeHtml(subtitle)}</p>${body}</body></html>`;
}

export async function shareAsPdf(html: string): Promise<void> {
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
