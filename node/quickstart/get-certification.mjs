// Consulta la certificación de una empresa por su RUT.
// Es una lectura: no cambia nada y se puede repetir sin riesgo.
//
//   node --env-file=.env quickstart/get-certification.mjs 11111111-1

import Enrolamiento, {
  ErrorDeApi,
  ErrorDeAutenticacion,
  ErrorDeConfiguracion,
  ErrorDeLimite,
  EstadoCertificacion,
} from 'enrolamiento';

// El RUT de la empresa cliente que usted certifica, no el suyo como proveedor.
const rut = process.argv[2];
if (!rut) {
  console.error('Uso: node --env-file=.env quickstart/get-certification.mjs <RUT de la empresa>');
  process.exit(2);
}

// Los estados llegan como números; el SDK trae sus nombres.
const nombreDelEstado = (valor) =>
  Object.keys(EstadoCertificacion).find((nombre) => EstadoCertificacion[nombre] === valor) ?? 'desconocido';

// Lee ENROLAMIENTO_USUARIO y ENROLAMIENTO_APIKEY del entorno.
const enrolamiento = new Enrolamiento();

try {
  const certificacion = await enrolamiento.certificaciones.v1.consultar({ rut });
  console.log(`RUT:        ${certificacion.RUT}`);
  console.log(`Estado:     ${certificacion.Estado} (${nombreDelEstado(certificacion.Estado)})`);
  console.log(`Etapa:      ${certificacion.Etapa}`);
  console.log(`Comentario: ${certificacion.Comentario ?? ''}`);
} catch (error) {
  if (error instanceof ErrorDeConfiguracion) {
    // Faltan las credenciales, o un parámetro tiene otra forma: no se envió nada.
    console.error(error.message);
    process.exit(2);
  }
  if (error instanceof ErrorDeAutenticacion) {
    console.error('401: revise ENROLAMIENTO_USUARIO y ENROLAMIENTO_APIKEY.');
  } else if (error instanceof ErrorDeLimite) {
    console.error('409: se alcanzó el límite de llamadas. Espere al menos 60 segundos.');
  } else if (error instanceof ErrorDeApi && error.status === 404) {
    // La URL es correcta y no hay certificación para ese RUT. No es una falla de su integración.
    console.error(`No hay certificación para ${rut}: ${error.mensaje}`);
  } else if (error instanceof ErrorDeApi) {
    // Decida por el código, nunca por el status: los rechazos de negocio llegan como HTTP 500.
    console.error(`HTTP ${error.status}, código ${error.codigo}, reintentable ${error.reintentable}: ${error.mensaje}`);
  } else {
    // Sin respuesta de la API: falla de red o tiempo agotado.
    console.error(`${error.name}: ${error.message}`);
  }
  process.exit(1);
}
