// Arranca el ejemplo contra una API falsa en esta máquina y comprueba las dos mitades: lo que el
// servidor le pide a la API y lo que le entrega al navegador.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const WIDGET = 'https://widget.enrolamiento.cl';
const SECRETO = `wst_${'3f9c2a7e5b1d4c08a6e2f0b9d7c41e53'}_${'Ejemplo'.repeat(6)}E`;
const pedidos = [];
let responder;
let api;
let ejemplo;
let sitio;

const escuchar = (servidor) => new Promise((listo) => servidor.listen(0, '127.0.0.1', () => listo(servidor.address().port)));

before(async () => {
  api = createServer((pedido, respuesta) => {
    let cuerpo = '';
    pedido.on('data', (trozo) => (cuerpo += trozo));
    pedido.on('end', () => {
      pedidos.push({ metodo: pedido.method, ruta: pedido.url, autorizacion: pedido.headers.authorization, cuerpo: JSON.parse(cuerpo) });
      responder(respuesta);
    });
  });
  const puertoDeLaApi = await escuchar(api);

  const libre = createServer();
  const puerto = await escuchar(libre);
  await new Promise((listo) => libre.close(listo));
  sitio = `http://127.0.0.1:${puerto}`;

  ejemplo = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: {
      ...process.env,
      PUERTO: String(puerto),
      ENROLAMIENTO_USUARIO: '11111111-1',
      ENROLAMIENTO_APIKEY: 'apikey-de-prueba',
      ENROLAMIENTO_URL: `http://127.0.0.1:${puertoDeLaApi}`,
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  await new Promise((listo, fallo) => {
    ejemplo.stdout.on('data', (texto) => String(texto).includes('escuchando') && listo());
    ejemplo.once('exit', (codigo) => fallo(new Error(`el ejemplo salió con ${codigo}`)));
  });
});

after(() => {
  ejemplo?.kill();
  api?.close();
});

const sesionCreada = (respuesta) =>
  respuesta.writeHead(200, { 'Content-Type': 'application/json' }).end(
    JSON.stringify({ id: '3f9c2a7e5b1d4c08a6e2f0b9d7c41e53', client_secret: SECRETO, expira: '2026-11-24T16:04:05-03:00', prueba: true, escenario: 'camino_feliz' }),
  );

test('la página carga el script desde el origen del widget y su política lo admite, sin unsafe-inline', async () => {
  const respuesta = await fetch(sitio);
  const html = await respuesta.text();
  assert.equal(respuesta.status, 200);
  assert.ok(html.includes(`<script src="${WIDGET}/v1/enrolamiento.js"></script>`));
  assert.ok(html.includes('<div id="portabilidad"></div>'));
  assert.doesNotMatch(html, /type="module"|<script>(?!<)/);
  assert.equal(respuesta.headers.get('content-security-policy'), `default-src 'self'; script-src 'self' ${WIDGET}; frame-src ${WIDGET}`);
});

test('el servidor crea una sesión de prueba con su APIKey y le pasa al navegador solo el client_secret', async () => {
  pedidos.length = 0;
  responder = sesionCreada;
  const respuesta = await fetch(`${sitio}/sesion?escenario=conflicto`, { method: 'POST' });

  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await respuesta.json(), { client_secret: SECRETO });
  assert.deepEqual(pedidos, [
    {
      metodo: 'POST',
      ruta: '/v1/portabilidad/sesiones',
      autorizacion: `Basic ${Buffer.from('11111111-1:apikey-de-prueba').toString('base64')}`,
      cuerpo: { rut: '11111111-1', referencia_externa: 'cliente-4821', prueba: true, escenario: 'conflicto' },
    },
  ]);
});

test('sin escenario no lo manda: el guion de la empresa sigue donde iba', async () => {
  pedidos.length = 0;
  responder = sesionCreada;
  await fetch(`${sitio}/sesion`, { method: 'POST' });
  assert.deepEqual(pedidos[0].cuerpo, { rut: '11111111-1', referencia_externa: 'cliente-4821', prueba: true });
});

test('el navegador no elige el RUT ni un escenario que no existe', async () => {
  pedidos.length = 0;
  responder = sesionCreada;
  assert.equal((await fetch(`${sitio}/sesion?escenario=otro`, { method: 'POST' })).status, 400);
  assert.deepEqual(pedidos, []);
  await fetch(`${sitio}/sesion?rut=22222222-2`, { method: 'POST' });
  assert.equal(pedidos[0].cuerpo.rut, '11111111-1');
});

test('un error de la API llega al navegador como un motivo, sin el mensaje ni la APIKey', async () => {
  responder = (respuesta) => respuesta.writeHead(403, { 'X-Codigo-Error': 'FUNCION_NO_CONTRATADA' }).end('FUNCION_NO_CONTRATADA:La función no está contratada.');
  const sinFuncion = await fetch(`${sitio}/sesion`, { method: 'POST' });
  assert.equal(sinFuncion.status, 502);
  assert.deepEqual(await sinFuncion.json(), { error: 'FUNCION_NO_CONTRATADA' });

  responder = (respuesta) => respuesta.writeHead(404).end();
  const apagado = await fetch(`${sitio}/sesion`, { method: 'POST' });
  assert.deepEqual(await apagado.json(), { error: 'WIDGET_NO_HABILITADO' });
});

test('la página registra los oyentes antes de montar y no guarda el secreto', async () => {
  const js = await (await fetch(`${sitio}/page.js`)).text();
  assert.ok(js.indexOf("portabilidad.on('error'") < js.indexOf("portabilidad.mount('#portabilidad')"));
  for (const evento of ['ready', 'step_change', 'requires_action', 'completed', 'error', 'session_expired']) {
    assert.ok(js.includes(`portabilidad.on('${evento}'`), evento);
  }
  assert.doesNotMatch(js, /localStorage|sessionStorage|document\.cookie|console\.log\(.*[sS]ecret/);
  // Dos «Reiniciar» seguidos: el pedido viejo no monta su sesión encima de la nueva.
  assert.match(js, /const miTurno = \+\+turno;/);
  assert.match(js, /if \(miTurno !== turno\) return;\n\n  portabilidad\?\.unmount\(\);/);
});
