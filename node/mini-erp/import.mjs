// El importador: del .zip del respaldo al almacén. Acepta solo la forma de un respaldo de Portabilidad
// y rechaza todo lo demás con ErrorDeImportacion, sin tocar lo que ya estaba importado:
//
//   mipyme-backup-<RUT>/ventas.json, compras.json, clientes.json, proveedores.json, productos.json
//   mipyme-backup-<RUT>/faltantes.json                    (solo si hubo documentos que no se pudieron bajar)
//   mipyme-backup-<RUT>/emitidos/<RUT>_<TIPO>_<FOLIO>.xml|.pdf
//   mipyme-backup-<RUT>/recibidos/<RUT_EMISOR>_<TIPO>_<FOLIO>.xml|.pdf
//
// El .zip lo arma un tercero y llega por la red: ningún nombre de archivo del .zip se usa como ruta en
// el disco. Los nombres en disco son fijos (los JSON) o salen del id de cada documento, validado.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { FORMA_DEL_ID, SENTIDOS } from './store.mjs';

// El respaldo de una empresa con varios años de documentos pesa cientos de MB. Este ejemplo lo lee
// entero en memoria y pone un tope; su sistema lo procesaría por partes, desde el disco.
export const TOPE_DE_BYTES = 50 * 1024 * 1024;
// Lo descomprimido, por si el .zip es una bomba: los PDF casi no se comprimen, los JSON sí.
const TOPE_DESCOMPRIMIDO = 4 * TOPE_DE_BYTES;
// Entradas del .zip. Un respaldo de 50 MB, con cada documento en un XML y un PDF de al menos un par
// de KB, no llega a 40.000.
export const TOPE_DE_ENTRADAS = 50_000;

const OBLIGATORIOS = ['ventas', 'compras', 'clientes', 'proveedores', 'productos'];
const OPCIONALES = ['faltantes'];
// Regla E4 del respaldo: {RUT_EMISOR}_{TIPO}_{FOLIO}.xml|.pdf, sin subcarpetas.
const NOMBRE_DE_DOCUMENTO = /^(\d{7,8}-[0-9K])_\d+_\d+\.(xml|pdf)$/;
// Sin compresión (stored) o deflate: lo único que arma un respaldo.
const COMPRESIONES = [0, 8];

export class ErrorDeImportacion extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorDeImportacion';
  }
}

const rechazar = (mensaje) => {
  throw new ErrorDeImportacion(mensaje);
};

// Un nombre sacado del .zip, para un mensaje: corto y sin caracteres de control.
const citar = (nombre) => JSON.stringify(nombre.length > 80 ? `${nombre.slice(0, 80)}…` : nombre);

// rut: el de la empresa de la sesión, nunca uno que venga en el aviso o en el .zip.
// bytesEsperados: el `bytes` del aviso. Un .zip de otro tamaño se rechaza antes de abrirlo.
export async function importarRespaldo(bytes, { rut, bytesEsperados, almacen }) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('importarRespaldo: bytes debe ser un Buffer o un Uint8Array.');
  if (!rutValido(rut)) throw new TypeError('importarRespaldo: rut debe ser un RUT válido, como 11111111-1.');

  if (bytes.length > TOPE_DE_BYTES) rechazar(`El respaldo pesa ${bytes.length} bytes: este ejemplo importa hasta ${TOPE_DE_BYTES}.`);
  if (!Number.isSafeInteger(bytesEsperados)) rechazar('Falta el tamaño del respaldo que trae el aviso (bytes).');
  if (bytes.length !== bytesEsperados) rechazar(`El respaldo descargado pesa ${bytes.length} bytes y el aviso dice ${bytesEsperados}.`);

  const zip = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  const raiz = `mipyme-backup-${rut}`;
  const indice = leerIndice(zip, raiz, rut);
  const contenido = descomprimir(zip, indice);

  const json = {};
  for (const nombre of [...OBLIGATORIOS, ...OPCIONALES]) {
    const datos = contenido[`${raiz}/${nombre}.json`];
    if (datos) json[nombre] = { datos, valor: leerJson(datos, nombre, rut) };
  }
  const documentos = Object.entries(SENTIDOS).map(([sentido, nombre]) => [sentido, idsDeDocumentos(json[nombre].valor, nombre, sentido, rut)]);

  const nueva = almacen.carpetaNueva();
  try {
    for (const [nombre, { datos }] of Object.entries(json)) await writeFile(join(nueva, `${nombre}.json`), datos);
    for (const [sentido, ids] of documentos) {
      await mkdir(join(nueva, sentido));
      for (const id of ids) {
        for (const tipo of ['xml', 'pdf']) {
          // Un documento sin su archivo en el .zip queda sin él: el ERP lo muestra igual.
          const archivo = contenido[`${raiz}/${sentido}/${id}.${tipo}`];
          if (archivo) await writeFile(join(nueva, sentido, `${id}.${tipo}`), archivo);
        }
      }
    }
    almacen.reemplazar(nueva);
  } catch (error) {
    await rm(nueva, { recursive: true, force: true });
    throw error;
  }
  return almacen.resumen();
}

// Los nombres y tamaños declarados de cada entrada, sin descomprimir nada. Cada entrada se revisa al
// leerla, no al final: el índice de un .zip dice cuántas entradas trae (hasta 2^32 - 1 con ZIP64) y
// fflate no comprueba la firma de cada cabecera, así que unos pocos bytes pueden fabricar entradas
// vacías sin fin. La primera que no es de un respaldo corta la lectura, y el tope de entradas la
// acota de todos modos.
function leerIndice(zip, raiz, rut) {
  const entradas = [];
  const vistos = new Set();
  let descomprimido = 0;
  const revisar = ({ name: nombre, originalSize, compression }) => {
    if (entradas.length >= TOPE_DE_ENTRADAS) rechazar(`El .zip trae más de ${TOPE_DE_ENTRADAS} entradas.`);
    if (vistos.has(nombre)) rechazar(`El .zip trae dos veces ${citar(nombre)}.`);
    vistos.add(nombre);
    // Lo que en algún sistema escapa de la carpeta donde se descomprime: rutas absolutas, unidades de
    // Windows, barras invertidas, bytes nulos y segmentos . o ..
    const partes = nombre.split('/');
    if (/[\\\0]/.test(nombre) || nombre.startsWith('/') || /^[A-Za-z]:/.test(nombre) || partes.some((parte) => parte === '..' || parte === '.')) {
      rechazar(`El .zip trae una ruta no permitida: ${citar(nombre)}.`);
    }
    if (partes[0] !== raiz) rechazar(`El .zip debe tener una sola carpeta raíz, ${raiz}/, y trae ${citar(partes[0])}.`);
    if (!entradaPermitida(partes.slice(1), rut)) rechazar(`El .zip trae un archivo que no va en un respaldo: ${citar(nombre)}.`);
    if (!COMPRESIONES.includes(compression)) rechazar(`El .zip usa una compresión que no es de un respaldo en ${citar(nombre)}.`);
    descomprimido += originalSize;
    if (descomprimido > TOPE_DESCOMPRIMIDO) rechazar(`El .zip descomprimido pasa de ${TOPE_DESCOMPRIMIDO} bytes.`);
    entradas.push({ nombre, originalSize });
  };
  try {
    unzipSync(zip, {
      filter: (entrada) => {
        revisar(entrada);
        return false;
      },
    });
  } catch (error) {
    // El rechazo de una entrada sale tal cual; lo demás es fflate que no pudo leer el índice.
    if (error instanceof ErrorDeImportacion) throw error;
    rechazar('El archivo no es un .zip legible.');
  }
  for (const nombre of OBLIGATORIOS) {
    if (!vistos.has(`${raiz}/${nombre}.json`)) rechazar(`Al respaldo le falta ${nombre}.json.`);
  }
  return entradas;
}

// Lo que va dentro de la raíz: los JSON, las carpetas emitidos/ y recibidos/, y en ellas solo
// documentos con nombre de la regla E4; en emitidos/, del RUT de la empresa. Una carpeta llega como
// una entrada que termina en / (partes con un último segmento vacío).
function entradaPermitida(partes, rut) {
  const [primera, segunda, ...resto] = partes;
  if (partes.length === 1) return primera === '' || [...OBLIGATORIOS, ...OPCIONALES].some((nombre) => primera === `${nombre}.json`);
  if (!Object.hasOwn(SENTIDOS, primera) || resto.length > 0) return false;
  if (segunda === '') return true;
  const documento = NOMBRE_DE_DOCUMENTO.exec(segunda);
  return documento !== null && rutValido(documento[1]) && (primera !== 'emitidos' || documento[1] === rut);
}

// Todo el contenido, ya revisados los nombres. Una entrada que no da el tamaño que declara está dañada.
function descomprimir(zip, indice) {
  let contenido;
  try {
    contenido = unzipSync(zip);
  } catch {
    rechazar('El .zip está dañado: no se pudo descomprimir.');
  }
  for (const { nombre, originalSize } of indice) {
    if (contenido[nombre]?.length !== originalSize) rechazar(`El .zip está dañado en ${citar(nombre)}.`);
  }
  return contenido;
}

function leerJson(datos, nombre, rut) {
  let valor;
  try {
    valor = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(datos));
  } catch {
    rechazar(`${nombre}.json no es un JSON válido.`);
  }
  if (valor === null || typeof valor !== 'object' || !Array.isArray(valor.items)) rechazar(`${nombre}.json no tiene la forma de un respaldo.`);
  if (valor.empresa?.rut !== rut) rechazar(`${nombre}.json es de otra empresa.`);
  return valor;
}

// Los id de ventas (emitidos) o compras (recibidos): con la forma {RUT}_{TIPO}_{FOLIO}, sin repetir y,
// en emitidos, del RUT de la empresa. Son los que forman los nombres en el disco.
function idsDeDocumentos(valor, nombre, sentido, rut) {
  const ids = new Set();
  for (const item of valor.items) {
    const id = item?.id;
    const valido = typeof id === 'string' && FORMA_DEL_ID.test(id) && rutValido(id.split('_')[0]) && (sentido !== 'emitidos' || id.startsWith(`${rut}_`));
    if (!valido) rechazar(`${nombre}.json trae un documento con un id que no es {RUT}_{TIPO}_{FOLIO}.`);
    if (ids.has(id)) rechazar(`${nombre}.json trae dos veces el documento ${id}.`);
    ids.add(id);
  }
  return ids;
}

// Formato 12345678-5 y dígito verificador de módulo 11.
function rutValido(rut) {
  const partes = /^(\d{7,8})-([0-9K])$/.exec(typeof rut === 'string' ? rut : '');
  if (!partes) return false;
  let suma = 0;
  let factor = 2;
  for (const digito of [...partes[1]].reverse()) {
    suma += Number(digito) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  return partes[2] === (resto === 11 ? '0' : resto === 10 ? 'K' : String(resto));
}
