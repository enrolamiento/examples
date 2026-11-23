// Receptor de webhooks de Enrolamiento: verifica la firma, deduplica y responde rápido.
//
//   node --env-file=.env webhook-receiver/server.mjs
//
// Enrolamiento solo entrega a direcciones https públicas con un certificado válido:
// publique este servidor detrás de su proxy o de un túnel https para recibir avisos reales.

import { createServer } from 'node:http';
import { esValido } from './signature.mjs';

const SECRETO = process.env.ENROLAMIENTO_WEBHOOK_SECRETO;
const PUERTO = Number(process.env.PUERTO ?? 3000);
const TOPE_BYTES = 64 * 1024; // un aviso pesa menos de 1 KB

if (!SECRETO) {
  console.error('Falta ENROLAMIENTO_WEBHOOK_SECRETO: el secreto de firma que el portal muestra una sola vez.');
  process.exit(2);
}

// Un aviso puede llegar más de una vez. En producción, guarde los identificadores
// en su base de datos: este Set se pierde al reiniciar el proceso.
const entregasVistas = new Set();

function leerCuerpoCrudo(pedido) {
  return new Promise((listo, fallo) => {
    const trozos = [];
    let bytes = 0;
    pedido.on('data', (trozo) => {
      bytes += trozo.length;
      if (bytes > TOPE_BYTES) {
        fallo(new Error('cuerpo demasiado grande'));
        pedido.destroy();
        return;
      }
      trozos.push(trozo);
    });
    pedido.on('end', () => listo(Buffer.concat(trozos)));
    pedido.on('error', fallo);
  });
}

function procesar(aviso) {
  if (aviso.evento === 'certificacion.finalizada') {
    console.log(`Certificación finalizada: ${aviso.rut}`, aviso.resolucion, aviso.respaldo?.estado ?? 'sin respaldo');
  } else if (aviso.evento === 'respaldo.finalizado') {
    // Con "listo", respaldo.url se descarga con su usuario y su APIKey.
    console.log(`Respaldo ${aviso.respaldo.estado}: ${aviso.rut}`, aviso.respaldo.codigo ?? '');
  } else if (aviso.evento === 'prueba') {
    console.log('Llegó el aviso de «Enviar prueba».');
  } else {
    console.log(`Evento que este receptor no conoce: ${aviso.evento}`);
  }
}

const servidor = createServer(async (pedido, respuesta) => {
  if (pedido.method !== 'POST') {
    respuesta.writeHead(405).end();
    return;
  }

  let cuerpo;
  try {
    cuerpo = await leerCuerpoCrudo(pedido);
  } catch {
    respuesta.writeHead(413).end();
    return;
  }

  // Verifique siempre antes de procesar, sobre el cuerpo crudo.
  if (!esValido(SECRETO, cuerpo, pedido.headers)) {
    respuesta.writeHead(401).end();
    return;
  }

  // Cualquier 2xx cuenta como entregado. Responda primero y procese después:
  // pasados 10 segundos sin respuesta, la entrega cuenta como fallida y se reintenta.
  respuesta.writeHead(204).end();

  const entrega = pedido.headers['x-enrolamiento-entrega'];
  if (entregasVistas.has(entrega)) return;
  entregasVistas.add(entrega);

  try {
    procesar(JSON.parse(cuerpo.toString('utf8')));
  } catch (error) {
    console.error(`No se pudo procesar la entrega ${entrega}:`, error.message);
  }
});

servidor.listen(PUERTO, () => console.log(`Receptor escuchando en el puerto ${PUERTO}`));
