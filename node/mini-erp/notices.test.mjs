// Los avisos y la descarga: a qué host se mandan las credenciales, cómo se baja el respaldo y qué
// hace el receptor con cada aviso. La API y el almacenamiento son un servidor falso en 127.0.0.1;
// al final, el Mini ERP de verdad recibe un aviso del CLI del paquete y descarga el respaldo de ejemplo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { webhooks } from 'enrolamiento';
import { leerConfig } from './config.mjs';
import { abrirAlmacen } from './store.mjs';
import { importarRespaldo } from './import.mjs';
import { crearReceptor, descargarRespaldo, ErrorDeDescarga, hostPermitido, leerCuerpo, TOPE_DEL_AVISO } from './notices.mjs';

const RUT = '11111111-1';
const EJEMPLO = await readFile(new URL('../node_modules/enrolamiento/assets/respaldo-de-ejemplo.zip', import.meta.url));
const RESUMEN_DEL_EJEMPLO = {
  empresa: { rut: RUT, razon_social: 'Ferretería El Faro SpA' },
  productos: 12,
  clientes: 5,
  proveedores: 4,
  ventas: 20,
  compras: 10,
};
const CREDENCIALES = { usuario: RUT, apikey: 'apikey-de-prueba' };
const BASIC = `Basic ${Buffer.from(`${RUT}:apikey-de-prueba`).toString('base64')}`;
const SECRETO = 'secreto-de-prueba-certificacion';
const SECRETO_RESPALDO = 'secreto-de-prueba-respaldo';
const ID_DEL_RESPALDO = '3f9c2a7e5b1d4c08a6e2f0b9d7c41e53';

const escuchar = (servidor) => new Promise((listo) => servidor.listen(0, '127.0.0.1', () => listo(servidor.address().port)));

// La API y el almacenamiento, en un solo servidor. Anota cada pedido (ruta y si trajo Authorization).
// `como` cambia lo que responde: { api: 'redirige' | 'falla', archivo: 'redirige' | 'falla' | 'sin-largo',
// urlFirmada: texto, contenido: bytes }.
async function apiFalsa(t, como = {}) {
  const pedidos = [];
  const contenido = como.contenido ?? EJEMPLO;
  const servidor = createServer((pedido, respuesta) => {
    const url = new URL(pedido.url, 'http://127.0.0.1');
    pedidos.push({ ruta: pedido.url, autorizacion: pedido.headers.authorization });
    if (url.pathname === `/v1/respaldos/${ID_DEL_RESPALDO}/descargar`) {
      if (como.api === 'redirige') return respuesta.writeHead(302, { Location: `${origen}/firmada/abc` }).end();
      if (como.api === 'falla') return respuesta.writeHead(500).end();
      return respuesta
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ url: como.urlFirmada ?? `${origen}/firmada/abc`, vence: '2026-11-28T16:04:05-03:00' }));
    }
    if (url.pathname === '/firmada/abc') {
      if (pedido.headers.authorization !== undefined) return respuesta.writeHead(400).end();
      if (como.archivo === 'redirige') return respuesta.writeHead(302, { Location: `${origen}/otra` }).end();
      if (como.archivo === 'falla') return respuesta.writeHead(500).end();
      if (como.archivo === 'sin-largo') {
        respuesta.writeHead(200, { 'Content-Type': 'application/zip' });
        respuesta.write(contenido.subarray(0, 10));
        return respuesta.end(contenido.subarray(10));
      }
      return respuesta.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': String(contenido.length) }).end(contenido);
    }
    respuesta.writeHead(404).end();
  });
  const origen = `http://127.0.0.1:${await escuchar(servidor)}`;
  t.after(() => new Promise((listo) => servidor.close(listo)));
  return { origen, pedidos, urlDelRespaldo: `${origen}/v1/respaldos/${ID_DEL_RESPALDO}/descargar` };
}

const PRUEBA = { modo: 'prueba', urlBase: 'https://api.enrolamiento.cl' };
const REAL = { modo: 'real', urlBase: 'https://api.enrolamiento.cl' };

test('en modo real las credenciales van solo al host de la API configurada, y por https', () => {
  assert.equal(hostPermitido('https://api.enrolamiento.cl/v1/respaldos/x/descargar', REAL), true);
  for (const url of [
    'http://api.enrolamiento.cl/v1/respaldos/x/descargar',
    'https://api.enrolamiento.cl:8443/v1/respaldos/x/descargar',
    'https://otra.enrolamiento.cl/v1/respaldos/x/descargar',
    'https://api.enrolamiento.cl.evil.test/v1/respaldos/x/descargar',
    'https://usuario:clave@api.enrolamiento.cl/v1/respaldos/x/descargar',
    'http://127.0.0.1:4000/v1/respaldos/x/descargar',
    'http://localhost:4000/v1/respaldos/x/descargar',
  ]) {
    assert.equal(hostPermitido(url, REAL), false, url);
  }
});

test('en modo prueba, además, http a 127.0.0.1 y a localhost en cualquier puerto; nunca un host que solo se les parece', () => {
  for (const url of ['https://api.enrolamiento.cl/v1/x', 'http://127.0.0.1/v1/x', 'http://127.0.0.1:4000/v1/x', 'http://localhost:65000/v1/x']) {
    assert.equal(hostPermitido(url, PRUEBA), true, url);
  }
  for (const url of [
    'http://127.0.0.1.evil.test/v1/x',
    'http://localhost@evil.test/v1/x',
    'http://localhost.evil.test/v1/x',
    'http://evil.test/?http://127.0.0.1',
    'ftp://127.0.0.1/v1/x',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'no es una url',
    '',
    null,
    undefined,
    42,
  ]) {
    assert.equal(hostPermitido(url, PRUEBA), false, String(url));
  }
});

test('la descarga pide la URL firmada con ?formato=json y Authorization, y baja el archivo sin Authorization', async (t) => {
  const api = await apiFalsa(t);
  const bytes = await descargarRespaldo(api.urlDelRespaldo, { credenciales: CREDENCIALES, bytesEsperados: EJEMPLO.length, config: PRUEBA });
  assert.ok(Buffer.from(bytes).equals(EJEMPLO));
  assert.equal(api.pedidos.length, 2);
  assert.equal(api.pedidos[0].ruta, `/v1/respaldos/${ID_DEL_RESPALDO}/descargar?formato=json`);
  assert.equal(api.pedidos[0].autorizacion, BASIC);
  assert.equal(api.pedidos[1].ruta, '/firmada/abc');
  assert.equal(api.pedidos[1].autorizacion, undefined);
});

test('la descarga no sigue redirecciones, ni de la API ni del almacenamiento', async (t) => {
  const deLaApi = await apiFalsa(t, { api: 'redirige' });
  await assert.rejects(
    descargarRespaldo(deLaApi.urlDelRespaldo, { credenciales: CREDENCIALES, bytesEsperados: EJEMPLO.length, config: PRUEBA }),
    ErrorDeDescarga,
  );
  assert.equal(deLaApi.pedidos.length, 1);

  const delArchivo = await apiFalsa(t, { archivo: 'redirige' });
  await assert.rejects(
    descargarRespaldo(delArchivo.urlDelRespaldo, { credenciales: CREDENCIALES, bytesEsperados: EJEMPLO.length, config: PRUEBA }),
    ErrorDeDescarga,
  );
  assert.deepEqual(
    delArchivo.pedidos.map((pedido) => pedido.ruta),
    [`/v1/respaldos/${ID_DEL_RESPALDO}/descargar?formato=json`, '/firmada/abc'],
  );
});

test('la descarga rechaza un archivo de otro tamaño que el del aviso, con o sin Content-Length', async (t) => {
  const conLargo = await apiFalsa(t);
  await assert.rejects(
    descargarRespaldo(conLargo.urlDelRespaldo, { credenciales: CREDENCIALES, bytesEsperados: EJEMPLO.length - 1, config: PRUEBA }),
    (error) => error instanceof ErrorDeDescarga && /bytes/.test(error.message),
  );
  const sinLargo = await apiFalsa(t, { archivo: 'sin-largo' });
  await assert.rejects(
    descargarRespaldo(sinLargo.urlDelRespaldo, { credenciales: CREDENCIALES, bytesEsperados: EJEMPLO.length - 1, config: PRUEBA }),
    ErrorDeDescarga,
  );
  await assert.rejects(
    descargarRespaldo(sinLargo.urlDelRespaldo, { credenciales: CREDENCIALES, bytesEsperados: EJEMPLO.length + 1, config: PRUEBA }),
    ErrorDeDescarga,
  );
});

test('una url de un host no permitido se rechaza sin haber mandado las credenciales', async (t) => {
  const api = await apiFalsa(t);
  // En modo real, 127.0.0.1 no es la API configurada.
  await assert.rejects(
    descargarRespaldo(api.urlDelRespaldo, { credenciales: CREDENCIALES, bytesEsperados: EJEMPLO.length, config: REAL }),
    ErrorDeDescarga,
  );
  assert.equal(api.pedidos.length, 0);
});

test('una URL firmada que no es https (ni local en modo prueba) no se pide, y el mensaje no la muestra', async (t) => {
  const api = await apiFalsa(t, { urlFirmada: 'ftp://127.0.0.1/firmada/abc?firma=secreta' });
  await assert.rejects(
    descargarRespaldo(api.urlDelRespaldo, { credenciales: CREDENCIALES, bytesEsperados: EJEMPLO.length, config: PRUEBA }),
    (error) => error instanceof ErrorDeDescarga && !error.message.includes('firma=secreta'),
  );
  assert.equal(api.pedidos.length, 1);
});

test('sin credenciales, o con un tamaño que pasa el tope, la descarga falla sin pedir nada', async (t) => {
  const api = await apiFalsa(t);
  await assert.rejects(
    descargarRespaldo(api.urlDelRespaldo, { credenciales: { usuario: '', apikey: '' }, bytesEsperados: EJEMPLO.length, config: PRUEBA }),
    (error) => error instanceof ErrorDeDescarga && /ENROLAMIENTO_APIKEY/.test(error.message),
  );
  await assert.rejects(
    descargarRespaldo(api.urlDelRespaldo, { credenciales: CREDENCIALES, bytesEsperados: 600_000_000, config: PRUEBA }),
    ErrorDeDescarga,
  );
  await assert.rejects(descargarRespaldo(api.urlDelRespaldo, { credenciales: CREDENCIALES, bytesEsperados: null, config: PRUEBA }), ErrorDeDescarga);
  assert.equal(api.pedidos.length, 0);
});

test('el cuerpo del aviso se lee como Buffer, con tope de 1 MB', async () => {
  const cuerpo = await leerCuerpo(Readable.from([Buffer.from('{"a":'), Buffer.from('1}')]));
  assert.ok(Buffer.isBuffer(cuerpo));
  assert.equal(String(cuerpo), '{"a":1}');
  assert.equal(TOPE_DEL_AVISO, 1024 * 1024);
  assert.equal(await leerCuerpo(Readable.from([Buffer.alloc(TOPE_DEL_AVISO), Buffer.alloc(1)])), null);
  assert.equal((await leerCuerpo(Readable.from([Buffer.alloc(TOPE_DEL_AVISO)]))).length, TOPE_DEL_AVISO);
});

// --- El receptor ---

let siguiente = 0;
const nuevoId = () => `0f8fad5b-d9cb-469f-a165-${String(++siguiente).padStart(12, '0')}`;

const respaldoListo = (url, bytes = EJEMPLO.length) => ({
  estado: 'listo',
  codigo: null,
  url,
  documentos: { emitidos: 20, recibidos: 10, faltantes: 0 },
  completo_hasta: '2026-11-27',
  bytes,
  catalogo: 'normalizado',
  disponible_hasta: '2027-02-25',
});
const respaldoSin = (estado, codigo = null) => ({
  estado,
  codigo,
  url: null,
  documentos: { emitidos: null, recibidos: null, faltantes: null },
  completo_hasta: null,
  bytes: null,
  catalogo: null,
  disponible_hasta: null,
});

const certificacion = (respaldo, { rut = RUT, id = nuevoId() } = {}) => ({
  evento: 'certificacion.finalizada',
  id,
  fecha: '2026-11-28T15:04:05-03:00',
  rut,
  resolucion: { numero: 80, fecha: '2026-11-27' },
  respaldo,
});
const respaldoFinalizado = (respaldo, { rut = RUT, id = nuevoId() } = {}) => ({
  evento: 'respaldo.finalizado',
  id,
  fecha: '2026-11-28T15:04:05-03:00',
  rut,
  respaldo,
});

// Un aviso firmado como lo firma Enrolamiento: el cuerpo crudo y las cabeceras, en minúsculas como en req.headers.
function firmado(aviso, secreto = SECRETO) {
  const cuerpo = JSON.stringify(aviso);
  const firma = webhooks.firmar(cuerpo, secreto);
  return [
    Buffer.from(cuerpo),
    {
      'content-type': 'application/json; charset=utf-8',
      'x-enrolamiento-evento': aviso.evento,
      'x-enrolamiento-entrega': aviso.id,
      'x-enrolamiento-fecha': firma['X-Enrolamiento-Fecha'],
      'x-enrolamiento-firma': firma['X-Enrolamiento-Firma'],
    },
  ];
}

const silencio = { log() {}, error() {} };

async function receptorDePrueba(t, { env = {}, sesion = true } = {}) {
  const carpeta = await mkdtemp(join(tmpdir(), 'mini-erp-avisos-'));
  t.after(() => rm(carpeta, { recursive: true, force: true }));
  const almacen = abrirAlmacen(carpeta);
  if (sesion) almacen.anotar({ fase: 'esperando' });
  const config = leerConfig({ ENROLAMIENTO_WEBHOOK_SECRETO: SECRETO, ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO: SECRETO_RESPALDO, ...env });
  const receptor = crearReceptor({ config, almacen, credenciales: CREDENCIALES, registro: silencio });
  return { almacen, receptor, config };
}

// recibe y espera el trabajo de después, como si el servidor ya hubiera respondido.
async function recibir(receptor, ruta, aviso, secreto) {
  const resultado = receptor.recibir(ruta, ...firmado(aviso, secreto));
  await resultado.despues;
  return resultado;
}

test('una firma mala responde 400 y no cambia nada', async (t) => {
  const api = await apiFalsa(t);
  const { almacen, receptor } = await receptorDePrueba(t);
  const antes = almacen.estado();
  const resultado = receptor.recibir('/webhooks/certificacion', ...firmado(certificacion(respaldoListo(api.urlDelRespaldo)), 'otro-secreto'));
  assert.equal(resultado.status, 400);
  assert.equal(resultado.despues, undefined);
  assert.deepEqual(almacen.estado(), antes);
  assert.equal(api.pedidos.length, 0);

  const [cuerpo, cabeceras] = firmado(certificacion(respaldoListo(api.urlDelRespaldo)));
  cuerpo[cuerpo.length - 2] = 0x20;
  assert.equal(receptor.recibir('/webhooks/certificacion', cuerpo, cabeceras).status, 400);
  assert.equal(receptor.recibir('/webhooks/certificacion', Buffer.from('{}'), {}).status, 400);
  assert.deepEqual(almacen.estado(), antes);
});

test('sin ENROLAMIENTO_WEBHOOK_SECRETO el aviso responde 503 con un cuerpo que nombra la variable, sin tomar otro secreto del entorno', async (t) => {
  const anterior = process.env.ENROLAMIENTO_WEBHOOK_SECRETO;
  // Aunque el proceso tenga la variable, el receptor usa solo lo que leyó config.
  process.env.ENROLAMIENTO_WEBHOOK_SECRETO = SECRETO;
  t.after(() => (anterior === undefined ? delete process.env.ENROLAMIENTO_WEBHOOK_SECRETO : (process.env.ENROLAMIENTO_WEBHOOK_SECRETO = anterior)));
  const { almacen, receptor } = await receptorDePrueba(t, { env: { ENROLAMIENTO_WEBHOOK_SECRETO: '' } });
  const antes = almacen.estado();
  const resultado = receptor.recibir('/webhooks/certificacion', ...firmado(certificacion(null)));
  assert.equal(resultado.status, 503);
  assert.match(JSON.stringify(resultado.cuerpo), /ENROLAMIENTO_WEBHOOK_SECRETO/);
  assert.deepEqual(almacen.estado(), antes);
});

test('certificacion.finalizada con el respaldo listo: 200 enseguida y, al terminar, los datos importados', async (t) => {
  const api = await apiFalsa(t);
  const { almacen, receptor } = await receptorDePrueba(t);
  const resultado = receptor.recibir('/webhooks/certificacion', ...firmado(certificacion(respaldoListo(api.urlDelRespaldo))));
  assert.equal(resultado.status, 200);
  assert.equal(almacen.estado().fase, 'importando');
  assert.ok(resultado.despues instanceof Promise);
  await resultado.despues;
  assert.equal(almacen.estado().fase, 'listo');
  assert.equal(almacen.estado().respaldoId, ID_DEL_RESPALDO);
  assert.deepEqual(almacen.resumen(), RESUMEN_DEL_EJEMPLO);
});

test('con el respaldo en proceso: «El respaldo sigue armándose», y respaldo.finalizado listo por la otra ruta importa', async (t) => {
  const api = await apiFalsa(t);
  const { almacen, receptor } = await receptorDePrueba(t);
  const primero = await recibir(receptor, '/webhooks/certificacion', certificacion(respaldoSin('en_proceso')));
  assert.equal(primero.status, 200);
  assert.equal(almacen.estado().fase, 'esperando');
  assert.match(almacen.estado().detalle, /^El respaldo sigue armándose/);
  assert.equal(api.pedidos.length, 0);

  const segundo = await recibir(receptor, '/webhooks/respaldo', respaldoFinalizado(respaldoListo(api.urlDelRespaldo)), SECRETO_RESPALDO);
  assert.equal(segundo.status, 200);
  assert.equal(almacen.estado().fase, 'listo');
  assert.deepEqual(almacen.resumen(), RESUMEN_DEL_EJEMPLO);
});

test('sin respaldo, fallido o vencido: 200, estado error con el motivo y sin descargar', async (t) => {
  const api = await apiFalsa(t);
  const casos = [
    [certificacion(null), '/webhooks/certificacion', SECRETO, /sin respaldo/],
    [certificacion(respaldoSin('fallido', 'SIN_ACCESO_MIPYME')), '/webhooks/certificacion', SECRETO, /falló.*SIN_ACCESO_MIPYME/],
    [certificacion(respaldoSin('vencido')), '/webhooks/certificacion', SECRETO, /venció/],
    [respaldoFinalizado(respaldoSin('fallido', 'SIN_ACCESO_MIPYME')), '/webhooks/respaldo', SECRETO_RESPALDO, /SIN_ACCESO_MIPYME/],
    [respaldoFinalizado(respaldoSin('vencido')), '/webhooks/respaldo', SECRETO_RESPALDO, /venció/],
  ];
  for (const [aviso, ruta, secreto, motivo] of casos) {
    const { almacen, receptor } = await receptorDePrueba(t);
    const resultado = await recibir(receptor, ruta, aviso, secreto);
    assert.equal(resultado.status, 200);
    assert.equal(almacen.estado().fase, 'error');
    assert.match(almacen.estado().detalle, motivo);
  }
  assert.equal(api.pedidos.length, 0);
});

test('el mismo respaldo por las dos rutas se importa una vez', async (t) => {
  const api = await apiFalsa(t);
  const { almacen, receptor } = await receptorDePrueba(t);
  await recibir(receptor, '/webhooks/certificacion', certificacion(respaldoListo(api.urlDelRespaldo)));
  assert.equal(api.pedidos.length, 2);
  const otra = await recibir(receptor, '/webhooks/respaldo', respaldoFinalizado(respaldoListo(api.urlDelRespaldo)), SECRETO_RESPALDO);
  assert.equal(otra.status, 200);
  assert.equal(api.pedidos.length, 2);
  assert.equal(almacen.estado().fase, 'listo');
});

test('los dos avisos a la vez: el segundo ve que el respaldo ya se está importando', async (t) => {
  const api = await apiFalsa(t);
  const { almacen, receptor } = await receptorDePrueba(t);
  const uno = receptor.recibir('/webhooks/certificacion', ...firmado(certificacion(respaldoListo(api.urlDelRespaldo))));
  const dos = receptor.recibir('/webhooks/respaldo', ...firmado(respaldoFinalizado(respaldoListo(api.urlDelRespaldo)), SECRETO_RESPALDO));
  assert.equal(uno.status, 200);
  assert.equal(dos.status, 200);
  await Promise.all([uno.despues, dos.despues]);
  assert.equal(api.pedidos.length, 2);
  assert.equal(almacen.estado().fase, 'listo');
});

test('una entrega repetida, con el mismo id, no hace nada', async (t) => {
  const { almacen, receptor } = await receptorDePrueba(t);
  const aviso = respaldoFinalizado(respaldoSin('fallido', 'SIN_ACCESO_MIPYME'));
  await recibir(receptor, '/webhooks/respaldo', aviso, SECRETO_RESPALDO);
  assert.equal(almacen.estado().fase, 'error');
  almacen.anotar({ fase: 'esperando' });
  // Un reintento: el mismo cuerpo, con otra fecha y otra firma.
  const repetida = await recibir(receptor, '/webhooks/respaldo', aviso, SECRETO_RESPALDO);
  assert.equal(repetida.status, 200);
  assert.equal(almacen.estado().fase, 'esperando');
});

test('el aviso de otro RUT, o sin una sesión creada, responde 200 y se ignora sin pedir la descarga', async (t) => {
  const api = await apiFalsa(t);
  const otroRut = await receptorDePrueba(t);
  const resultado = await recibir(otroRut.receptor, '/webhooks/certificacion', certificacion(respaldoListo(api.urlDelRespaldo), { rut: '22222222-2' }));
  assert.equal(resultado.status, 200);
  assert.equal(otroRut.almacen.estado().fase, 'esperando');

  const sinSesion = await receptorDePrueba(t, { sesion: false });
  const otro = await recibir(sinSesion.receptor, '/webhooks/certificacion', certificacion(respaldoListo(api.urlDelRespaldo)));
  assert.equal(otro.status, 200);
  assert.equal(sinSesion.almacen.estado().fase, 'vacio');
  assert.equal(api.pedidos.length, 0);
});

test('un evento desconocido, o el de «Enviar prueba», responde 200 y no cambia nada', async (t) => {
  const { almacen, receptor } = await receptorDePrueba(t);
  const antes = almacen.estado();
  for (const aviso of [
    { evento: 'certificacion.anulada', id: nuevoId(), fecha: '2026-11-28T15:04:05-03:00', rut: RUT },
    { evento: 'prueba', id: nuevoId(), fecha: '2026-11-28T15:04:05-03:00' },
  ]) {
    assert.equal((await recibir(receptor, '/webhooks/certificacion', aviso)).status, 200);
  }
  assert.deepEqual(almacen.estado(), antes);
});

test('/webhooks/respaldo sin ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO responde 404, y una ruta desconocida también', async (t) => {
  const api = await apiFalsa(t);
  const { almacen, receptor } = await receptorDePrueba(t, { env: { ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO: '' } });
  const aviso = respaldoFinalizado(respaldoListo(api.urlDelRespaldo));
  assert.equal(receptor.recibir('/webhooks/respaldo', ...firmado(aviso, SECRETO)).status, 404);
  assert.equal(receptor.recibir('/webhooks/otra', ...firmado(aviso, SECRETO)).status, 404);
  assert.equal(almacen.estado().fase, 'esperando');
  assert.equal(api.pedidos.length, 0);
});

test('sin el secreto de respaldo.finalizado, «sigue armándose» dice qué variable falta para recibirlo', async (t) => {
  const { almacen, receptor } = await receptorDePrueba(t, { env: { ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO: '' } });
  await recibir(receptor, '/webhooks/certificacion', certificacion(respaldoSin('en_proceso')));
  assert.match(almacen.estado().detalle, /ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO/);
});

test('una descarga que falla deja el estado en error y lo importado antes intacto', async (t) => {
  const api = await apiFalsa(t, { archivo: 'falla' });
  const { almacen, receptor } = await receptorDePrueba(t);
  await importarRespaldo(EJEMPLO, { rut: RUT, bytesEsperados: EJEMPLO.length, almacen });
  almacen.anotar({ fase: 'esperando', respaldoId: null });
  const resultado = await recibir(receptor, '/webhooks/certificacion', certificacion(respaldoListo(api.urlDelRespaldo)));
  assert.equal(resultado.status, 200);
  assert.equal(almacen.estado().fase, 'error');
  assert.match(almacen.estado().detalle, /500/);
  assert.ok(!almacen.estado().detalle.includes('/firmada/'));
  assert.deepEqual(almacen.resumen(), RESUMEN_DEL_EJEMPLO);
});

test('un respaldo que no se pudo importar se puede volver a intentar por la otra ruta', async (t) => {
  const api = await apiFalsa(t, { contenido: Buffer.from('no es un zip') });
  const { almacen, receptor } = await receptorDePrueba(t);
  await recibir(receptor, '/webhooks/certificacion', certificacion(respaldoListo(api.urlDelRespaldo, 12)));
  assert.equal(almacen.estado().fase, 'error');
  assert.match(almacen.estado().detalle, /zip/);
  await recibir(receptor, '/webhooks/respaldo', respaldoFinalizado(respaldoListo(api.urlDelRespaldo, 12)), SECRETO_RESPALDO);
  assert.equal(api.pedidos.length, 4);
});

test('una importación cortada por un reinicio queda en error al arrancar, y el mismo respaldo se puede reintentar', async (t) => {
  const api = await apiFalsa(t);
  const carpeta = await mkdtemp(join(tmpdir(), 'mini-erp-avisos-'));
  t.after(() => rm(carpeta, { recursive: true, force: true }));
  abrirAlmacen(carpeta).anotar({ fase: 'importando', respaldoId: ID_DEL_RESPALDO });
  const almacen = abrirAlmacen(carpeta);
  const config = leerConfig({ ENROLAMIENTO_WEBHOOK_SECRETO: SECRETO });
  const receptor = crearReceptor({ config, almacen, credenciales: CREDENCIALES, registro: silencio });
  assert.equal(almacen.estado().fase, 'error');
  assert.match(almacen.estado().detalle, /cortó/);
  await recibir(receptor, '/webhooks/certificacion', certificacion(respaldoListo(api.urlDelRespaldo)));
  assert.equal(almacen.estado().fase, 'listo');
});

// --- El servidor de verdad ---

async function arrancarErp(t, env) {
  const carpeta = await mkdtemp(join(tmpdir(), 'mini-erp-servidor-'));
  t.after(() => rm(carpeta, { recursive: true, force: true }));
  abrirAlmacen(carpeta).anotar({ fase: 'esperando' });
  const libre = createServer();
  const puerto = await escuchar(libre);
  await new Promise((listo) => libre.close(listo));
  const erp = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: {
      ...process.env,
      PUERTO: String(puerto),
      MINI_ERP_MODO: 'prueba',
      MINI_ERP_DATOS: carpeta,
      ENROLAMIENTO_URL: 'https://api.enrolamiento.cl',
      ENROLAMIENTO_USUARIO: RUT,
      ENROLAMIENTO_APIKEY: 'apikey-de-prueba',
      ENROLAMIENTO_WEBHOOK_SECRETO: '',
      ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  t.after(() => erp.kill());
  await new Promise((listo, fallo) => {
    erp.stdout.on('data', (texto) => String(texto).includes('escuchando') && listo());
    erp.once('exit', (codigo) => fallo(new Error(`el Mini ERP salió con ${codigo}`)));
  });
  return { sitio: `http://127.0.0.1:${puerto}`, almacen: abrirAlmacen(carpeta) };
}

test('el servidor sin ENROLAMIENTO_WEBHOOK_SECRETO responde 503 al aviso, dice qué falta y sigue vivo', async (t) => {
  const { sitio } = await arrancarErp(t, {});
  const [cuerpo, cabeceras] = firmado(certificacion(null));
  const respuesta = await fetch(`${sitio}/webhooks/certificacion`, { method: 'POST', headers: cabeceras, body: cuerpo });
  assert.equal(respuesta.status, 503);
  assert.match(await respuesta.text(), /ENROLAMIENTO_WEBHOOK_SECRETO/);
  assert.equal((await fetch(`${sitio}/webhooks/respaldo`, { method: 'POST', headers: cabeceras, body: cuerpo })).status, 404);
  assert.equal((await fetch(`${sitio}/`)).status, 200);
});

test('de punta a punta: el CLI del paquete envía el aviso y el Mini ERP descarga e importa el respaldo de ejemplo', async (t) => {
  const { sitio, almacen } = await arrancarErp(t, { ENROLAMIENTO_WEBHOOK_SECRETO: SECRETO });
  const cli = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/enrolamiento/dist/cli.js', import.meta.url)),
      'webhooks',
      'enviar',
      'certificacion.finalizada',
      '--url',
      `${sitio}/webhooks/certificacion`,
      '--esperar',
      '30',
    ],
    { env: { ...process.env, ENROLAMIENTO_WEBHOOK_SECRETO: SECRETO }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let salida = '';
  cli.stdout.on('data', (texto) => (salida += texto));
  cli.stderr.on('data', (texto) => (salida += texto));
  const codigo = await new Promise((listo) => cli.once('exit', listo));
  assert.equal(codigo, 0, salida);
  // El CLI termina al entregar el archivo; la importación termina un momento después.
  for (let intento = 0; intento < 50 && almacen.estado().fase !== 'listo'; intento++) await new Promise((listo) => setTimeout(listo, 100));
  assert.equal(almacen.estado().fase, 'listo', JSON.stringify(almacen.estado()));
  assert.deepEqual(almacen.resumen(), RESUMEN_DEL_EJEMPLO);
});
