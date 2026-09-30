#!/usr/bin/env node
/**
 * Servidor que imita la API de Kimi (OpenAI Chat Completions) con un guion fijo, para probar el chat de la Galería
 * sin gastar ni depender de la red. Uso: node kimi-falso.cjs [puerto=8099]
 * y la app con KIMI_BASE_URL=http://127.0.0.1:8099/v1 KIMI_API_KEY=x KIMI_MODEL=falso.
 */
const http = require('http');

const port = Number(process.argv[2] ?? 8099);
let n = 0;
const call = (name, args) => ({ role: 'assistant', content: '', tool_calls: [{ id: `c${++n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const ask = (pregunta, opciones, multiple = false) => call('preguntar', { pregunta, multiple, opciones: opciones.map(([id, texto]) => ({ id, texto })) });

function reply(messages) {
    const last = messages.at(-1);
    const text = String(last.content ?? '');
    if (last.role === 'tool') {
        if (text.includes('"muros"')) return ask('¿Qué querés cambiar?', [['techo', 'Pasar el techo a un agua'], ['ok', 'Nada, está bien']]);
        if (text.includes('"resultado":"ok"')) {
            const casa = JSON.parse(text).casa;
            return { role: 'assistant', content: `Listo: ${casa.nombre}, ${casa.superficieUtilM2} m² útiles y ${casa.bloques} bloques.`, tool_calls: ask('¿Cómo seguimos?', [['ok', 'Me gusta, la abro'], ['mas', 'Agregar un dormitorio']]).tool_calls };
        }
        return { role: 'assistant', content: 'Hubo un problema con la herramienta.' };
    }
    if (/casa nueva/i.test(text)) return ask('¿Cuántas plantas querés?', [['una', 'Una planta'], ['dos', 'Dos plantas']]);
    if (/Elijo: Una planta/.test(text)) return ask('¿Qué extras sumamos?', [['lav', 'Lavadero'], ['esc', 'Escritorio'], ['toi', 'Toilette']], true);
    if (/Elijo: .*Lavadero/.test(text)) return call('generar_casa', { niveles: 1, ambientes: [{ tipo: 'estar_comedor_cocina' }, { tipo: 'dormitorio', cantidad: 2 }, { tipo: 'bano' }, { tipo: 'lavadero' }, ...(/Escritorio/.test(text) ? [{ tipo: 'escritorio' }] : [])] });
    if (/Agregar un dormitorio/.test(text)) return call('generar_casa', { niveles: 1, ambientes: [{ tipo: 'estar_comedor_cocina' }, { tipo: 'dormitorio', cantidad: 3 }, { tipo: 'bano' }, { tipo: 'lavadero' }] });
    if (/modificar mi proyecto|plantilla/i.test(text)) return call('ver_casa', {});
    if (/Pasar el techo a un agua/.test(text)) return call('editar_casa', { operaciones: [{ accion: 'cambiar_techo', tipo: 'un_agua' }] });
    return { role: 'assistant', content: 'Entendido.' };
}

http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
        if (req.method !== 'POST' || !req.url.endsWith('/chat/completions') || req.headers.authorization !== 'Bearer x') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Invalid Authentication' } }));
            return;
        }
        const { messages } = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: reply(messages), finish_reason: 'stop' }] }));
    });
}).listen(port, '127.0.0.1', () => console.log(`kimi falso en http://127.0.0.1:${port}/v1`));
