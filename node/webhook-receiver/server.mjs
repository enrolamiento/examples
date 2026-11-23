// Receptor de webhooks de Enrolamiento: verifica la firma, deduplica y responde rápido.
//
//   node --env-file=.env webhook-receiver/server.mjs
//
// Enrolamiento solo entrega a direcciones https públicas con un certificado válido:
// publique este servidor detrás de su proxy o de un túnel https para recibir avisos reales.

import { createServer } from 'node:http';
import { ErrorDeFirma, webhooks } from 'enrolamiento';

const SECRETO = process.env.ENROLAMIENTO_WEBHOOK_SECRETO;
const PUERTO = Number(process.env.PUERTO ?? 3000);
const TOPE_BYTES = 64 * 1024; // un aviso pesa menos de 1 KB

if (!SECRETO) {
  console.error('Falta ENROLAMIENTO_WEBHOOK_SECRETO: el secreto de firma que el portal muestra una sola vez.');
  process.exit(2);
}

// Un aviso puede llegar más de una vez. En producción, guarde los identificadores
// en su base de datos: este Set se pierde al reiniciar el proceso.
const avisosVistos = new Set();

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

function procesar(evento) {
  switch (evento.evento) {
    case 'certificacion.finalizada':
      console.log(`Certificación finalizada: ${evento.rut}`, evento.resolucion, evento.respaldo?.estado ?? 'sin respaldo');
      break;
    case 'respaldo.finalizado':
      // Con "listo", respaldo.url se descarga con su usuario y su APIKey.
      console.log(`Respaldo ${evento.respaldo.estado}: ${evento.rut}`, evento.respaldo.codigo ?? '');
      break;
    case 'prueba':
      console.log('Llegó el aviso de «Enviar prueba».');
      break;
    default:
      // La API puede agregar eventos: uno que este receptor no conoce se ignora, sin fallar.
      console.log(`Evento que este receptor no conoce: ${evento.evento}`);
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

  // Verifique siempre antes de procesar, y sobre el cuerpo crudo: la firma cubre los bytes exactos.
  // verificar también rechaza un aviso con más de 5 minutos de diferencia con su reloj.
  let evento;
  try {
    evento = webhooks.verificar(cuerpo, pedido.headers, { secreto: SECRETO });
  } catch (error) {
    if (!(error instanceof ErrorDeFirma)) console.error(error.message);
    respuesta.writeHead(error instanceof ErrorDeFirma ? 401 : 500).end();
    return;
  }

  // Cualquier 2xx cuenta como entregado. Responda primero y procese después:
  // pasados 10 segundos sin respuesta, la entrega cuenta como fallida y se reintenta.
  respuesta.writeHead(204).end();

  // El id del aviso es el mismo en cada reintento.
  if (avisosVistos.has(evento.id)) return;
  avisosVistos.add(evento.id);

  try {
    procesar(evento);
  } catch (error) {
    console.error(`No se pudo procesar el aviso ${evento.id}:`, error.message);
  }
});

servidor.listen(PUERTO, () => console.log(`Receptor escuchando en el puerto ${PUERTO}`));
