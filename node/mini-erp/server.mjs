// El Mini ERP: un software ficticio que trae los datos de la empresa con el widget de Portabilidad.
//
//   npm run mini-erp        (node --env-file=.env mini-erp/server.mjs)
//
// Este archivo arranca el servidor, reparte las rutas y pone las cabeceras. Lo que se lee del
// entorno está en config.mjs, el HTML de cada pantalla en views.mjs y los avisos en notices.mjs.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import Enrolamiento, { ErrorDeApi, ErrorDeConfiguracion } from 'enrolamiento';
import { leerConfig, leerCredenciales, RUT_DE_LA_EMPRESA } from './config.mjs';
import { crearReceptor, leerCuerpo } from './notices.mjs';
import { abrirAlmacen } from './store.mjs';
import { hojaDeMarca, paginaInicio, paginaNoEncontrada, paginaRecorrido } from './views.mjs';

const config = leerConfig(process.env);

// Lee ENROLAMIENTO_USUARIO y ENROLAMIENTO_APIKEY del entorno. La APIKey no sale de este proceso.
const enrolamiento = new Enrolamiento({ urlBase: config.urlBase });

const almacen = abrirAlmacen(config.datos);
// Las mismas credenciales, para pedir la URL firmada del respaldo que trae el aviso.
const receptor = crearReceptor({ config, almacen, credenciales: leerCredenciales(process.env) });

// Lo propio, más el script y el iframe del widget. 'self' en frame-src es para el PDF de los
// documentos, que se sirve desde este mismo origen. Sin 'unsafe-inline': las páginas no lo necesitan.
const CSP = `default-src 'self'; script-src 'self' ${config.widget}; frame-src 'self' ${config.widget}; object-src 'none'`;

// Los únicos archivos que se sirven de public/: una lista, no una carpeta abierta.
const PUBLICOS = {
  '/public/app.css': ['./public/app.css', 'text/css; charset=utf-8'],
  '/public/journey.js': ['./public/journey.js', 'text/javascript; charset=utf-8'],
};

const html = (respuesta, status, contenido) =>
  respuesta
    .writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' })
    .end(contenido);

const json = (respuesta, status, cuerpo) =>
  respuesta.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(cuerpo));

// POST /sesion. En su sistema esta ruta exige la sesión de su usuario: quien no inició sesión no pide
// una. Del pedido solo se mira `seguir`: el navegador no elige el RUT ni el escenario.
async function crearSesion(pedido, respuesta, url) {
  const sesion = await enrolamiento.portabilidad.sesiones({
    rut: RUT_DE_LA_EMPRESA,
    prueba: true,
    // Con escenario, el guion de la empresa empieza de cero. Al renovar una sesión vencida no se
    // manda, y el recorrido sigue donde iba.
    ...(url.searchParams.has('seguir') ? {} : { escenario: 'camino_feliz' }),
  });
  // Hay un recorrido en curso: el receptor espera su aviso. Renovar una sesión no borra lo que ya se sabe.
  if (!url.searchParams.has('seguir') || almacen.estado().fase === 'vacio') almacen.anotar({ fase: 'esperando' });
  // Al navegador va solo el client_secret: vale 60 minutos y sirve solo para esta empresa.
  json(respuesta, 200, { client_secret: sesion.client_secret });
}

// POST /webhooks/certificacion y /webhooks/respaldo. Se responde antes de descargar: la API espera
// 10 segundos y el respaldo tarda más.
async function recibirAviso(pedido, respuesta, url) {
  const cuerpo = await leerCuerpo(pedido);
  if (cuerpo === null) {
    respuesta.on('finish', () => pedido.destroy());
    json(respuesta, 413, { error: 'AVISO_DEMASIADO_GRANDE' });
    return;
  }
  const { status, cuerpo: salida, despues } = receptor.recibir(url.pathname, cuerpo, pedido.headers);
  json(respuesta, status, salida);
  despues?.catch((error) => console.error(error));
}

const RUTAS = {
  'GET /': (pedido, respuesta) => html(respuesta, 200, paginaInicio(config)),
  'GET /recorrido': (pedido, respuesta) => html(respuesta, 200, paginaRecorrido(config)),
  'GET /marca.css': (pedido, respuesta) =>
    respuesta.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' }).end(hojaDeMarca(config.marca)),
  'POST /sesion': crearSesion,
  'POST /webhooks/certificacion': recibirAviso,
  'POST /webhooks/respaldo': recibirAviso,
};

async function servirPublico(respuesta, ruta) {
  const [archivo, tipo] = PUBLICOS[ruta];
  const contenido = await readFile(new URL(archivo, import.meta.url));
  respuesta.writeHead(200, { 'Content-Type': tipo, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' }).end(contenido);
}

// El error, para el navegador: un código y un texto para la pantalla, nunca el mensaje de la API.
function responderError(respuesta, error) {
  if (error instanceof ErrorDeConfiguracion) {
    console.error(error.message);
    json(respuesta, 500, { error: 'SIN_CREDENCIALES', mensaje: 'Faltan las credenciales en el servidor: defina ENROLAMIENTO_USUARIO y ENROLAMIENTO_APIKEY en el .env.' });
    return;
  }
  if (error instanceof ErrorDeApi) {
    // Decida por el código, no por el status. Un 404 sin código es el widget sin habilitar para su cuenta.
    console.error(`La API respondió ${error.status} ${error.codigo ?? ''}: ${error.mensaje} (${error.urlDeAyuda})`);
    if (error.status === 404 && error.codigo === null) {
      json(respuesta, 502, { error: 'WIDGET_NO_HABILITADO', mensaje: 'El widget no está habilitado para su cuenta.' });
      return;
    }
    const codigo = error.codigo ?? 'SIN_CODIGO';
    json(respuesta, 502, { error: codigo, mensaje: `La API respondió ${codigo}. Mire la consola del servidor.` });
    return;
  }
  console.error(error);
  json(respuesta, 500, { error: 'FALLA_DEL_SERVIDOR', mensaje: 'Falló el servidor. Mire su consola.' });
}

const servidor = createServer(async (pedido, respuesta) => {
  const url = new URL(pedido.url, 'http://localhost');
  try {
    const ruta = RUTAS[`${pedido.method} ${url.pathname}`];
    if (ruta) await ruta(pedido, respuesta, url);
    else if (pedido.method === 'GET' && Object.hasOwn(PUBLICOS, url.pathname)) await servirPublico(respuesta, url.pathname);
    else html(respuesta, 404, paginaNoEncontrada(config));
  } catch (error) {
    responderError(respuesta, error);
  }
});

// Solo en esta máquina: el ERP de ejemplo no se expone a la red. En modo real, el aviso llega por un
// túnel que apunta a este puerto.
servidor.listen(config.puerto, '127.0.0.1', () =>
  console.log(`${config.marca.nombre}: abra http://localhost:${config.puerto} (escuchando en 127.0.0.1:${config.puerto}, modo ${config.modo})`),
);
