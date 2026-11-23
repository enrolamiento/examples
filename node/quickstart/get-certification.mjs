// Consulta la certificación de una empresa por su RUT.
// Es una lectura: no cambia nada y se puede repetir sin riesgo.
//
//   node --env-file=.env quickstart/get-certification.mjs 11111111-1

import { consultar, leerError } from '../common/enrolamiento.mjs';

const ESTADOS = ['creada', 'en progreso', 'finalizada', 'con error'];

// El RUT de la empresa cliente que usted certifica, no el suyo como proveedor.
const rut = process.argv[2];
if (!rut) {
  console.error('Uso: node --env-file=.env quickstart/get-certification.mjs <RUT de la empresa>');
  process.exit(2);
}

let respuesta;
try {
  respuesta = await consultar(`/v1/certificaciones/${encodeURIComponent(rut)}/consultar`);
} catch (error) {
  // Falta la credencial o no hubo red: no hay respuesta de la API que leer.
  console.error(error.message);
  process.exit(2);
}

if (respuesta.ok) {
  const certificacion = await respuesta.json();
  // Los estados, etapas y pasos llegan como números, no como texto.
  console.log(`RUT:        ${certificacion.RUT}`);
  console.log(`Estado:     ${certificacion.Estado} (${ESTADOS[certificacion.Estado] ?? 'desconocido'})`);
  console.log(`Etapa:      ${certificacion.Etapa}`);
  console.log(`Comentario: ${certificacion.Comentario ?? ''}`);
  process.exit(0);
}

const error = await leerError(respuesta);

if (respuesta.status === 404 && error.familia === 'negocio') {
  // Texto plano que empieza con «No existe una certificación…»: la URL es correcta
  // y no hay certificación para ese RUT. Cualquier otro 404 es una URL mal escrita.
  console.error(`No hay certificación para ${rut}: ${error.mensaje}`);
} else if (error.familia === 'autenticacion') {
  // Con cuerpo, el header no llegó; sin cuerpo, la credencial no se aceptó. No se reintenta.
  console.error('401: revise ENROLAMIENTO_USUARIO y ENROLAMIENTO_APIKEY.');
} else if (error.familia === 'rate-limit') {
  console.error('409: se alcanzó el límite de llamadas. Espere al menos 60 segundos.');
} else {
  console.error(`HTTP ${respuesta.status}`, error);
}
process.exit(1);
