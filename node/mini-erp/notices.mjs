// Los avisos de Enrolamiento y la descarga del respaldo. Dos rutas, porque cada evento es una
// suscripción con su propio secreto:
//
//   POST /webhooks/certificacion   certificacion.finalizada, firmada con ENROLAMIENTO_WEBHOOK_SECRETO
//   POST /webhooks/respaldo        respaldo.finalizado, con ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO (opcional)
//
// El receptor verifica la firma, responde enseguida (la API espera 10 segundos) y descarga e importa
// después. Nunca se escribe en un log ni en el estado la cabecera Authorization ni la URL firmada.

import { ErrorDeConfiguracion, ErrorDeFirma, webhooks } from 'enrolamiento';
import { RUT_DE_LA_EMPRESA } from './config.mjs';
import { ErrorDeImportacion, importarRespaldo, TOPE_DE_BYTES } from './import.mjs';

// Un aviso pesa menos de 1 KB: más que esto no es un aviso.
export const TOPE_DEL_AVISO = 1024 * 1024;
// Cuánto se espera a la API por la URL firmada, y al almacenamiento por el archivo.
const ESPERA_DE_LA_API_MS = 30_000;
const ESPERA_DEL_ARCHIVO_MS = 5 * 60_000;
const LOCALES = ['127.0.0.1', 'localhost'];

export class ErrorDeDescarga extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorDeDescarga';
  }
}

const fallar = (mensaje) => {
  throw new ErrorDeDescarga(mensaje);
};

function leerUrl(texto) {
  if (typeof texto !== 'string') return null;
  try {
    const url = new URL(texto);
    // Una URL con usuario o contraseña nunca es la de la API: http://localhost@evil.test va a evil.test.
    return url.username === '' && url.password === '' ? url : null;
  } catch {
    return null;
  }
}

const esLocal = (url) => (url.protocol === 'http:' || url.protocol === 'https:') && LOCALES.includes(url.hostname);

// A qué direcciones se mandan su usuario y su APIKey. En modo real, solo a la API configurada y por
// https; en modo prueba, además, a esta máquina, donde el CLI del paquete imita la descarga.
export function hostPermitido(url, { modo, urlBase }) {
  const pedida = leerUrl(url);
  if (pedida === null) return false;
  const api = leerUrl(urlBase);
  if (api !== null && api.protocol === 'https:' && pedida.protocol === 'https:' && pedida.host === api.host) return true;
  return modo === 'prueba' && esLocal(pedida);
}

// La URL firmada se pide sin credenciales, pero igual solo por https (o local, en modo prueba).
const firmadaPermitida = (url, modo) => url !== null && (url.protocol === 'https:' || (modo === 'prueba' && esLocal(url)));

// Un pedido con su propio tiempo de espera, sin seguir redirecciones. Un error de red se cuenta con un
// texto fijo: el de fetch podría traer la dirección, y la del archivo es la URL firmada.
async function pedir(url, opciones, espera, queSePide) {
  try {
    return await fetch(url, { ...opciones, redirect: 'manual', signal: AbortSignal.timeout(espera) });
  } catch (error) {
    fallar(error?.name === 'TimeoutError' ? `Se agotó la espera al pedir ${queSePide}.` : `No se pudo conectar al pedir ${queSePide}.`);
  }
}

function exigir200(respuesta, queSePide) {
  if (respuesta.status >= 300 && respuesta.status < 400) fallar(`Al pedir ${queSePide} la respuesta fue una redirección (${respuesta.status}), y no se siguen.`);
  if (respuesta.status !== 200) fallar(`Al pedir ${queSePide} la respuesta fue ${respuesta.status}.`);
}

// Lee el archivo hasta `bytes` y ni uno más: un archivo de otro tamaño se corta y se rechaza.
async function leerArchivo(respuesta, bytes) {
  const largo = respuesta.headers.get('content-length');
  if (largo !== null && Number(largo) !== bytes) {
    await respuesta.body?.cancel();
    fallar(`El archivo pesa ${largo} bytes y el aviso dice ${bytes}.`);
  }
  const trozos = [];
  let total = 0;
  try {
    for await (const trozo of respuesta.body ?? []) {
      total += trozo.length;
      if (total > bytes) fallar(`El archivo pesa más de los ${bytes} bytes que dice el aviso.`);
      trozos.push(trozo);
    }
  } catch (error) {
    if (error instanceof ErrorDeDescarga) throw error;
    fallar('Se cortó la descarga del archivo.');
  }
  if (total !== bytes) fallar(`El archivo pesa ${total} bytes y el aviso dice ${bytes}.`);
  return Buffer.concat(trozos, total);
}

// La descarga, como la describe la guía «Respaldo MiPyme» (§Descargar): la url del aviso, con
// ?formato=json y Authorization: Basic, entrega una URL firmada; el archivo se baja de ahí con otro
// GET, sin Authorization. Todo se revisa antes de mandar las credenciales.
export async function descargarRespaldo(url, { credenciales, bytesEsperados, config }) {
  if (!hostPermitido(url, config)) {
    fallar(
      config.modo === 'real'
        ? `La url del respaldo no es de la API configurada (${config.urlBase}): no se le mandan las credenciales.`
        : `La url del respaldo no es de la API configurada (${config.urlBase}) ni de esta máquina: no se le mandan las credenciales.`,
    );
  }
  if (!Number.isSafeInteger(bytesEsperados) || bytesEsperados <= 0) fallar('El aviso no trae el tamaño del respaldo (bytes).');
  if (bytesEsperados > TOPE_DE_BYTES) fallar(`El respaldo pesa ${bytesEsperados} bytes: este ejemplo importa hasta ${TOPE_DE_BYTES}.`);
  if (!credenciales?.usuario || !credenciales?.apikey) {
    fallar('Faltan las credenciales para descargar el respaldo: defina ENROLAMIENTO_USUARIO y ENROLAMIENTO_APIKEY en el .env.');
  }

  const pedida = new URL(url);
  pedida.searchParams.set('formato', 'json');
  const autorizacion = `Basic ${Buffer.from(`${credenciales.usuario}:${credenciales.apikey}`, 'utf8').toString('base64')}`;
  const deLaApi = await pedir(pedida, { headers: { Authorization: autorizacion, Accept: 'application/json' } }, ESPERA_DE_LA_API_MS, 'la URL del respaldo');
  exigir200(deLaApi, 'la URL del respaldo');
  let firmada;
  try {
    firmada = leerUrl((await deLaApi.json())?.url);
  } catch {
    firmada = null;
  }
  if (!firmadaPermitida(firmada, config.modo)) fallar('La API no entregó una URL firmada https para el archivo.');

  // Sin Authorization: la URL lleva su propia firma, y el almacenamiento rechaza un pedido con las dos.
  const archivo = await pedir(firmada, {}, ESPERA_DEL_ARCHIVO_MS, 'el archivo');
  exigir200(archivo, 'el archivo');
  return leerArchivo(archivo, bytesEsperados);
}

// El cuerpo crudo del pedido, como Buffer, o null si pasa el tope. La firma cubre sus bytes exactos.
export function leerCuerpo(flujo, tope = TOPE_DEL_AVISO) {
  return new Promise((listo, fallo) => {
    const trozos = [];
    let total = 0;
    const alLeer = (trozo) => {
      total += trozo.length;
      if (total > tope) {
        flujo.off('data', alLeer);
        flujo.off('end', alTerminar);
        flujo.resume();
        listo(null);
        return;
      }
      trozos.push(trozo);
    };
    const alTerminar = () => listo(Buffer.concat(trozos, total));
    flujo.on('data', alLeer);
    flujo.once('end', alTerminar);
    flujo.once('error', fallo);
  });
}

// El id del respaldo, de su url: /v1/respaldos/{id}/descargar. Con él, el mismo respaldo que llega por
// las dos rutas se importa una vez.
function idDelRespaldo(url) {
  const pedida = leerUrl(url);
  return /\/respaldos\/([0-9A-Za-z_-]{1,64})\/descargar$/.exec(pedida?.pathname ?? '')?.[1] ?? null;
}

// El código de un respaldo fallido, para mostrarlo: solo si tiene la forma de un código.
const codigoDe = (respaldo) => (typeof respaldo?.codigo === 'string' && /^[A-Z0-9_]{1,60}$/.test(respaldo.codigo) ? respaldo.codigo : 'sin código');

const RUTAS = {
  '/webhooks/certificacion': { secreto: 'secretoCertificacion', variable: 'ENROLAMIENTO_WEBHOOK_SECRETO', opcional: false },
  '/webhooks/respaldo': { secreto: 'secretoRespaldo', variable: 'ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO', opcional: true },
};

const EVENTOS = ['certificacion.finalizada', 'respaldo.finalizado'];

// credenciales: { usuario, apikey }, para pedir la URL firmada. registro: dónde se escriben los avisos
// (por omisión, la consola).
export function crearReceptor({ config, almacen, credenciales, registro = console }) {
  // Un aviso puede llegar más de una vez. En su sistema, guarde los id en su base de datos: este Set se
  // pierde al reiniciar el proceso.
  const vistos = new Set();

  // Una importación que quedó a medias es de un proceso anterior que se cortó: lo importado antes sigue
  // intacto, y el mismo respaldo se puede volver a intentar.
  if (almacen.estado().fase === 'importando') {
    almacen.anotar({ fase: 'error', detalle: 'Se cortó la importación del respaldo al reiniciar el Mini ERP: vuelva a enviar el aviso.' });
  }

  const ok = (despues) => ({ status: 200, cuerpo: { recibido: true }, ...(despues ? { despues } : {}) });

  // Responde enseguida. Lo lento (descargar e importar) va en `despues`, que el servidor no espera.
  function recibir(ruta, cuerpoCrudo, cabeceras) {
    const deLaRuta = Object.hasOwn(RUTAS, ruta) ? RUTAS[ruta] : null;
    if (deLaRuta === null) return { status: 404, cuerpo: { error: 'NO_EXISTE' } };
    const secreto = config[deLaRuta.secreto];
    // respaldo.finalizado es una suscripción aparte: sin su secreto, su ruta no existe.
    if (secreto === null && deLaRuta.opcional) return { status: 404, cuerpo: { error: 'NO_EXISTE' } };
    if (secreto === null) return sinSecreto(deLaRuta.variable);

    let evento;
    try {
      // Siempre con el secreto de config: sin él, verificar tomaría ENROLAMIENTO_WEBHOOK_SECRETO del entorno.
      evento = webhooks.verificar(cuerpoCrudo, cabeceras, { secreto });
    } catch (error) {
      if (error instanceof ErrorDeFirma) {
        registro.error(`Aviso rechazado en ${ruta}: ${error.message}`);
        return { status: 400, cuerpo: { error: 'FIRMA_INVALIDA', mensaje: error.message } };
      }
      if (error instanceof ErrorDeConfiguracion) return sinSecreto(deLaRuta.variable);
      throw error;
    }
    return ok(procesar(evento));
  }

  function sinSecreto(variable) {
    const mensaje = `Falta ${variable} en el .env: el secreto de firma de esta suscripción (Mi Cuenta › Notificaciones). Defínalo y reinicie el Mini ERP.`;
    registro.error(`Aviso sin verificar: ${mensaje}`);
    return { status: 503, cuerpo: { error: 'SIN_SECRETO', mensaje } };
  }

  // Devuelve el trabajo de después, o nada si el aviso no pide trabajo.
  function procesar(evento) {
    // La API puede agregar eventos: uno que no se conoce (o el de «Enviar prueba») se ignora.
    if (!EVENTOS.includes(evento.evento)) return;
    if (typeof evento.id === 'string') {
      if (vistos.has(evento.id)) return;
      vistos.add(evento.id);
    }
    // El RUT es el de la empresa de la sesión, nunca el que trae el aviso.
    if (evento.rut !== RUT_DE_LA_EMPRESA) return;
    const estado = almacen.estado();
    // Sin una sesión creada no hay recorrido en curso que esperara este aviso.
    if (estado.fase === 'vacio') return;

    const respaldo = evento.respaldo ?? null;
    if (respaldo === null) {
      almacen.anotar({ fase: 'error', detalle: 'La certificación terminó sin respaldo: la cuenta no tiene el respaldo contratado o la empresa no es MiPyme.' });
      return;
    }
    switch (respaldo.estado) {
      case 'en_proceso':
        almacen.anotar({
          fase: 'esperando',
          detalle:
            config.secretoRespaldo === null
              ? 'El respaldo sigue armándose: llega en el aviso respaldo.finalizado, que este Mini ERP recibe si define ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO.'
              : 'El respaldo sigue armándose: llega en el aviso respaldo.finalizado.',
        });
        return;
      case 'fallido':
        almacen.anotar({ fase: 'error', detalle: `El respaldo falló: ${codigoDe(respaldo)}.` });
        return;
      case 'vencido':
        almacen.anotar({ fase: 'error', detalle: 'El respaldo venció: pasó su disponible_hasta y ya no se entrega.' });
        return;
      case 'listo':
        return importar(respaldo, estado);
      default:
        return;
    }
  }

  function importar(respaldo, estado) {
    const respaldoId = idDelRespaldo(respaldo.url);
    // El mismo respaldo por la otra ruta: ya se importó o se está importando. Si falló, se reintenta.
    if (respaldoId !== null && respaldoId === estado.respaldoId && (estado.fase === 'importando' || estado.fase === 'listo')) return;
    // Se anota antes de responder: un aviso que llega mientras tanto ya lo ve.
    almacen.anotar({ fase: 'importando', respaldoId });
    return (async () => {
      try {
        const bytes = await descargarRespaldo(respaldo.url, { credenciales, bytesEsperados: respaldo.bytes, config });
        const resumen = await importarRespaldo(bytes, { rut: RUT_DE_LA_EMPRESA, bytesEsperados: respaldo.bytes, almacen });
        almacen.anotar({ fase: 'listo', detalle: `Respaldo importado: ${resumen.ventas} ventas y ${resumen.compras} compras.`, respaldoId });
        registro.log(`Respaldo importado: ${resumen.ventas} ventas y ${resumen.compras} compras.`);
      } catch (error) {
        // Lo importado antes queda intacto: el importador reemplaza todo o nada.
        const conocido = error instanceof ErrorDeDescarga || error instanceof ErrorDeImportacion;
        const detalle = conocido ? error.message : 'Falló la importación del respaldo. Mire la consola del servidor.';
        almacen.anotar({ fase: 'error', detalle, respaldoId });
        registro.error(conocido ? `No se importó el respaldo: ${detalle}` : error);
      }
    })();
  }

  return { recibir };
}
