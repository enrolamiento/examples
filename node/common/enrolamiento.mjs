// Lo mínimo para llamar a la API de Enrolamiento: la credencial y cómo leer un error.
// Sin dependencias: usa el fetch de Node 22.

const URL_BASE = process.env.ENROLAMIENTO_URL ?? 'https://api.enrolamiento.cl';

function credencial() {
  const usuario = process.env.ENROLAMIENTO_USUARIO;
  const apikey = process.env.ENROLAMIENTO_APIKEY;
  if (!usuario || !apikey) {
    throw new Error('Faltan ENROLAMIENTO_USUARIO y ENROLAMIENTO_APIKEY. Copie .env.example a .env y complételo.');
  }
  // El esquema se escribe exactamente "Basic": la API distingue mayúsculas.
  return 'Basic ' + Buffer.from(`${usuario}:${apikey}`).toString('base64');
}

// Hace un GET a la API. Devuelve la Response tal cual: quien llama decide qué hacer con el status.
export function consultar(ruta) {
  return fetch(URL_BASE + ruta, {
    headers: { Authorization: credencial(), Accept: 'application/json' },
  });
}

// Clasifica la respuesta de error de la API en su familia y, si lo hay, extrae el código.
// Decida siempre por el código, nunca por el status ni por el texto del mensaje:
// los rechazos de negocio llegan como HTTP 500 aunque no sean fallas.
// https://developers.enrolamiento.cl/docs/errores-y-reintentos/
export async function leerError(respuesta) {
  const texto = await respuesta.text();
  const codigoEnCabecera = respuesta.headers.get('X-Codigo-Error');

  // Un 409 sin X-Codigo-Error es el rate limit; con él, es un error de negocio.
  if (respuesta.status === 409 && !codigoEnCabecera) return { familia: 'rate-limit', texto };
  if (respuesta.status === 401) return { familia: 'autenticacion', texto };
  // La capa de entrada cortó a los 60 s: no es de la API, y el pedido puede seguir en curso.
  if (respuesta.status === 504 && !codigoEnCabecera) return { familia: 'tiempo-agotado', texto };

  if (codigoEnCabecera) {
    const mensaje = texto.startsWith(codigoEnCabecera + ':') ? texto.slice(codigoEnCabecera.length + 1) : texto;
    return { familia: 'negocio', codigo: codigoEnCabecera, mensaje, reintentable: respuesta.headers.get('X-Reintentable') };
  }

  if (texto.trimStart().startsWith('{')) {
    try {
      const json = JSON.parse(texto);
      if (typeof json.Message === 'string') return { familia: 'framework', mensaje: json.Message };
    } catch {
      // No era JSON: se sigue como texto plano.
    }
  }

  // CODIGO:mensaje o CODIGO:SUBCODIGO:mensaje -- excepción
  const conCodigo = /^([A-Z][A-Z0-9_]*):(.*)$/s.exec(texto);
  if (conCodigo) return { familia: 'negocio', codigo: conCodigo[1], mensaje: conCodigo[2] };
  return { familia: 'negocio', codigo: null, mensaje: texto };
}
