// El almacén de archivos del Mini ERP: el respaldo importado y el estado del aviso, en una carpeta
// (datos/, fuera de git). En su sistema esto es su base de datos; acá son archivos para que el
// ejemplo no instale nada.
//
//   <carpeta>/actual/            el juego de datos importado: los JSON del respaldo, emitidos/ y recibidos/
//   <carpeta>/estado.json        en qué va el aviso: { fase, detalle, respaldoId }
//   <carpeta>/.importando-*/     un juego nuevo que el importador está escribiendo
//   <carpeta>/.anterior-*/       el juego viejo, apartado durante un reemplazo
//
// Este archivo no sabe leer un .zip: eso es import.mjs, que escribe un juego nuevo en una carpeta
// temporal y llama a reemplazar.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Los JSON de un respaldo. leer no abre ningún otro archivo.
export const JSON_DEL_RESPALDO = ['ventas', 'compras', 'clientes', 'proveedores', 'productos', 'faltantes'];
// Cada sentido de los documentos y el JSON que los lista.
export const SENTIDOS = { emitidos: 'ventas', recibidos: 'compras' };
// El id de un documento: {RUT_EMISOR}_{TIPO}_{FOLIO}. Es lo único que forma un nombre de archivo.
export const FORMA_DEL_ID = /^\d{7,8}-[0-9K]_\d+_\d+$/;

const FASES = ['vacio', 'esperando', 'importando', 'listo', 'error'];
const TIPOS_DE_ARCHIVO = ['xml', 'pdf'];
const TEMPORAL = '.importando-';
const APARTADA = '.anterior-';

export function abrirAlmacen(carpeta) {
  const actual = join(carpeta, 'actual');
  const archivoDeEstado = join(carpeta, 'estado.json');
  // Los JSON ya leídos, hasta el próximo reemplazo. Solo este proceso escribe en la carpeta.
  let leidos = new Map();

  mkdirSync(carpeta, { recursive: true });
  recuperar();

  // Un corte a mitad de un reemplazo deja el juego viejo apartado: vuelve a su lugar. Lo demás que
  // quedó a medias (un juego nuevo sin terminar, un estado sin renombrar) se borra.
  function recuperar() {
    const nombres = readdirSync(carpeta);
    const apartadas = nombres.filter((nombre) => nombre.startsWith(APARTADA)).sort();
    if (!existsSync(actual) && apartadas.length > 0) renameSync(join(carpeta, apartadas.pop()), actual);
    for (const nombre of [...apartadas, ...nombres.filter((nombre) => nombre.startsWith(TEMPORAL) || nombre === 'estado.json.tmp')]) {
      rmSync(join(carpeta, nombre), { recursive: true, force: true });
    }
  }

  function leer(nombre) {
    if (!JSON_DEL_RESPALDO.includes(nombre)) return null;
    if (!leidos.has(nombre)) {
      let contenido = null;
      try {
        contenido = JSON.parse(readFileSync(join(actual, `${nombre}.json`), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      leidos.set(nombre, contenido);
    }
    return leidos.get(nombre);
  }

  // El documento con ese id en ventas (emitidos) o en compras (recibidos), o null.
  function documento(sentido, id) {
    if (!Object.hasOwn(SENTIDOS, sentido)) return null;
    return leer(SENTIDOS[sentido])?.items.find((item) => item.id === id) ?? null;
  }

  // El XML o el PDF de un documento, como Buffer, o null. La ruta se arma solo con un id que tiene la
  // forma {RUT}_{TIPO}_{FOLIO}: un id con / o .. nunca llega al disco.
  function archivo(sentido, id, tipo) {
    if (!Object.hasOwn(SENTIDOS, sentido) || !TIPOS_DE_ARCHIVO.includes(tipo)) return null;
    if (typeof id !== 'string' || !FORMA_DEL_ID.test(id)) return null;
    try {
      return readFileSync(join(actual, sentido, `${id}.${tipo}`));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  function resumen() {
    const cuantos = (nombre) => leer(nombre)?.items.length ?? 0;
    const empresa = leer('ventas')?.empresa;
    return {
      empresa: empresa ? { rut: empresa.rut, razon_social: empresa.razon_social } : null,
      productos: cuantos('productos'),
      clientes: cuantos('clientes'),
      proveedores: cuantos('proveedores'),
      ventas: cuantos('ventas'),
      compras: cuantos('compras'),
    };
  }

  // Una carpeta vacía, hermana de actual, donde el importador escribe el juego nuevo. Está en el mismo
  // disco, así que reemplazar es un rename.
  function carpetaNueva() {
    return mkdtempSync(join(carpeta, TEMPORAL));
  }

  // El juego de carpetaNueva pasa a ser el actual, entero o nada: el viejo se aparta, el nuevo entra
  // con un rename y recién ahí el viejo se borra. Si el rename falla, el viejo vuelve.
  function reemplazar(nueva) {
    const apartada = join(carpeta, `${APARTADA}${Date.now()}-${process.pid}`);
    const habia = existsSync(actual);
    if (habia) renameSync(actual, apartada);
    try {
      renameSync(nueva, actual);
    } catch (error) {
      if (habia) renameSync(apartada, actual);
      throw error;
    } finally {
      leidos = new Map();
    }
    if (habia) rmSync(apartada, { recursive: true, force: true });
  }

  // Borra lo importado y el estado: el ERP vuelve a empezar.
  function borrar() {
    rmSync(actual, { recursive: true, force: true });
    rmSync(archivoDeEstado, { force: true });
    leidos = new Map();
  }

  // Sin estado anotado, el estado sale de si hay datos.
  function estado() {
    try {
      return JSON.parse(readFileSync(archivoDeEstado, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { fase: existsSync(actual) ? 'listo' : 'vacio', detalle: null, respaldoId: null };
    }
  }

  // Anota el estado completo. Sin respaldoId se conserva el anterior (null lo borra); el detalle,
  // en cambio, es de esta fase y por omisión es null. Se escribe aparte y se renombra, para que un
  // corte nunca deje un estado.json a medias.
  function anotar({ fase, detalle = null, respaldoId }) {
    if (!FASES.includes(fase)) throw new TypeError(`anotar: la fase debe ser una de ${FASES.join(', ')}.`);
    const nuevo = {
      fase,
      detalle: detalle === null ? null : String(detalle),
      respaldoId: respaldoId === undefined ? estado().respaldoId : respaldoId === null ? null : String(respaldoId),
    };
    writeFileSync(`${archivoDeEstado}.tmp`, JSON.stringify(nuevo));
    renameSync(`${archivoDeEstado}.tmp`, archivoDeEstado);
    return nuevo;
  }

  return { leer, documento, archivo, resumen, carpetaNueva, reemplazar, borrar, estado, anotar };
}
