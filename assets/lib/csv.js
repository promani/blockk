/** CSV estructurado, compatible con Excel (BOM UTF-8). El separador es configurable (; para Excel ES, coma para EN). */
export function toCsv(rows, sep = ';') {
    const esc = (v) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[";,\n\r]/.test(s) || s.includes(sep) ? `"${s.replaceAll('"', '""')}"` : s;
    };
    return `﻿${rows.map((r) => r.map(esc).join(sep)).join('\r\n')}\r\n`;
}
