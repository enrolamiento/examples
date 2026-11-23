// Envía al receptor local un aviso «prueba» firmado con su secreto, igual que lo firma Enrolamiento.
// Sirve para ver el receptor funcionando sin publicarlo en una dirección https.
//
//   node --env-file=.env webhook-receiver/send-test-event.mjs

import { createHmac, randomUUID } from 'node:crypto';

const SECRETO = process.env.ENROLAMIENTO_WEBHOOK_SECRETO;
const DESTINO = process.env.DESTINO ?? `http://127.0.0.1:${process.env.PUERTO ?? 3000}`;

if (!SECRETO) {
  console.error('Falta ENROLAMIENTO_WEBHOOK_SECRETO: use el mismo valor con el que arrancó el receptor.');
  process.exit(2);
}

const id = randomUUID();
const fecha = new Date().toISOString();
const cuerpo = JSON.stringify({ evento: 'prueba', id, fecha });

// La firma cubre la fecha de la cabecera, un punto y el cuerpo exacto que se envía.
const firma = 'sha256=' + createHmac('sha256', SECRETO).update(`${fecha}.`).update(cuerpo).digest('hex');

let respuesta;
try {
  respuesta = await fetch(DESTINO, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Enrolamiento-Evento': 'prueba',
      'X-Enrolamiento-Entrega': id,
      'X-Enrolamiento-Fecha': fecha,
      'X-Enrolamiento-Firma': firma,
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
