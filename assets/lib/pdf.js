/**
 * Generador mínimo de PDF vectorial (sin dependencias): texto Helvetica, líneas y rectángulos.
 * Alcanza para fichas de obra: tablas de cómputo y plantas dibujadas como vectores.
 * Coordenadas en puntos (1 pt = 1/72"), con origen arriba a la izquierda como en pantalla.
 */
const A4 = [595.28, 841.89];
/** A4 apaisado (planos). */
export const A4_LANDSCAPE = [841.89, 595.28];

/* Anchos de Helvetica (por 1000 em) para alinear a la derecha; aproximados para el resto de los glifos. */
const W = { ' ': 278, '.': 278, ',': 278, ':': 278, ';': 278, '-': 333, '(': 333, ')': 333, '/': 278, '%': 889, '×': 584, m: 833, w: 722, i: 222, l: 222, j: 222, t: 278, f: 278, r: 333, I: 278 };
const width = (s, size, bold) => {
    let w = 0;
    for (const ch of s) {
        if (ch >= '0' && ch <= '9') w += 556;
        else if (W[ch] !== undefined) w += W[ch];
        else if (ch >= 'A' && ch <= 'Z') w += 680;
        else w += 540;
    }
    return (w * size * (bold ? 1.05 : 1)) / 1000;
};

/* Unicode → WinAnsi (cp1252). Lo que no existe se reemplaza por un equivalente legible. */
const CP1252 = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '€': 0x80, '…': 0x85 };
const REPLACE = { '≤': '<=', '≥': '>=', '→': '->', '←': '<-', '≈': '~', '⟲': '', '⟳': '', '≠': '!=', '′': "'", '″': '"' };

function encode(text) {
    let out = '';
    for (const ch of String(text)) {
        if (REPLACE[ch] !== undefined) {
            out += REPLACE[ch];
            continue;
        }
        const code = CP1252[ch] ?? ch.charCodeAt(0);
        out += code < 256 ? String.fromCharCode(code) : '?';
    }
    return out.replace(/[\\()]/g, (c) => `\\${c}`);
}

const num = (n) => (Math.round(n * 100) / 100).toString();
const rgb = ([r, g, b]) => `${num(r / 255)} ${num(g / 255)} ${num(b / 255)}`;

export class Pdf {
    constructor() {
        this.pages = [];
        this.current = null;
        this.images = [];
    }

    addPage(size = A4) {
        this.current = { w: size[0], h: size[1], ops: [] };
        this.pages.push(this.current);
        return this;
    }

    get pageWidth() {
        return this.current.w;
    }

    get pageHeight() {
        return this.current.h;
    }

    /** Escribe texto; align: 'left' | 'right' | 'center' respecto de x. */
    text(x, y, str, { size = 10, bold = false, color = [30, 41, 59], align = 'left' } = {}) {
        const s = String(str);
        let px = x;
        if (align === 'right') px = x - width(s, size, bold);
        else if (align === 'center') px = x - width(s, size, bold) / 2;
        const py = this.current.h - y;
        this.current.ops.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${rgb(color)} rg ${num(px)} ${num(py)} Td (${encode(s)}) Tj ET`);
        return this;
    }

    line(x1, y1, x2, y2, { width: lw = 0.5, color = [30, 41, 59], dash = null } = {}) {
        const h = this.current.h;
        this.current.ops.push(`q ${num(lw)} w ${rgb(color)} RG ${dash ? `[${dash.join(' ')}] 0 d` : ''} ${num(x1)} ${num(h - y1)} m ${num(x2)} ${num(h - y2)} l S Q`);
        return this;
    }

    rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.5 } = {}) {
        const ph = this.current.h;
        const parts = ['q'];
        if (fill) parts.push(`${rgb(fill)} rg`);
        if (stroke) parts.push(`${rgb(stroke)} RG ${num(lineWidth)} w`);
        parts.push(`${num(x)} ${num(ph - y - h)} ${num(w)} ${num(h)} re`);
        parts.push(fill && stroke ? 'B' : fill ? 'f' : 'S');
        parts.push('Q');
        this.current.ops.push(parts.join(' '));
        return this;
    }

    /** Polígono cerrado: pts = [[x, y], …] en coordenadas de página (y hacia abajo). */
    polygon(pts, { fill = null, stroke = null, lineWidth = 0.5 } = {}) {
        if (pts.length < 3) return this;
        const ph = this.current.h;
        const parts = ['q'];
        if (fill) parts.push(`${rgb(fill)} rg`);
        if (stroke) parts.push(`${rgb(stroke)} RG ${num(lineWidth)} w`);
        parts.push(pts.map(([x, y], i) => `${num(x)} ${num(ph - y)} ${i ? 'l' : 'm'}`).join(' '));
        parts.push(fill && stroke ? 'b' : fill ? 'f' : 's');
        parts.push('Q');
        this.current.ops.push(parts.join(' '));
        return this;
    }

    /** Imagen JPEG (data URL de canvas.toDataURL('image/jpeg')) en el rectángulo x, y, w, h. */
    image(x, y, w, h, jpegDataUrl, pxW, pxH) {
        const bin = window.atob(jpegDataUrl.slice(jpegDataUrl.indexOf(',') + 1));
        const name = `Im${this.images.length}`;
        this.images.push({ name, bin, pxW, pxH });
        this.current.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.current.h - y - h)} cm /${name} Do Q`);
        return this;
    }

    textWidth(str, size = 10, bold = false) {
        return width(String(str), size, bold);
    }

    /** Devuelve el documento como Blob application/pdf. */
    toBlob() {
        // Objetos: 1 catálogo, 2 páginas, 3 Helvetica, 4 Helvetica-Bold, luego (página, contenido) por página.
        const objs = [];
        const kids = [];
        objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
        objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
        // Imágenes (JPEG tal cual, DCTDecode) después de las páginas; todas las páginas las pueden usar.
        const imgBase = 5 + this.pages.length * 2;
        this.images.forEach((im, i) => {
            objs[imgBase + i] = `<< /Type /XObject /Subtype /Image /Width ${im.pxW} /Height ${im.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bin.length} >>\nstream\n${im.bin}\nendstream`;
        });
        const xobjects = this.images.length ? ` /XObject << ${this.images.map((im, i) => `/${im.name} ${imgBase + i} 0 R`).join(' ')} >>` : '';
        this.pages.forEach((p, i) => {
            const pageId = 5 + i * 2;
            const contentId = pageId + 1;
            const stream = p.ops.join('\n');
            objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.w)} ${num(p.h)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects} >> /Contents ${contentId} 0 R >>`;
            objs[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
            kids.push(`${pageId} 0 R`);
        });
        objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;

        let out = '%PDF-1.4\n';
        const offsets = [];
        for (let id = 1; id < objs.length; id++) {
            offsets[id] = out.length;
            out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
        }
        const xref = out.length;
        out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
        for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
        out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

        // Todo el contenido es Latin-1: un carácter = un byte, así los offsets del xref son exactos.
        const bytes = new Uint8Array(out.length);
        for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
        return new Blob([bytes], { type: 'application/pdf' });
    }
}
