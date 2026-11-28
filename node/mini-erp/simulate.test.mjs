// «Simular el aviso»: el servidor corre el CLI del paquete como proceso hijo, de a uno, con argumentos
// fijos y el entorno del servidor. Primero el simulador solo, con CLI falsos que anotan lo que reciben o
// no terminan; después el Mini ERP de verdad, que recibe el aviso del CLI real e importa el respaldo.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerConfig } from './config.mjs';
import { crearSimulador, sinDirecciones } from './simulate.mjs';

const SECRETO = 'secreto-de-prueba-simular';
const CLIENT_SECRET = `wst_${'3f9c2a7e5b1d4c08a6e2f0b9d7c41e53'}_${'Ejemplo'.repeat(6)}E`;
const carpetas = [];
const procesos = [];
const servidores = [];

after(async () => {
  for (const proceso of procesos) proceso.kill();
  for (const servidor of servidores) servidor.close();
  for (const carpeta of carpetas) await rm(carpeta, { recursive: true, force: true });
});

async function carpetaTemporal(prefijo) {
  const carpeta = await mkdtemp(join(tmpdir(), prefijo));
  carpetas.push(carpeta);
  return carpeta;
}

// Un CLI falso: un módulo de Node con este cuerpo, en una carpeta temporal.
async function cliFalso(cuerpo) {
  const archivo = join(await carpetaTemporal('mini-erp-cli-'), 'cli.mjs');
  await writeFile(archivo, cuerpo);
  return archivo;
}

// Espera hasta que `condicion` devuelva algo, consultando cada 50 ms.
async function esperarHasta(condicion, ms = 10_000) {
  const limite = Date.now() + ms;
  for (;;) {
    const valor = await condicion();
    if (valor) return valor;
    if (Date.now() > limite) throw new Error('se agotó la espera');
    await new Promise((listo) => setTimeout(listo, 50));
  }
}

const sinSecreto = () => {
  const entorno = { ...process.env };
  delete entorno.ENROLAMIENTO_WEBHOOK_SECRETO;
  return entorno;
};

const config = leerConfig({ PUERTO: '3999', MINI_ERP_DATOS: tmpdir() });

test('corre de a uno, con los argumentos fijos y la url armada con el puerto de config', async () => {
  const anotaciones = join(await carpetaTemporal('mini-erp-anota-'), 'argumentos.txt');
  const cli = await cliFalso(
    `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.ANOTAR_EN, JSON.stringify(process.argv.slice(2)) + '\\n');
setTimeout(() => console.log('terminé'), 300);`,
  );
  const simulador = crearSimulador({ config, cli, entorno: { ...process.env, ANOTAR_EN: anotaciones } });

  assert.equal(simulador.simular.length, 0, 'simular no recibe nada del pedido');
  assert.deepEqual(simulador.simular(), { corriendo: false });
  assert.deepEqual(simulador.simular(), { corriendo: true }, 'el segundo no lanza otro proceso');
  const salida = await esperarHasta(() => (simulador.salida().termino ? simulador.salida() : null));

  assert.deepEqual(salida, { lineas: ['terminé'], termino: true, codigo: 0 });
  const lanzados = (await readFile(anotaciones, 'utf8')).trim().split('\n');
  assert.equal(lanzados.length, 1);
  assert.deepEqual(JSON.parse(lanzados[0]), [
    'webhooks',
    'enviar',
    'certificacion.finalizada',
    '--url',
    'http://localhost:3999/webhooks/certificacion',
  ]);
});

test('sin ENROLAMIENTO_WEBHOOK_SECRETO el CLI real sale con 2, su mensaje queda en la salida y se puede volver a simular', async () => {
  const simulador = crearSimulador({ config, entorno: sinSecreto() });
  assert.deepEqual(simulador.simular(), { corriendo: false });
  const salida = await esperarHasta(() => (simulador.salida().termino ? simulador.salida() : null));

  assert.equal(salida.codigo, 2);
  assert.ok(salida.lineas.some((linea) => linea.includes('Falta ENROLAMIENTO_WEBHOOK_SECRETO')), salida.lineas.join('\n'));
  assert.deepEqual(simulador.simular(), { corriendo: false }, 'quedó disponible');
  assert.deepEqual(simulador.salida(), { lineas: [], termino: false, codigo: null }, 'la salida empieza de nuevo');
  await esperarHasta(() => simulador.salida().termino);
});

test('un proceso que no termina se corta en el tope y el simulador queda disponible otra vez', async () => {
  const cli = await cliFalso(`console.log('empecé'); setInterval(() => {}, 1000);`);
  const simulador = crearSimulador({ config, cli, topeMs: 400 });
  simulador.simular();
  const salida = await esperarHasta(() => (simulador.salida().termino ? simulador.salida() : null));

  assert.equal(salida.codigo, null);
  assert.equal(salida.lineas[0], 'empecé');
  assert.match(salida.lineas.at(-1), /no terminó en 0,4 s: se cortó/);
  assert.deepEqual(simulador.simular(), { corriendo: false });
  await esperarHasta(() => simulador.salida().termino);
});

test('un ejecutable que no existe deja el error en la salida y no tumba el servidor', async () => {
  const simulador = crearSimulador({ config, ejecutable: join(tmpdir(), 'no-existe-este-node') });
  simulador.simular();
  const salida = await esperarHasta(() => (simulador.salida().termino ? simulador.salida() : null));
  assert.equal(salida.codigo, null);
  assert.match(salida.lineas.at(-1), /No se pudo ejecutar el CLI/);
  assert.deepEqual(simulador.simular(), { corriendo: false });
  await esperarHasta(() => simulador.salida().termino);
});

test('la salida no lleva direcciones ni el secreto, aunque el proceso los escriba', async () => {
  const cli = await cliFalso(
    `console.log('Aviso enviado a http://localhost:3999/webhooks/certificacion: respondió 200 en 3 ms.');
console.error('firmada: https://almacen.test/respaldo.zip?firma=abc y el secreto ${SECRETO}');`,
  );
  const simulador = crearSimulador({ config, cli, entorno: { ...process.env, ENROLAMIENTO_WEBHOOK_SECRETO: SECRETO } });
  simulador.simular();
  const salida = await esperarHasta(() => (simulador.salida().termino ? simulador.salida() : null));
  const todo = salida.lineas.join('\n');

  assert.ok(salida.lineas.includes('Aviso enviado a /webhooks/certificacion: respondió 200 en 3 ms.'), todo);
  assert.doesNotMatch(todo, /https?:\/\/|almacen\.test|firma=abc/);
  assert.ok(!todo.includes(SECRETO));
});

test('un secreto de menos de 8 caracteres no se enmascara: la salida queda legible; uno de 8 o más, sí', async () => {
  const cli = await cliFalso(`console.log('Aviso enviado a http://localhost:3999/webhooks/certificacion: respondió 200 en 3 ms.');
console.log('Listo: su receptor aceptó el aviso y descargó el respaldo. clave12x');`);
  const corto = crearSimulador({ config, cli, entorno: { ...process.env, ENROLAMIENTO_WEBHOOK_SECRETO: 'a' } });
  corto.simular();
  const salida = await esperarHasta(() => (corto.salida().termino ? corto.salida() : null));
  assert.deepEqual(salida.lineas, [
    'Aviso enviado a /webhooks/certificacion: respondió 200 en 3 ms.',
    'Listo: su receptor aceptó el aviso y descargó el respaldo. clave12x',
  ]);

  const largo = crearSimulador({ config, cli, entorno: { ...process.env, ENROLAMIENTO_WEBHOOK_SECRETO: 'clave12x' } });
  largo.simular();
  const otra = await esperarHasta(() => (largo.salida().termino ? largo.salida() : null));
  assert.equal(otra.lineas[1], 'Listo: su receptor aceptó el aviso y descargó el respaldo. [secreto]');
});

test('sinDirecciones saca cualquier dirección http(s) y deja la puntuación que la sigue', () => {
  assert.equal(sinDirecciones('la API configurada (http://127.0.0.1:4000).'), 'la API configurada ([dirección]).');
  assert.equal(sinDirecciones('vaya a https://a.test/x?y=1, luego'), 'vaya a [dirección], luego');
  assert.equal(sinDirecciones('sin nada'), 'sin nada');
  assert.equal(sinDirecciones(null), null);
});

// --- El Mini ERP de verdad ------------------------------------------------------------------------

const escuchar = (servidor) => new Promise((listo) => servidor.listen(0, '127.0.0.1', () => listo(servidor.address().port)));

async function puertoLibre() {
  const libre = createServer();
  const numero = await escuchar(libre);
  await new Promise((listo) => libre.close(listo));
  return numero;
}

// La API falsa: solo crea sesiones. La descarga del respaldo la imita el CLI.
async function apiFalsa() {
  const api = createServer((pedido, respuesta) => {
    pedido.resume();
    pedido.on('end', () =>
      respuesta
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ id: '3f9c2a7e5b1d4c08a6e2f0b9d7c41e53', client_secret: CLIENT_SECRET, expira: '2026-11-28T16:04:05-03:00', prueba: true })),
    );
  });
  servidores.push(api);
  return `http://127.0.0.1:${await escuchar(api)}`;
}

async function arrancar(env) {
  const numero = await puertoLibre();
  const erp = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: {
      ...process.env,
      PUERTO: String(numero),
      MINI_ERP_DATOS: await carpetaTemporal('mini-erp-simular-'),
      ENROLAMIENTO_USUARIO: '11111111-1',
      ENROLAMIENTO_APIKEY: 'apikey-de-prueba',
      ENROLAMIENTO_URL: await apiFalsa(),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  procesos.push(erp);
  await new Promise((listo, fallo) => {
    erp.stdout.on('data', (texto) => String(texto).includes('escuchando') && listo());
    erp.once('exit', (codigo) => fallo(new Error(`el Mini ERP salió con ${codigo}`)));
  });
  return `http://127.0.0.1:${numero}`;
}

const estado = async (sitio) => (await fetch(`${sitio}/estado`)).json();

test('modo prueba: «Simular el aviso» corre el CLI real, de a uno, sin nada del pedido, y el ERP importa el respaldo', async () => {
  const sitio = await arrancar({ ENROLAMIENTO_WEBHOOK_SECRETO: SECRETO });
  assert.equal((await fetch(`${sitio}/sesion`, { method: 'POST' })).status, 200);

  // La query y el cuerpo intentan cambiar el comando: no llegan al proceso.
  const primera = await fetch(`${sitio}/simular?url=http://otro.test/x&esperar=1`, {
    method: 'POST',
    headers: { Origin: sitio, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://otro.test/x', argumentos: ['--permitir-remoto'], secreto: 'otro' }),
  });
  assert.equal(primera.status, 202);
  const segunda = await fetch(`${sitio}/simular`, { method: 'POST', headers: { Origin: sitio } });
  assert.equal(segunda.status, 409);

  const final = await esperarHasta(async () => {
    const actual = await estado(sitio);
    return actual.fase === 'listo' && actual.simulacion.termino ? actual : null;
  }, 60_000);
  assert.equal(final.simulacion.codigo, 0);
  assert.equal(final.simulacion.corriendo, false);
  assert.ok(final.simulacion.lineas.includes('Listo: su receptor aceptó el aviso y descargó el respaldo.'), final.simulacion.lineas.join('\n'));
  assert.ok(final.simulacion.lineas.some((linea) => linea.startsWith('Aviso certificacion.finalizada enviado a /webhooks/certificacion: respondió 200')));
  assert.match(final.detalle, /20 ventas y 10 compras/);

  const respuesta = await fetch(`${sitio}/estado`);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  const texto = await respuesta.text();
  assert.doesNotMatch(texto, /https?:\/\/|otro\.test|apikey-de-prueba/);
  assert.ok(!texto.includes(SECRETO));
  assert.deepEqual(Object.keys(JSON.parse(texto)).sort(), ['detalle', 'fase', 'simulacion']);
});

test('modo prueba: sin el secreto, la página recibe el mensaje del CLI y el botón vuelve a servir', async () => {
  const sitio = await arrancar({ ENROLAMIENTO_WEBHOOK_SECRETO: '' });
  assert.equal((await fetch(`${sitio}/simular`, { method: 'POST' })).status, 202);
  const final = await esperarHasta(async () => {
    const actual = await estado(sitio);
    return actual.simulacion.termino ? actual : null;
  });
  assert.equal(final.simulacion.codigo, 2);
  assert.ok(final.simulacion.lineas.some((linea) => linea.includes('Falta ENROLAMIENTO_WEBHOOK_SECRETO')));
  assert.equal((await fetch(`${sitio}/simular`, { method: 'POST' })).status, 202);
});

test('modo prueba: un formulario de otro sitio no puede simular', async () => {
  const sitio = await arrancar({ ENROLAMIENTO_WEBHOOK_SECRETO: SECRETO });
  const respuesta = await fetch(`${sitio}/simular`, { method: 'POST', headers: { Origin: 'http://otro.test' } });
  assert.equal(respuesta.status, 403);
  assert.equal((await estado(sitio)).simulacion.corriendo, false);
});

test('modo real: POST /simular no existe y el estado no trae la simulación', async () => {
  const sitio = await arrancar({ MINI_ERP_MODO: 'real', ENROLAMIENTO_WEBHOOK_SECRETO: SECRETO });
  assert.equal((await fetch(`${sitio}/simular`, { method: 'POST' })).status, 404);
  const actual = await estado(sitio);
  assert.deepEqual(actual, { fase: 'vacio', detalle: null });
});

// La página no se puede abrir en estas pruebas (sin navegador): se revisa el script.
test('el recorrido revisa que cargó el script del widget antes de pedir la sesión', async () => {
  const js = await readFile(new URL('./public/journey.js', import.meta.url), 'utf8');
  const revisa = js.indexOf("typeof Enrolamiento !== 'function'");
  assert.ok(revisa > 0);
  assert.ok(revisa < js.indexOf("await pedirSesion('/sesion')"));
  assert.match(js, /No cargó el script del widget/);
});

test('el panel de espera simula el aviso con POST /simular, consulta /estado cada 2 s y va al inicio al quedar listo', async () => {
  const js = await readFile(new URL('./public/journey.js', import.meta.url), 'utf8');
  assert.match(js, /fetch\('\/simular', \{ method: 'POST' \}\)/);
  assert.match(js, /fetch\('\/estado'/);
  assert.match(js, /setInterval\(consultarEstado, 2000\)/);
  assert.match(js, /fase === 'listo'/);
  assert.match(js, /location\.assign\('\/'\)/);
  assert.ok(js.includes('webhooks enviar certificacion.finalizada --url http://localhost:'));
  assert.ok(js.includes('npm run mini-erp:aviso'));
  assert.match(js, /Simular el aviso/);
  // La salida del CLI se pinta como texto, nunca como HTML.
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|document\.write/);
});
