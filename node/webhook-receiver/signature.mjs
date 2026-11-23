// Verifica la firma de un webhook de Enrolamiento.
// https://developers.enrolamiento.cl/docs/webhooks/

import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCIA_MS = 5 * 60 * 1000;

// secreto: los 64 caracteres hexadecimales tal como los muestra el portal, usados como texto.
//          No los decodifique desde hexadecimal.
// cuerpoCrudo: el Buffer exacto recibido. Si lo parsea y lo vuelve a escribir, la firma no coincide.
// cabeceras: las del request, con los nombres en minúsculas.
export function esValido(secreto, cuerpoCrudo, cabeceras, ahora = Date.now()) {
  const fecha = cabeceras['x-enrolamiento-fecha'];
  const recibida = cabeceras['x-enrolamiento-firma'];
  if (!secreto || typeof fecha !== 'string' || typeof recibida !== 'string') return false;

  // Un aviso de hace más de 5 minutos se rechaza: protege contra la repetición de uno capturado.
  const instante = Date.parse(fecha);
  if (Number.isNaN(instante) || Math.abs(ahora - instante) > TOLERANCIA_MS) return false;

  const esperada = 'sha256=' + createHmac('sha256', secreto)
    .update(`${fecha}.`)
    .update(cuerpoCrudo)
    .digest('hex');

  // En tiempo constante: una comparación común filtra información por el tiempo que tarda.
  const a = Buffer.from(esperada);
  const b = Buffer.from(recibida);
  return a.length === b.length && timingSafeEqual(a, b);
}
