#!/usr/bin/env node
/**
 * Servidor que imita la API de Kimi (OpenAI Chat Completions) con un guion fijo, para probar el asistente sin gastar ni
 * depender de la red. Uso: node kimi-falso.cjs [puerto=8099]
 * y la app con KIMI_BASE_URL=http://127.0.0.1:8099/v1 KIMI_API_KEY=x KIMI_MODEL=falso.
 * GET /__log devuelve cuántas llamadas recibió (para comprobar que el formulario inicial no llama al modelo).
 */
const http = require('http');

const port = Number(process.argv[2] ?? 8099);
let n = 0;
let calls = 0;
const call = (name, args, content = '') => ({ role: 'assistant', content, tool_calls: [{ id: `c${++n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const q = (id, pregunta, opciones, multiple = false) => ({ id, pregunta, multiple, opciones: opciones.map(([oid, texto]) => ({ id: oid, texto })) });

function reply(messages) {
    const system = String(messages[0].content);
    const last = messages.at(-1);
    const text = String(last.content ?? '');
    if (last.role === 'tool') {
        if (text.includes('"resultado":"ok"')) {
            const casa = JSON.parse(text).casa;
            const errors = casa.observaciones.filter((o) => o.severidad === 'error');
            return { role: 'assistant', content: errors.length ? `Quedó con ${errors.length} error(es); lo reviso.` : 'Listo.' };
        }
        return { role: 'assistant', content: 'No pude: ' + text.slice(0, 120) };
    }
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const t = String(lastUser?.content ?? '');
    if (/familia/i.test(t)) return call('generar_casa', { niveles: 1, ambientes: [{ tipo: 'estar_comedor_cocina' }, { tipo: 'dormitorio_principal' }, { tipo: 'dormitorio', cantidad: 3 }, { tipo: 'bano', cantidad: 2 }, { tipo: 'lavadero' }] }, 'Para 5 personas: 4 dormitorios y 2 baños.');
    if (/dormitorio/i.test(t) && /Sum/i.test(t)) return call('generar_casa', { niveles: 1, ambientes: [{ tipo: 'estar_comedor_cocina' }, { tipo: 'dormitorio_principal' }, { tipo: 'dormitorio', cantidad: 3 }, { tipo: 'bano' }, { tipo: 'toilette' }] });
    if (/agrandala/i.test(t)) return call('preguntar', { preguntas: [q('cuanto', '¿Cuánto más grande?', [['poco', 'Un poco'], ['mucho', 'Bastante']]), q('que', '¿Qué sumamos?', [['dorm', 'Un dormitorio'], ['esc', 'Escritorio'], ['gal', 'Galería']], true)] });
    if (/luz en el estar/i.test(t)) {
        const m = system.match(/"(N1-A\d+) Estar[^"]*"/);
        return call('editar_casa', { operaciones: [{ accion: 'agregar_ventana', ambiente: m ? m[1] : 'N1-A1', tipo: 'V150' }] }, 'Le sumo una ventana donde haya lugar.');
    }
    return { role: 'assistant', content: 'Entendido.' };
}

http.createServer((req, res) => {
    if (req.url === '/__log') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ calls }));
        return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
        if (req.method !== 'POST' || !req.url.endsWith('/chat/completions') || req.headers.authorization !== 'Bearer x') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Invalid Authentication' } }));
            return;
        }
        calls++;
        const { messages } = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: reply(messages), finish_reason: 'stop' }] }));
    });
}).listen(port, '127.0.0.1', () => console.log(`kimi falso en http://127.0.0.1:${port}/v1`));
