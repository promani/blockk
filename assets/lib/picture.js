/**
 * Imagen de un plano a partir de un archivo: una foto o captura (JPG, PNG, WebP) o la primera página de un PDF. Sale
 * reducida y en JPEG. pdf.js (assets/vendor, sin CDN) se carga sólo cuando llega un PDF, para no pesar en la carga normal.
 */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PDF_TYPE = 'application/pdf';
export const PICTURE_TYPES = [...IMAGE_TYPES, PDF_TYPE];

const isPdf = (file) => file.type === PDF_TYPE || /\.pdf$/i.test(file.name ?? '');

function readImage(file) {
    return new Promise((ok, fail) => {
        const r = new window.FileReader();
        r.onerror = () => fail(new Error('No se pudo leer la imagen.'));
        r.onload = () => {
            const i = new window.Image();
            i.onload = () => ok(i);
            i.onerror = () => fail(new Error('No se pudo leer la imagen.'));
            i.src = r.result;
        };
        r.readAsDataURL(file);
    });
}

/** Primera página del PDF dibujada en un canvas de `side` px de lado mayor. */
async function pdfPage(file, side) {
    let pdfjs;
    try {
        pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
    } catch {
        throw new Error('No se pudo cargar el lector de PDF. Probá con una captura del plano (JPG o PNG).');
    }
    let doc;
    try {
        doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    } catch {
        throw new Error('No se pudo leer el PDF (¿está protegido o dañado?). Probá con una captura del plano.');
    }
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: side / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    return { source: canvas, w: canvas.width, h: canvas.height, pages: doc.numPages };
}

/**
 * @param {File} file
 * @param {object} [o]
 * @param {number} [o.side=1600]  px del lado mayor
 * @param {number} [o.max=Infinity] largo máximo en base64: si se pasa, se achica hasta entrar
 * @returns {Promise<{tipo: string, datos: string, url: string, w: number, h: number, pages: number}>} pages: páginas del PDF (1 si es una imagen)
 */
export async function pictureFrom(file, { side = 1600, max = Infinity } = {}) {
    const pdf = isPdf(file);
    if (!pdf && !IMAGE_TYPES.includes(file.type)) throw new Error('Sólo se pueden usar imágenes JPG, PNG o WebP, o un PDF.');
    let pic;
    if (pdf) pic = await pdfPage(file, side);
    else {
        const img = await readImage(file);
        pic = { source: img, w: img.naturalWidth, h: img.naturalHeight, pages: 1 };
    }
    for (;;) {
        const k = Math.min(1, side / Math.max(pic.w, pic.h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(pic.w * k));
        canvas.height = Math.max(1, Math.round(pic.h * k));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // los PNG con transparencia quedan sobre blanco
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(pic.source, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL('image/jpeg', 0.85);
        const datos = url.slice(url.indexOf(',') + 1);
        if (datos.length <= max || side <= 600) return { tipo: 'image/jpeg', datos, url, w: canvas.width, h: canvas.height, pages: pic.pages };
        side = Math.round(side * 0.8);
    }
}
