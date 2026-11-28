// El almacén de archivos: el estado del aviso, el reemplazo de un juego de datos por otro y la lectura
// de los XML y PDF solo por el id. Cada prueba usa su propia carpeta temporal, nunca datos/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirAlmacen } from './store.mjs';

const EMPRESA = { rut: '11111111-1', razon_social: 'Ferretería El Faro SpA' };

async function carpetaDePrueba(t) {
  const carpeta = await mkdtemp(join(tmpdir(), 'mini-erp-almacen-'));
  t.after(() => rm(carpeta, { recursive: true, force: true }));
  return carpeta;
}

// Un juego de datos mínimo, escrito como lo deja el importador.
async function juegoDeDatos(carpeta, nombre, { ventas = 1, pdf = '%PDF-1.4 venta' } = {}) {
  const destino = join(carpeta, nombre);
  await mkdir(join(destino, 'emitidos'), { recursive: true });
  await mkdir(join(destino, 'recibidos'), { recursive: true });
  const archivo = (items) => JSON.stringify({ schema_version: '1.0', empresa: EMPRESA, items });
  const listaDeVentas = Array.from({ length: ventas }, (_, i) => ({ id: `11111111-1_33_${100 + i}`, folio: 100 + i }));
  await writeFile(join(destino, 'ventas.json'), archivo(listaDeVentas));
  await writeFile(join(destino, 'compras.json'), archivo([{ id: '22222222-2_33_7', folio: 7 }]));
  await writeFile(join(destino, 'clientes.json'), archivo([{ rut: '33333333-3' }, { rut: '44444444-4' }]));
  await writeFile(join(destino, 'proveedores.json'), archivo([{ rut: '22222222-2' }]));
  await writeFile(join(destino, 'productos.json'), archivo([{ codigo: 'A' }, { codigo: 'B' }, { codigo: 'C' }]));
  await writeFile(join(destino, 'emitidos', '11111111-1_33_100.pdf'), pdf);
  await writeFile(join(destino, 'emitidos', '11111111-1_33_100.xml'), '<DTE/>');
  return destino;
}

test('vacío, el almacén no tiene empresa ni documentos y su estado es «vacio»', async (t) => {
  const almacen = abrirAlmacen(await carpetaDePrueba(t));
  assert.deepEqual(almacen.estado(), { fase: 'vacio', detalle: null, respaldoId: null });
  assert.deepEqual(almacen.resumen(), { empresa: null, productos: 0, clientes: 0, proveedores: 0, ventas: 0, compras: 0 });
  assert.equal(almacen.leer('ventas'), null);
  assert.equal(almacen.documento('emitidos', '11111111-1_33_100'), null);
  assert.equal(almacen.archivo('emitidos', '11111111-1_33_100', 'pdf'), null);
});

test('reemplazar deja el juego nuevo y el resumen lo cuenta', async (t) => {
  const carpeta = await carpetaDePrueba(t);
  const almacen = abrirAlmacen(carpeta);
  almacen.reemplazar(await juegoDeDatos(carpeta, '.nuevo-1', { ventas: 2 }));
  assert.deepEqual(almacen.resumen(), { empresa: EMPRESA, productos: 3, clientes: 2, proveedores: 1, ventas: 2, compras: 1 });
  assert.equal(almacen.leer('productos').items.length, 3);
  assert.deepEqual(almacen.documento('emitidos', '11111111-1_33_101'), { id: '11111111-1_33_101', folio: 101 });
  assert.deepEqual(almacen.documento('recibidos', '22222222-2_33_7'), { id: '22222222-2_33_7', folio: 7 });
  // Un documento existe solo en su sentido.
  assert.equal(almacen.documento('recibidos', '11111111-1_33_101'), null);
  assert.equal(String(almacen.archivo('emitidos', '11111111-1_33_100', 'pdf')), '%PDF-1.4 venta');
  assert.equal(String(almacen.archivo('emitidos', '11111111-1_33_100', 'xml')), '<DTE/>');

  // El segundo reemplaza al primero entero, y no quedan carpetas viejas ni temporales.
  almacen.reemplazar(await juegoDeDatos(carpeta, '.nuevo-2', { ventas: 5, pdf: '%PDF-1.4 otra' }));
  assert.equal(almacen.resumen().ventas, 5);
  assert.equal(String(almacen.archivo('emitidos', '11111111-1_33_100', 'pdf')), '%PDF-1.4 otra');
  assert.deepEqual((await readdir(carpeta)).filter((nombre) => nombre !== 'estado.json'), ['actual']);
});

test('leer solo abre los JSON del respaldo', async (t) => {
  const carpeta = await carpetaDePrueba(t);
  const almacen = abrirAlmacen(carpeta);
  almacen.reemplazar(await juegoDeDatos(carpeta, '.nuevo'));
  for (const nombre of ['estado', '../estado', 'emitidos', 'ventas.json', '__proto__']) assert.equal(almacen.leer(nombre), null, nombre);
});

test('archivo da null ante un id que no existe, una ruta, un sentido o un tipo que no son los suyos', async (t) => {
  const carpeta = await carpetaDePrueba(t);
  const almacen = abrirAlmacen(carpeta);
  almacen.reemplazar(await juegoDeDatos(carpeta, '.nuevo'));
  await writeFile(join(carpeta, 'actual', 'ventas.pdf'), '%PDF secreto');
  assert.equal(almacen.archivo('emitidos', '11111111-1_33_999', 'pdf'), null);
  assert.equal(almacen.archivo('emitidos', '../ventas', 'pdf'), null);
  assert.equal(almacen.archivo('emitidos', '../../estado', 'json'), null);
  assert.equal(almacen.archivo('emitidos', '11111111-1_33_100/../../ventas', 'pdf'), null);
  assert.equal(almacen.archivo('..', '11111111-1_33_100', 'pdf'), null);
  assert.equal(almacen.archivo('emitidos', '11111111-1_33_100', 'json'), null);
  assert.equal(almacen.archivo('recibidos', '11111111-1_33_100', 'pdf'), null);
});

test('el estado se anota, sobrevive a reemplazar y a reabrir el almacén, y borrar lo deja vacío', async (t) => {
  const carpeta = await carpetaDePrueba(t);
  const almacen = abrirAlmacen(carpeta);
  assert.deepEqual(almacen.anotar({ fase: 'esperando', respaldoId: 'rsp_1' }), { fase: 'esperando', detalle: null, respaldoId: 'rsp_1' });
  // Sin respaldoId se conserva el anterior; el detalle no.
  almacen.anotar({ fase: 'error', detalle: 'el .zip no abre' });
  assert.deepEqual(almacen.estado(), { fase: 'error', detalle: 'el .zip no abre', respaldoId: 'rsp_1' });
  almacen.anotar({ fase: 'listo' });
  assert.deepEqual(almacen.estado(), { fase: 'listo', detalle: null, respaldoId: 'rsp_1' });

  almacen.reemplazar(await juegoDeDatos(carpeta, '.nuevo'));
  assert.deepEqual(almacen.estado(), { fase: 'listo', detalle: null, respaldoId: 'rsp_1' });

  // Otro proceso (un reinicio) lee lo mismo.
  const otro = abrirAlmacen(carpeta);
  assert.deepEqual(otro.estado(), { fase: 'listo', detalle: null, respaldoId: 'rsp_1' });
  assert.equal(otro.resumen().ventas, 1);

  otro.borrar();
  assert.deepEqual(otro.estado(), { fase: 'vacio', detalle: null, respaldoId: null });
  assert.equal(otro.resumen().empresa, null);
  assert.deepEqual(abrirAlmacen(carpeta).estado(), { fase: 'vacio', detalle: null, respaldoId: null });
});

test('anotar rechaza una fase que no existe', async (t) => {
  const almacen = abrirAlmacen(await carpetaDePrueba(t));
  assert.throws(() => almacen.anotar({ fase: 'terminado' }), /fase/);
  assert.equal(almacen.estado().fase, 'vacio');
});

test('al abrir, recupera el juego anterior si un reemplazo quedó a medias y limpia los temporales', async (t) => {
  const carpeta = await carpetaDePrueba(t);
  // Un corte entre los dos rename: el anterior quedó apartado y el nuevo no alcanzó a entrar.
  await juegoDeDatos(carpeta, '.anterior-123', { ventas: 4 });
  await juegoDeDatos(carpeta, '.importando-abc', { ventas: 9 });
  const almacen = abrirAlmacen(carpeta);
  assert.equal(almacen.resumen().ventas, 4);
  assert.deepEqual(await readdir(carpeta), ['actual']);
});
