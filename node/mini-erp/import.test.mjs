// El importador ante el .zip de ejemplo del SDK y ante .zip armados acá con fflate: lo que acepta,
// lo que rechaza y que un rechazo nunca toca lo que ya estaba importado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { abrirAlmacen } from './store.mjs';
import { ErrorDeImportacion, importarRespaldo, TOPE_DE_BYTES, TOPE_DE_ENTRADAS } from './import.mjs';

const RUT = '11111111-1';
const RAIZ = `mipyme-backup-${RUT}`;
// El paquete no exporta sus assets: se lee el archivo instalado en node_modules.
const EJEMPLO = await readFile(new URL('../node_modules/enrolamiento/assets/respaldo-de-ejemplo.zip', import.meta.url));
const RESUMEN_DEL_EJEMPLO = {
  empresa: { rut: RUT, razon_social: 'Ferretería El Faro SpA' },
  productos: 12,
  clientes: 5,
  proveedores: 4,
  ventas: 20,
  compras: 10,
};

async function almacenDePrueba(t) {
  const carpeta = await mkdtemp(join(tmpdir(), 'mini-erp-importar-'));
  t.after(() => rm(carpeta, { recursive: true, force: true }));
  return { carpeta, almacen: abrirAlmacen(carpeta) };
}

const importar = (bytes, almacen, opciones = {}) => importarRespaldo(bytes, { rut: RUT, bytesEsperados: bytes.length, almacen, ...opciones });

// Las entradas del ejemplo, para armar variantes: { 'mipyme-backup-…/ventas.json': Uint8Array, … }.
const entradasDelEjemplo = () => unzipSync(new Uint8Array(EJEMPLO));
const armar = (entradas) => Buffer.from(zipSync(entradas, { level: 1 }));

// Una variante del ejemplo: cambia los nombres de las entradas o agrega una.
function variante(cambio) {
  const entradas = entradasDelEjemplo();
  cambio(entradas);
  return armar(entradas);
}

function renombrar(entradas, de, a) {
  entradas[a] = entradas[de];
  delete entradas[de];
}

test('el .zip de ejemplo se importa: 20 ventas, 10 compras, sus clientes, proveedores y productos', async (t) => {
  const { almacen } = await almacenDePrueba(t);
  const resumen = await importar(EJEMPLO, almacen);
  assert.deepEqual(resumen, RESUMEN_DEL_EJEMPLO);
  assert.deepEqual(almacen.resumen(), RESUMEN_DEL_EJEMPLO);
  assert.equal(almacen.documento('emitidos', '11111111-1_33_1201').folio, 1201);
  assert.equal(String(almacen.archivo('emitidos', '11111111-1_33_1201', 'pdf').subarray(0, 4)), '%PDF');
  assert.match(String(almacen.archivo('recibidos', '99999999-9_61_1290', 'xml')), /<DTE|<\?xml/);
});

test('importar dos veces el mismo .zip deja un solo juego de datos', async (t) => {
  const { carpeta, almacen } = await almacenDePrueba(t);
  await importar(EJEMPLO, almacen);
  await importar(EJEMPLO, almacen);
  assert.deepEqual(almacen.resumen(), RESUMEN_DEL_EJEMPLO);
  assert.deepEqual((await readdir(carpeta)).filter((nombre) => nombre !== 'estado.json'), ['actual']);
  const emitidos = await readdir(join(carpeta, 'actual', 'emitidos'));
  assert.equal(emitidos.length, 40);
});

test('archivo da null con un id que no existe o con ../', async (t) => {
  const { almacen } = await almacenDePrueba(t);
  await importar(EJEMPLO, almacen);
  assert.equal(almacen.archivo('emitidos', '11111111-1_33_9999', 'pdf'), null);
  assert.equal(almacen.archivo('emitidos', '../ventas', 'pdf'), null);
  assert.equal(almacen.archivo('emitidos', '../recibidos/99999999-9_61_1290', 'pdf'), null);
});

test('importar no toca el estado del aviso', async (t) => {
  const { almacen } = await almacenDePrueba(t);
  almacen.anotar({ fase: 'importando', respaldoId: 'rsp_1' });
  await importar(EJEMPLO, almacen);
  assert.deepEqual(almacen.estado(), { fase: 'importando', detalle: null, respaldoId: 'rsp_1' });
});

// Cada caso: un nombre y cómo arma los bytes y las opciones del intento malo.
const RECHAZOS = [
  ['un tamaño distinto de bytesEsperados', () => [EJEMPLO, { bytesEsperados: EJEMPLO.length + 1 }]],
  ['sin bytesEsperados', () => [EJEMPLO, { bytesEsperados: undefined }]],
  ['más de TOPE_DE_BYTES', () => {
    const grande = Buffer.alloc(TOPE_DE_BYTES + 1);
    return [grande, { bytesEsperados: grande.length }];
  }],
  ['bytes que no son un .zip', () => [Buffer.from('esto no es un zip, es texto')]],
  ['un .zip cortado', () => [EJEMPLO.subarray(0, EJEMPLO.length - 40)]],
  ['otra raíz', () => [variante((entradas) => {
    for (const nombre of Object.keys(entradas)) renombrar(entradas, nombre, nombre.replace(RAIZ, 'respaldo'));
  })]],
  ['una raíz con otro RUT', () => [variante((entradas) => {
    for (const nombre of Object.keys(entradas)) renombrar(entradas, nombre, nombre.replace(RAIZ, 'mipyme-backup-22222222-2'));
  })]],
  ['dos raíces', () => [variante((entradas) => {
    entradas['mipyme-backup-22222222-2/ventas.json'] = entradas[`${RAIZ}/ventas.json`];
  })]],
  ['una entrada con ..', () => [variante((entradas) => {
    entradas[`${RAIZ}/emitidos/../../escapado.pdf`] = strToU8('%PDF');
  })]],
  ['una ruta absoluta', () => [variante((entradas) => {
    entradas['/tmp/mini-erp-escapado.pdf'] = strToU8('%PDF');
  })]],
  ['una barra invertida', () => [variante((entradas) => {
    entradas[`${RAIZ}/emitidos\\11111111-1_33_1.pdf`] = strToU8('%PDF');
  })]],
  ['un nombre fuera de la regla E4', () => [variante((entradas) => {
    entradas[`${RAIZ}/emitidos/factura.pdf`] = strToU8('%PDF');
  })]],
  ['una subcarpeta en emitidos', () => [variante((entradas) => {
    entradas[`${RAIZ}/emitidos/2026/11111111-1_33_1201.pdf`] = strToU8('%PDF');
  })]],
  ['un emitido de otro RUT', () => [variante((entradas) => {
    entradas[`${RAIZ}/emitidos/22222222-2_33_1.pdf`] = strToU8('%PDF');
  })]],
  ['un RUT con dígito verificador malo', () => [variante((entradas) => {
    entradas[`${RAIZ}/recibidos/99999999-1_33_1.pdf`] = strToU8('%PDF');
  })]],
  ['un archivo extra en la raíz', () => [variante((entradas) => {
    entradas[`${RAIZ}/notas.txt`] = strToU8('hola');
  })]],
  ['un archivo de trabajo', () => [variante((entradas) => {
    entradas[`${RAIZ}/manifest.json`] = strToU8('{}');
  })]],
  ['sin productos.json', () => [variante((entradas) => {
    delete entradas[`${RAIZ}/productos.json`];
  })]],
  ['un JSON que no parsea', () => [variante((entradas) => {
    entradas[`${RAIZ}/clientes.json`] = strToU8('{"items": [');
  })]],
  ['un JSON de otra empresa', () => [variante((entradas) => {
    const compras = JSON.parse(Buffer.from(entradas[`${RAIZ}/compras.json`]).toString('utf8'));
    compras.empresa.rut = '22222222-2';
    entradas[`${RAIZ}/compras.json`] = strToU8(JSON.stringify(compras));
  })]],
  ['un documento con un id que no es {RUT}_{TIPO}_{FOLIO}', () => [variante((entradas) => {
    const ventas = JSON.parse(Buffer.from(entradas[`${RAIZ}/ventas.json`]).toString('utf8'));
    ventas.items[0].id = '../../estado';
    entradas[`${RAIZ}/ventas.json`] = strToU8(JSON.stringify(ventas));
  })]],
];

for (const [caso, armarIntento] of RECHAZOS) {
  test(`rechaza ${caso}, y lo importado antes sigue igual`, async (t) => {
    const { carpeta, almacen } = await almacenDePrueba(t);
    await importar(EJEMPLO, almacen);
    const pdfAntes = almacen.archivo('emitidos', '11111111-1_33_1201', 'pdf');
    const [bytes, opciones] = armarIntento();
    await assert.rejects(importar(bytes, almacen, opciones), ErrorDeImportacion);
    assert.deepEqual(almacen.resumen(), RESUMEN_DEL_EJEMPLO);
    assert.deepEqual(almacen.archivo('emitidos', '11111111-1_33_1201', 'pdf'), pdfAntes);
    // Ni la carpeta temporal del intento quedó.
    assert.deepEqual((await readdir(carpeta)).filter((nombre) => nombre !== 'estado.json'), ['actual']);
  });
}

// Unos 100 bytes que dicen traer 2^32 - 1 entradas: un registro ZIP64 de fin de directorio, su
// localizador y el fin de directorio clásico, con el directorio central apuntando al final del
// archivo. fflate no revisa la firma de cada cabecera: más allá de los datos lee ceros y entrega
// entradas de nombre vacío una tras otra. Guardarlas todas antes de revisarlas agota la memoria.
function zip64ConMillonesDeEntradas() {
  const bytes = Buffer.alloc(56 + 20 + 22);
  // Registro ZIP64 de fin de directorio, en el byte 0.
  bytes.writeUInt32LE(0x06064b50, 0);
  bytes.writeBigUInt64LE(44n, 4);
  bytes.writeBigUInt64LE(0xffffffffn, 24);
  bytes.writeBigUInt64LE(0xffffffffn, 32);
  bytes.writeBigUInt64LE(BigInt(bytes.length), 48);
  // Localizador ZIP64: dónde está el registro.
  bytes.writeUInt32LE(0x07064b50, 56);
  bytes.writeBigUInt64LE(0n, 64);
  bytes.writeUInt32LE(1, 72);
  // Fin de directorio clásico, con los campos en 0xFFFF… para remitir al ZIP64.
  bytes.writeUInt32LE(0x06054b50, 76);
  bytes.writeUInt16LE(0xffff, 84);
  bytes.writeUInt16LE(0xffff, 86);
  bytes.writeUInt32LE(0xffffffff, 88);
  bytes.writeUInt32LE(0xffffffff, 92);
  return bytes;
}

test('un ZIP64 que declara 2^32 - 1 entradas se rechaza en la primera, sin agotar la memoria', async (t) => {
  const { almacen } = await almacenDePrueba(t);
  await importar(EJEMPLO, almacen);
  const inicio = Date.now();
  await assert.rejects(importar(zip64ConMillonesDeEntradas(), almacen), ErrorDeImportacion);
  assert.ok(Date.now() - inicio < 2000, 'el rechazo debe ser inmediato');
  assert.deepEqual(almacen.resumen(), RESUMEN_DEL_EJEMPLO);
});

test('un .zip con más de TOPE_DE_ENTRADAS entradas se rechaza', async (t) => {
  const { almacen } = await almacenDePrueba(t);
  // Entradas vacías con nombres válidos y distintos: solo el tope las detiene. Menos de 65.536 en
  // total, porque fflate escribe el .zip sin ZIP64 y el conteo de 16 bits daría la vuelta.
  const entradas = entradasDelEjemplo();
  const vacio = new Uint8Array(0);
  for (let folio = 1; folio <= TOPE_DE_ENTRADAS; folio++) entradas[`${RAIZ}/recibidos/99999999-9_33_${folio}.pdf`] = vacio;
  assert.ok(Object.keys(entradas).length < 65536);
  const bytes = Buffer.from(zipSync(entradas, { level: 0 }));
  await assert.rejects(importar(bytes, almacen), (error) => error instanceof ErrorDeImportacion && /entradas/.test(error.message));
  assert.equal(almacen.resumen().empresa, null);
});

test('un rechazo con el almacén vacío lo deja vacío', async (t) => {
  const { carpeta, almacen } = await almacenDePrueba(t);
  await assert.rejects(importar(Buffer.from('no es un zip'), almacen), ErrorDeImportacion);
  assert.equal(almacen.resumen().empresa, null);
  assert.deepEqual(await readdir(carpeta), []);
});

test('el mensaje del rechazo dice qué está mal, sin el contenido del archivo', async (t) => {
  const { almacen } = await almacenDePrueba(t);
  const otraRaiz = variante((entradas) => {
    for (const nombre of Object.keys(entradas)) renombrar(entradas, nombre, nombre.replace(RAIZ, 'mipyme-backup-22222222-2'));
  });
  await assert.rejects(importar(otraRaiz, almacen), (error) => error instanceof ErrorDeImportacion && /mipyme-backup-11111111-1/.test(error.message));
  await assert.rejects(importar(EJEMPLO, almacen, { bytesEsperados: 10 }), /10/);
});

test('TOPE_DE_BYTES es 50 MiB', () => {
  assert.equal(TOPE_DE_BYTES, 50 * 1024 * 1024);
});
