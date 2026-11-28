// Arranca el Mini ERP contra una API falsa en esta máquina y comprueba lo que le pide a la API y lo
// que le entrega al navegador.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webhooks } from 'enrolamiento';

const WIDGET = 'https://widget.enrolamiento.cl';
const SECRETO = `wst_${'3f9c2a7e5b1d4c08a6e2f0b9d7c41e53'}_${'Ejemplo'.repeat(6)}E`;
const SECRETO_DEL_AVISO = 'secreto-de-prueba-servidor';
const CSP = `default-src 'self'; script-src 'self' ${WIDGET}; frame-src 'self' ${WIDGET}; object-src 'none'`;
const pedidos = [];
const procesos = [];
const carpetas = [];
let responder;
let api;
let sitio;
let sitioSinCredenciales;
let sitioReal;
let sitioRealSinRut;
let puerto;

const escuchar = (servidor) => new Promise((listo) => servidor.listen(0, '127.0.0.1', () => listo(servidor.address().port)));

async function puertoLibre() {
  const libre = createServer();
  const numero = await escuchar(libre);
  await new Promise((listo) => libre.close(listo));
  return numero;
}

// Cada servidor con su carpeta de datos temporal y vacía: nunca datos/.
async function arrancar(env) {
  const numero = await puertoLibre();
  const carpeta = await mkdtemp(join(tmpdir(), 'mini-erp-servidor-'));
  carpetas.push(carpeta);
  const erp = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { ...process.env, PUERTO: String(numero), MINI_ERP_DATOS: carpeta, ...env },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  procesos.push(erp);
  await new Promise((listo, fallo) => {
    erp.stdout.on('data', (texto) => String(texto).includes('escuchando') && listo());
    erp.once('exit', (codigo) => fallo(new Error(`el Mini ERP salió con ${codigo}`)));
  });
  return numero;
}

before(async () => {
  api = createServer((pedido, respuesta) => {
    let cuerpo = '';
    pedido.on('data', (trozo) => (cuerpo += trozo));
    pedido.on('end', () => {
      pedidos.push({ metodo: pedido.method, ruta: pedido.url, autorizacion: pedido.headers.authorization, cuerpo: JSON.parse(cuerpo) });
      responder(respuesta);
    });
  });
  const urlDeLaApi = `http://127.0.0.1:${await escuchar(api)}`;

  puerto = await arrancar({
    ENROLAMIENTO_USUARIO: '11111111-1',
    ENROLAMIENTO_APIKEY: 'apikey-de-prueba',
    ENROLAMIENTO_URL: urlDeLaApi,
    ENROLAMIENTO_WIDGET: WIDGET,
    ENROLAMIENTO_WEBHOOK_SECRETO: SECRETO_DEL_AVISO,
    MINI_ERP_NOMBRE: '<b>x',
    MINI_ERP_COLOR: '#0b5fff',
  });
  sitio = `http://127.0.0.1:${puerto}`;

  const otro = await arrancar({ ENROLAMIENTO_USUARIO: '', ENROLAMIENTO_APIKEY: '', ENROLAMIENTO_URL: urlDeLaApi, ENROLAMIENTO_WIDGET: WIDGET });
  sitioSinCredenciales = `http://127.0.0.1:${otro}`;

  const credenciales = { ENROLAMIENTO_USUARIO: '11111111-1', ENROLAMIENTO_APIKEY: 'apikey-de-prueba', ENROLAMIENTO_URL: urlDeLaApi, ENROLAMIENTO_WIDGET: WIDGET };
  const real = await arrancar({ ...credenciales, MINI_ERP_MODO: 'real', MINI_ERP_RUT: '22222222-2' });
  sitioReal = `http://127.0.0.1:${real}`;
  const realSinRut = await arrancar({ ...credenciales, MINI_ERP_MODO: 'real', MINI_ERP_RUT: '22222222-3' });
  sitioRealSinRut = `http://127.0.0.1:${realSinRut}`;
});

after(async () => {
  for (const erp of procesos) erp.kill();
  api?.close();
  for (const carpeta of carpetas) await rm(carpeta, { recursive: true, force: true });
});

// Un pedido con la cabecera Host que se quiera: fetch no deja cambiarla.
function pedirConHost(ruta, { host, metodo = 'GET', cabeceras = {}, cuerpo } = {}) {
  return new Promise((listo, fallo) => {
    const pedido = request({ host: '127.0.0.1', port: puerto, path: ruta, method: metodo, headers: { ...cabeceras, Host: host } }, (respuesta) => {
      let texto = '';
      respuesta.setEncoding('utf8');
      respuesta.on('data', (trozo) => (texto += trozo));
      respuesta.on('end', () => listo({ status: respuesta.statusCode, texto }));
    });
    pedido.once('error', fallo);
    pedido.end(cuerpo);
  });
}

const sesionCreada = (respuesta) =>
  respuesta.writeHead(200, { 'Content-Type': 'application/json' }).end(
    JSON.stringify({ id: '3f9c2a7e5b1d4c08a6e2f0b9d7c41e53', client_secret: SECRETO, expira: '2026-11-28T16:04:05-03:00', prueba: true, escenario: 'camino_feliz' }),
  );

test('el servidor crea una sesión de prueba del camino feliz y le pasa al navegador solo el client_secret', async () => {
  pedidos.length = 0;
  responder = sesionCreada;
  const respuesta = await fetch(`${sitio}/sesion`, { method: 'POST' });

  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await respuesta.json(), { client_secret: SECRETO });
  assert.deepEqual(pedidos, [
    {
      metodo: 'POST',
      ruta: '/v1/portabilidad/sesiones',
      autorizacion: `Basic ${Buffer.from('11111111-1:apikey-de-prueba').toString('base64')}`,
      cuerpo: { rut: '11111111-1', prueba: true, escenario: 'camino_feliz' },
    },
  ]);
});

test('el navegador no elige el RUT ni el escenario', async () => {
  pedidos.length = 0;
  responder = sesionCreada;
  await fetch(`${sitio}/sesion?rut=22222222-2&escenario=conflicto`, { method: 'POST', body: JSON.stringify({ rut: '22222222-2' }) });
  assert.deepEqual(pedidos[0].cuerpo, { rut: '11111111-1', prueba: true, escenario: 'camino_feliz' });
});

test('al renovar una sesión vencida no manda escenario: el guion sigue donde iba', async () => {
  pedidos.length = 0;
  responder = sesionCreada;
  const respuesta = await fetch(`${sitio}/sesion?seguir=1`, { method: 'POST' });
  assert.deepEqual(await respuesta.json(), { client_secret: SECRETO });
  assert.deepEqual(pedidos[0].cuerpo, { rut: '11111111-1', prueba: true });
});

test('un 404 sin código de la API se muestra como el widget sin habilitar', async () => {
  responder = (respuesta) => respuesta.writeHead(404).end();
  const respuesta = await fetch(`${sitio}/sesion`, { method: 'POST' });
  assert.equal(respuesta.status, 502);
  assert.deepEqual(await respuesta.json(), { error: 'WIDGET_NO_HABILITADO', mensaje: 'El widget no está habilitado para su cuenta.' });
});

test('otro error de la API llega como su código, sin el mensaje de la API ni la APIKey', async () => {
  responder = (respuesta) => respuesta.writeHead(403, { 'X-Codigo-Error': 'FUNCION_NO_CONTRATADA' }).end('FUNCION_NO_CONTRATADA:La función no está contratada.');
  const respuesta = await fetch(`${sitio}/sesion`, { method: 'POST' });
  assert.equal(respuesta.status, 502);
  const cuerpo = await respuesta.json();
  assert.equal(cuerpo.error, 'FUNCION_NO_CONTRATADA');
  assert.match(cuerpo.mensaje, /FUNCION_NO_CONTRATADA/);
  assert.doesNotMatch(JSON.stringify(cuerpo), /no está contratada|apikey-de-prueba/);
});

test('un 401 de la API dice que se rechazaron las credenciales y nombra las variables, sin la APIKey', async () => {
  responder = (respuesta) => respuesta.writeHead(401).end();
  const respuesta = await fetch(`${sitio}/sesion`, { method: 'POST' });
  assert.equal(respuesta.status, 502);
  const cuerpo = await respuesta.json();
  assert.equal(cuerpo.error, 'CREDENCIALES_RECHAZADAS');
  assert.match(cuerpo.mensaje, /rechazó las credenciales/);
  assert.match(cuerpo.mensaje, /ENROLAMIENTO_USUARIO/);
  assert.match(cuerpo.mensaje, /ENROLAMIENTO_APIKEY/);
  assert.doesNotMatch(JSON.stringify(cuerpo), /apikey-de-prueba|SIN_CODIGO/);
});

test('el ícono que pide el navegador responde 204: sin un 404 en la consola', async () => {
  const respuesta = await fetch(`${sitio}/favicon.ico`);
  assert.equal(respuesta.status, 204);
  assert.equal(await respuesta.text(), '');
});

test('si no se pudo crear la sesión, el recorrido oculta el recuadro vacío del widget', async () => {
  const js = await (await fetch(`${sitio}/public/journey.js`)).text();
  assert.match(js, /catch \(error\) \{\s*if \(miTurno === turno\) \{[^}]*seccionWidget\.hidden = true;/);
  assert.match(js, /typeof Enrolamiento !== 'function'\) \{[^}]*seccionWidget\.hidden = true;/);
});

test('sin credenciales en el servidor, la sesión dice qué falta y el servidor sigue vivo', async () => {
  const respuesta = await fetch(`${sitioSinCredenciales}/sesion`, { method: 'POST' });
  assert.equal(respuesta.status, 500);
  const cuerpo = await respuesta.json();
  assert.equal(cuerpo.error, 'SIN_CREDENCIALES');
  assert.match(cuerpo.mensaje, /ENROLAMIENTO_USUARIO/);
  assert.match(cuerpo.mensaje, /ENROLAMIENTO_APIKEY/);
  assert.equal((await fetch(sitioSinCredenciales)).status, 200);
});

test('el inicio sin datos invita a traer la empresa, con la política de seguridad y la marca escapada', async () => {
  const respuesta = await fetch(sitio);
  const html = await respuesta.text();
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(respuesta.headers.get('content-security-policy'), CSP);
  assert.equal(respuesta.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(html.includes('Trae tu empresa desde el facturador gratuito'));
  assert.match(html, /<a [^>]*href="\/recorrido"/);
  assert.ok(html.includes('&lt;b&gt;x'));
  assert.ok(!html.includes('<b>x'));
});

test('el recorrido carga el widget desde su origen y le pasa la marca en atributos data-, sin script en línea', async () => {
  const respuesta = await fetch(`${sitio}/recorrido`);
  const html = await respuesta.text();
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get('content-security-policy'), CSP);
  assert.ok(html.includes(`<script src="${WIDGET}/v1/enrolamiento.js"></script>`));
  assert.ok(html.includes('<script src="/public/journey.js"></script>'));
  assert.ok(html.includes('<div id="portabilidad"></div>'));
  assert.match(html, /<body [^>]*data-marca-nombre="&lt;b&gt;x"/);
  assert.match(html, /<body [^>]*data-marca-color="#0B5FFF"/);
  // Ni scripts en línea ni estilos en línea: la CSP no los deja correr.
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|<style|\sstyle=|\son[a-z]+=/i);
  // El panel de «Esperando el aviso» viene listo y oculto, para que lo muestre el script.
  assert.match(html, /<section [^>]*id="esperando"[^>]*hidden/);
  assert.ok(html.includes('Esperando el aviso'));
});

test('los colores de la marca llegan como variables CSS, desde una hoja del mismo origen', async () => {
  const respuesta = await fetch(`${sitio}/marca.css`);
  assert.equal(respuesta.headers.get('content-type'), 'text/css; charset=utf-8');
  const css = await respuesta.text();
  assert.match(css, /--marca:\s*#0B5FFF;/);
  assert.match(css, /--marca-texto:\s*#FFFFFF;/);
  const html = await (await fetch(sitio)).text();
  assert.ok(html.includes('<link rel="stylesheet" href="/marca.css">'));
  assert.ok(html.includes('<link rel="stylesheet" href="/public/app.css">'));
});

test('sirve solo sus archivos públicos, con su tipo', async () => {
  const css = await fetch(`${sitio}/public/app.css`);
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
  const js = await fetch(`${sitio}/public/journey.js`);
  assert.equal(js.status, 200);
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  for (const ruta of ['/public/../server.mjs', '/public/%2e%2e/server.mjs', '/public/', '/public/otro.js', '/server.mjs', '/.env']) {
    assert.equal((await fetch(`${sitio}${ruta}`)).status, 404, ruta);
  }
});

test('el script del recorrido registra los oyentes antes de montar, pasa solo las claves básicas y no guarda el secreto', async () => {
  const js = await (await fetch(`${sitio}/public/journey.js`)).text();
  assert.ok(js.indexOf("portabilidad.on('error'") < js.indexOf("portabilidad.mount('#portabilidad')"));
  for (const evento of ['ready', 'completed', 'error', 'session_expired']) {
    assert.ok(js.includes(`portabilidad.on('${evento}'`), evento);
  }
  assert.match(js, /appearance: \{ nombre: marca\.nombre, variables: \{ colorPrimary: marca\.color \} \}/);
  assert.match(js, /document\.body\.dataset/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|document\.cookie|console\.log\(.*[sS]ecret|innerHTML/);
  // La renovación no reinicia el guion.
  assert.ok(js.includes("'/sesion?seguir=1'"));
});

test('escucha solo en 127.0.0.1: otra dirección de la máquina no lo alcanza', async (t) => {
  if (process.platform !== 'linux') return t.skip('127.0.0.2 responde solo en Linux');
  const error = await new Promise((listo) => {
    const socket = connect(puerto, '127.0.0.2');
    socket.once('connect', () => {
      socket.destroy();
      listo(null);
    });
    socket.once('error', listo);
  });
  assert.equal(error?.code, 'ECONNREFUSED');
});

test('en modo real crea una sesión real con la empresa de MINI_ERP_RUT, sin escenario', async () => {
  pedidos.length = 0;
  responder = sesionCreada;
  const respuesta = await fetch(`${sitioReal}/sesion?rut=11111111-1&escenario=conflicto`, { method: 'POST' });
  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), { client_secret: SECRETO });
  assert.deepEqual(pedidos[0].cuerpo, { rut: '22222222-2', prueba: false });

  // Al renovar, lo mismo.
  await fetch(`${sitioReal}/sesion?seguir=1`, { method: 'POST' });
  assert.deepEqual(pedidos[1].cuerpo, { rut: '22222222-2', prueba: false });
});

test('en modo real el recorrido dice que la sesión es real; en modo prueba, que es de prueba', async () => {
  const real = await (await fetch(`${sitioReal}/recorrido`)).text();
  assert.match(real, /Es una sesión real/);
  assert.doesNotMatch(real, /sesión de prueba/);
  assert.ok(real.includes('<script src="/public/journey.js"></script>'));
  const prueba = await (await fetch(`${sitio}/recorrido`)).text();
  assert.match(prueba, /Es una sesión de prueba/);
});

test('en modo real sin un MINI_ERP_RUT válido, el servidor arranca, y la sesión y el recorrido nombran la variable', async () => {
  pedidos.length = 0;
  responder = sesionCreada;
  const respuesta = await fetch(`${sitioRealSinRut}/sesion`, { method: 'POST' });
  assert.equal(respuesta.status, 500);
  const cuerpo = await respuesta.json();
  assert.equal(cuerpo.error, 'SIN_RUT');
  assert.match(cuerpo.mensaje, /MINI_ERP_RUT/);
  // No se le pide nada a la API.
  assert.equal(pedidos.length, 0);

  const recorrido = await fetch(`${sitioRealSinRut}/recorrido`);
  const html = await recorrido.text();
  assert.equal(recorrido.status, 200);
  assert.match(html, /MINI_ERP_RUT/);
  // Sin empresa no hay widget que montar.
  assert.doesNotMatch(html, /journey\.js|enrolamiento\.js|id="portabilidad"/);
  assert.equal((await fetch(sitioRealSinRut)).status, 200);
});

test('con otro Host, como el de un túnel o un DNS rebinding, las pantallas y la sesión responden 403', async () => {
  pedidos.length = 0;
  responder = sesionCreada;
  for (const host of ['x.ngrok.app', `evil.test:${puerto}`, `localhost:${puerto + 1}`]) {
    assert.equal((await pedirConHost('/', { host })).status, 403, host);
    assert.equal((await pedirConHost('/estado', { host })).status, 403, host);
    assert.equal((await pedirConHost('/ventas', { host })).status, 403, host);
    assert.equal((await pedirConHost('/sesion', { host, metodo: 'POST' })).status, 403, host);
    assert.equal((await pedirConHost('/reiniciar', { host, metodo: 'POST' })).status, 403, host);
  }
  assert.equal(pedidos.length, 0);
  // Los del propio ERP, sí.
  assert.equal((await pedirConHost('/', { host: `localhost:${puerto}` })).status, 200);
  assert.equal((await pedirConHost('/', { host: `127.0.0.1:${puerto}` })).status, 200);
});

test('con otro Host, el aviso se procesa igual: llega por el túnel', async () => {
  const aviso = JSON.stringify({ evento: 'prueba', id: '0f8fad5b-d9cb-469f-a165-000000000999', fecha: '2026-11-28T15:04:05-03:00' });
  const firma = webhooks.firmar(aviso, SECRETO_DEL_AVISO);
  const respuesta = await pedirConHost('/webhooks/certificacion', {
    host: 'x.ngrok.app',
    metodo: 'POST',
    cabeceras: { 'Content-Type': 'application/json', 'X-Enrolamiento-Evento': 'prueba', ...firma },
    cuerpo: aviso,
  });
  assert.equal(respuesta.status, 200, respuesta.texto);
  assert.deepEqual(JSON.parse(respuesta.texto), { recibido: true });
});

test('un formulario de otro sitio no puede crear una sesión', async () => {
  pedidos.length = 0;
  responder = sesionCreada;
  const respuesta = await fetch(`${sitio}/sesion`, { method: 'POST', headers: { Origin: 'http://otro.test' } });
  assert.equal(respuesta.status, 403);
  assert.equal(pedidos.length, 0);
  assert.equal((await fetch(`${sitio}/sesion`, { method: 'POST', headers: { Origin: sitio } })).status, 200);
});

test('las respuestas JSON y la hoja de la marca llevan X-Content-Type-Options: nosniff', async () => {
  assert.equal((await fetch(`${sitio}/estado`)).headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${sitio}/marca.css`)).headers.get('x-content-type-options'), 'nosniff');
});

test('una ruta que no existe responde 404', async () => {
  assert.equal((await fetch(`${sitio}/no-existe`)).status, 404);
  assert.equal((await fetch(`${sitio}/sesion`)).status, 404);
});
