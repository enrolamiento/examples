// «Simular el aviso»: en modo prueba, el servidor corre el CLI del paquete como proceso hijo y la página
// muestra su salida. Es el mismo comando que `npm run mini-erp:aviso` en otra terminal:
//
//   enrolamiento webhooks enviar certificacion.finalizada --url http://localhost:<puerto>/webhooks/certificacion
//
// El CLI firma un aviso con ENROLAMIENTO_WEBHOOK_SECRETO (lo lee del entorno del servidor, el mismo con el
// que verifica el receptor) y deja el respaldo de ejemplo para descargar desde 127.0.0.1.
//
// Nada del pedido llega al proceso: los argumentos son fijos, sin shell, y corre uno a la vez. La salida
// que se guarda no lleva direcciones ni el secreto.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// El CLI del paquete, instalado con npm i. El mismo archivo que corre el script mini-erp:aviso.
const CLI = fileURLToPath(new URL('../node_modules/enrolamiento/dist/cli.js', import.meta.url));
// Los argumentos, siempre estos. Solo se les agrega la url del receptor, armada con el puerto de config.
const ARGUMENTOS = Object.freeze(['webhooks', 'enviar', 'certificacion.finalizada', '--url']);
// El CLI espera la descarga hasta 120 s (--esperar por omisión): pasado este tope, se corta.
export const TOPE_MS = 150_000;
// Cuánto se guarda de la salida: lo que cabe en la pantalla, no un log sin fin.
const TOPE_DE_LINEAS = 200;
const LARGO_DE_LINEA = 500;
// Después de SIGTERM, cuánto se espera antes de SIGKILL.
const GRACIA_MS = 5_000;

const DIRECCION = /\bhttps?:\/\/[^\s"'<>()]*[^\s"'<>().,:;!?]/g;

// Cambia cualquier dirección http(s) por «[dirección]». Ni la URL firmada ni la de la API llegan a la página.
export function sinDirecciones(texto) {
  return typeof texto === 'string' ? texto.replace(DIRECCION, '[dirección]') : texto;
}

const segundos = (ms) => (ms / 1000).toLocaleString('es-CL');

// entorno: el del servidor (process.env), con ENROLAMIENTO_WEBHOOK_SECRETO. cli y topeMs se cambian en las pruebas.
export function crearSimulador({ config, ejecutable = process.execPath, cli = CLI, entorno = process.env, topeMs = TOPE_MS }) {
  const receptor = `http://localhost:${config.puerto}/webhooks/certificacion`;
  const argumentos = Object.freeze([cli, ...ARGUMENTOS, receptor]);
  // Lo que se saca de cada línea: la url del receptor queda como su ruta; el secreto, nunca.
  const secreto = entorno.ENROLAMIENTO_WEBHOOK_SECRETO || null;

  let proceso = null;
  let lineas = [];
  let termino = false;
  let codigo = null;

  function anotar(linea) {
    let limpia = linea.replaceAll(receptor, '/webhooks/certificacion');
    if (secreto) limpia = limpia.replaceAll(secreto, '[secreto]');
    limpia = sinDirecciones(limpia).slice(0, LARGO_DE_LINEA);
    lineas.push(limpia);
    if (lineas.length > TOPE_DE_LINEAS) lineas.splice(0, lineas.length - TOPE_DE_LINEAS);
  }

  // Junta los trozos de un flujo y anota cada línea completa; la última, al cerrar.
  function leerLineas(flujo) {
    let resto = '';
    flujo.setEncoding('utf8');
    flujo.on('data', (trozo) => {
      const partes = (resto + trozo).split(/\r?\n/);
      resto = partes.pop();
      for (const parte of partes) anotar(parte);
    });
    return () => {
      if (resto !== '') anotar(resto);
      resto = '';
    };
  }

  function terminar(hijo, conCodigo, mensaje) {
    if (proceso !== hijo) return;
    if (mensaje) anotar(mensaje);
    codigo = conCodigo;
    termino = true;
    proceso = null;
  }

  // Lanza el CLI si no hay otro corriendo. { corriendo: true } quiere decir que ya había uno y no se lanzó otro.
  function simular() {
    if (proceso !== null) return { corriendo: true };
    lineas = [];
    termino = false;
    codigo = null;

    if (!existsSync(cli)) {
      anotar('No está instalado el paquete enrolamiento: corra npm i en la carpeta node/.');
      termino = true;
      return { corriendo: false };
    }

    // Sin shell: cada argumento llega tal cual, y ninguno sale del pedido.
    const hijo = spawn(ejecutable, argumentos, { env: entorno, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
    proceso = hijo;
    const cerrarSalida = leerLineas(hijo.stdout);
    const cerrarErrores = leerLineas(hijo.stderr);

    let cortado = false;
    let rematar;
    const reloj = setTimeout(() => {
      cortado = true;
      hijo.kill('SIGTERM');
      rematar = setTimeout(() => hijo.kill('SIGKILL'), GRACIA_MS);
      rematar.unref();
    }, topeMs);
    reloj.unref();

    hijo.once('error', (error) => {
      clearTimeout(reloj);
      clearTimeout(rematar);
      terminar(hijo, null, `No se pudo ejecutar el CLI: ${error.code ?? error.message}.`);
    });
    hijo.once('close', (salida) => {
      clearTimeout(reloj);
      clearTimeout(rematar);
      cerrarSalida();
      cerrarErrores();
      terminar(hijo, cortado ? null : salida, cortado ? `El comando no terminó en ${segundos(topeMs)} s: se cortó.` : null);
    });
    return { corriendo: false };
  }

  function salida() {
    return { lineas: [...lineas], termino, codigo };
  }

  const corriendo = () => proceso !== null;

  return { simular, salida, corriendo };
}
