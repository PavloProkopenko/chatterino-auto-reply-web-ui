/** How a JSON file is laid out, so a save can reproduce it and keep the diff minimal. */
export interface JsonStyle {
  /** 0 = compact, a number = spaces, '\t' = tabs. */
  indent: number | '\t';
  eol: '\n' | '\r\n';
  trailingNewline: boolean;
}

const DEFAULT_STYLE: JsonStyle = { indent: 2, eol: '\n', trailingNewline: true };

export function detectStyle(text: string): JsonStyle {
  if (text.trim() === '') return { ...DEFAULT_STYLE };
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = /\r?\n$/.test(text);
  const body = text.replace(/\r?\n$/, '');
  if (!/\r?\n/.test(body)) return { indent: 0, eol, trailingNewline };
  const lead = /^([ \t]+)\S/m.exec(body)?.[1];
  if (!lead) return { indent: 2, eol, trailingNewline };
  return { indent: lead.startsWith('\t') ? '\t' : lead.length, eol, trailingNewline };
}

export function formatJson(value: unknown, style: JsonStyle): string {
  let out = JSON.stringify(value, null, style.indent === 0 ? undefined : style.indent);
  if (style.eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  return style.trailingNewline ? out + style.eol : out;
}
