// Arranca el receptor en un puerto libre y le envía avisos como lo haría Enrolamiento.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { webhooks } from 'enrolamiento';

const SECRETO = 'a'.repeat(64);
let receptor;
let destino;

const puertoLibre = () =>
  new Promise((listo) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => listo(port));
    });
  });

before(async () => {
  const puerto = await puertoLibre();
  destino = `http://127.0.0.1:${puerto}`;
  receptor = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { ...process.env, ENROLAMIENTO_WEBHOOK_SECRETO: SECRETO, PUERTO: String(puerto) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((listo, fallo) => {
    receptor.stdout.on('data', (texto) => String(texto).includes('escuchando') && listo());
    receptor.once('exit', (codigo) => fallo(new Error(`el receptor salió con ${codigo}`)));
  });
});

after(() => receptor?.kill());

const enviar = (cuerpo, cabeceras) => fetch(destino, { method: 'POST', headers: cabeceras, body: cuerpo });
const aviso = (id) => JSON.stringify({ evento: 'prueba', id, fecha: new Date().toISOString() });

test('acepta un aviso bien firmado, y su repetición', async () => {
  const cuerpo = aviso('5a7e9d10-2b3c-4f6a-8d1e-7c9b0a4e6f21');
  const firma = webhooks.firmar(cuerpo, SECRETO);
  assert.equal((await enviar(cuerpo, firma)).status, 204);
  assert.equal((await enviar(cuerpo, firma)).status, 204);
});

test('rechaza un cuerpo cambiado, otro secreto y un aviso sin firma', async () => {
  const cuerpo = aviso('0b6f1c2e-5d4a-4c1e-9a52-3e7d8f1a2b3c');
  assert.equal((await enviar(cuerpo.replace('prueba', 'otro'), webhooks.firmar(cuerpo, SECRETO))).status, 401);
  assert.equal((await enviar(cuerpo, webhooks.firmar(cuerpo, 'b'.repeat(64)))).status, 401);
  assert.equal((await enviar(cuerpo, {})).status, 401);
});

test('rechaza un aviso firmado hace una hora', async () => {
  const cuerpo = aviso('7c9e6679-7425-40de-944b-e07fc1f90ae7');
  const vieja = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  assert.equal((await enviar(cuerpo, webhooks.firmar(cuerpo, SECRETO, vieja))).status, 401);
});

test('solo acepta POST', async () => {
  assert.equal((await fetch(destino)).status, 405);
});
