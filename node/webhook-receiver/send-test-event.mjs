// Envía al receptor local un aviso «prueba» firmado con su secreto, igual que lo firma Enrolamiento.
// Sirve para ver el receptor funcionando sin publicarlo en una dirección https.
//
//   node --env-file=.env webhook-receiver/send-test-event.mjs

import { randomUUID } from 'node:crypto';
import { webhooks } from 'enrolamiento';

const SECRETO = process.env.ENROLAMIENTO_WEBHOOK_SECRETO;
const DESTINO = process.env.DESTINO ?? `http://127.0.0.1:${process.env.PUERTO ?? 3000}`;

if (!SECRETO) {
  console.error('Falta ENROLAMIENTO_WEBHOOK_SECRETO: use el mismo valor con el que arrancó el receptor.');
  process.exit(2);
}

const id = randomUUID();
const cuerpo = JSON.stringify({ evento: 'prueba', id, fecha: new Date().toISOString() });

// firmar devuelve las dos cabeceras de la firma: X-Enrolamiento-Fecha y X-Enrolamiento-Firma.
const firma = webhooks.firmar(cuerpo, SECRETO);

let respuesta;
try {
  respuesta = await fetch(DESTINO, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Enrolamiento-Evento': 'prueba',
      'X-Enrolamiento-Entrega': id,
      ...firma,
    },
    body: cuerpo,
  });
} catch (error) {
  console.error(`No se pudo conectar con ${DESTINO}: ¿está corriendo el receptor? (${error.cause?.code ?? error.message})`);
  process.exit(1);
}

console.log(`${DESTINO} respondió ${respuesta.status}`);
if (respuesta.status === 401) console.error('El receptor rechazó la firma: el secreto no es el mismo en los dos procesos.');
process.exit(respuesta.ok ? 0 : 1);
