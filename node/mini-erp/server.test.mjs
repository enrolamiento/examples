// Arranca el Mini ERP contra una API falsa en esta máquina y comprueba lo que le pide a la API y lo
// que le entrega al navegador.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDGET = 'https://widget.enrolamiento.cl';
const SECRETO = `wst_${'3f9c2a7e5b1d4c08a6e2f0b9d7c41e53'}_${'Ejemplo'.repeat(6)}E`;
const CSP = `default-src 'self'; script-src 'self' ${WIDGET}; frame-src 'self' ${WIDGET}; object-src 'none'`;
const pedidos = [];
const procesos = [];
const carpetas = [];
let responder;
let api;
let sitio;
let sitioSinCredenciales;
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
    MINI_ERP_NOMBRE: '<b>x',
    MINI_ERP_COLOR: '#0b5fff',
  });
  sitio = `http://127.0.0.1:${puerto}`;

  const otro = await arrancar({ ENROLAMIENTO_USUARIO: '', ENROLAMIENTO_APIKEY: '', ENROLAMIENTO_URL: urlDeLaApi, ENROLAMIENTO_WIDGET: WIDGET });
  sitioSinCredenciales = `http://127.0.0.1:${otro}`;
});

after(async () => {
  for (const erp of procesos) erp.kill();
  api?.close();
  for (const carpeta of carpetas) await rm(carpeta, { recursive: true, force: true });
});

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

test('una ruta que no existe responde 404', async () => {
  assert.equal((await fetch(`${sitio}/no-existe`)).status, 404);
  assert.equal((await fetch(`${sitio}/sesion`)).status, 404);
});
