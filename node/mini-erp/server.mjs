// El Mini ERP: un software ficticio que trae los datos de la empresa con el widget de Portabilidad.
//
//   npm run mini-erp        (node --env-file=.env mini-erp/server.mjs)
//
// Este archivo arranca el servidor, reparte las rutas y pone las cabeceras. Lo que se lee del
// entorno está en config.mjs, el HTML de cada pantalla en views.mjs, los avisos en notices.mjs y lo
// importado en store.mjs.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import Enrolamiento, { ErrorDeApi, ErrorDeAutenticacion, ErrorDeConfiguracion } from 'enrolamiento';
import { leerConfig, leerCredenciales, SIN_RUT } from './config.mjs';
import { crearReceptor, leerCuerpo } from './notices.mjs';
import { crearSimulador, sinDirecciones } from './simulate.mjs';
import { abrirAlmacen, FORMA_DEL_ID } from './store.mjs';
import {
  hojaDeMarca,
  paginaContrapartes,
  paginaDocumento,
  paginaDocumentos,
  paginaInicio,
  paginaNoEncontrada,
  paginaProductos,
  paginaRecorrido,
} from './views.mjs';

const config = leerConfig(process.env);

// Lee ENROLAMIENTO_USUARIO y ENROLAMIENTO_APIKEY del entorno. La APIKey no sale de este proceso.
const enrolamiento = new Enrolamiento({ urlBase: config.urlBase });

// Lo importado del respaldo: en su sistema, su base de datos. Uno solo por proceso, para las
// pantallas y para el receptor de los avisos.
const almacen = abrirAlmacen(config.datos);
// Las mismas credenciales, para pedir la URL firmada del respaldo que trae el aviso.
const receptor = crearReceptor({ config, almacen, credenciales: leerCredenciales(process.env) });
// «Simular el aviso» corre el CLI del paquete con el entorno de este proceso. Solo en modo prueba.
const simulador = config.modo === 'prueba' ? crearSimulador({ config }) : null;

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
  respuesta
    .writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    .end(JSON.stringify(cuerpo));

// POST /sesion. En su sistema esta ruta exige la sesión de su usuario: quien no inició sesión no pide
// una. Del pedido solo se mira `seguir`: el navegador no elige el RUT ni el escenario.
async function crearSesion(pedido, respuesta, url) {
  // Una página de otro sitio no crea sesiones con su APIKey.
  if (!delPropioErp(pedido)) return json(respuesta, 403, { error: 'OTRO_ORIGEN', mensaje: 'Solo se crea la sesión desde el propio ERP.' });
  // Modo real sin MINI_ERP_RUT: no hay empresa para la sesión, y no se le pide nada a la API.
  if (config.rut === null) return json(respuesta, 500, { error: 'SIN_RUT', mensaje: SIN_RUT });
  const sesion = await enrolamiento.portabilidad.sesiones(
    config.modo === 'real'
      ? // Una sesión real: la empresa certifica ante el SII y el aviso llega de Enrolamiento.
        { rut: config.rut, prueba: false }
      : {
          rut: config.rut,
          prueba: true,
          // Con escenario, el guion de la empresa empieza de cero. Al renovar una sesión vencida no se
          // manda, y el recorrido sigue donde iba.
          ...(url.searchParams.has('seguir') ? {} : { escenario: 'camino_feliz' }),
        },
  );
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

const redirigir = (respuesta, ruta) => respuesta.writeHead(303, { Location: ruta }).end();

const texto = (respuesta, status, contenido, cabeceras = {}) =>
  respuesta.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...cabeceras }).end(contenido);

// Una lista del respaldo. Sin nada importado, lleva al inicio, que invita a traer la empresa.
const lista = (nombre, vista) => (pedido, respuesta) => {
  const datos = almacen.leer(nombre);
  if (datos === null) redirigir(respuesta, '/');
  else html(respuesta, 200, vista(datos));
};

// Ventas y compras, y la carpeta del almacén donde están sus XML y PDF.
const SENTIDO_DE = { ventas: 'emitidos', compras: 'recibidos' };
// /ventas/<id>, /ventas/<id>/pdf y /ventas/<id>/xml; lo mismo en compras.
const RUTA_DE_DOCUMENTO = /^\/(ventas|compras)\/([^/]+)(?:\/(pdf|xml))?$/;

// El id llega en la URL tal cual. Solo uno con la forma {RUT}_{TIPO}_{FOLIO}, y que esté en esa lista,
// llega al almacén: un id con %2F, .. o de la otra lista es 404.
function servirDocumento(respuesta, libro, id, tipo) {
  const sentido = SENTIDO_DE[libro];
  const documento = FORMA_DEL_ID.test(id) ? almacen.documento(sentido, id) : null;
  if (!documento) return html(respuesta, 404, paginaNoEncontrada(config));
  if (tipo === 'pdf') {
    const pdf = almacen.archivo(sentido, id, 'pdf');
    if (!pdf) return html(respuesta, 404, paginaNoEncontrada(config));
    // nosniff: el navegador lo trata como PDF y nada más, aunque el archivo traiga otra cosa adentro.
    return respuesta
      .writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${id}.pdf"`,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Cache-Control': 'no-cache',
      })
      .end(pdf);
  }
  if (tipo === 'xml') {
    const xml = almacen.archivo(sentido, id, 'xml');
    if (!xml) return html(respuesta, 404, paginaNoEncontrada(config));
    // Como adjunto: el navegador lo descarga y nunca lo abre como página de este origen.
    return respuesta
      .writeHead(200, {
        'Content-Type': 'application/xml',
        'Content-Disposition': `attachment; filename="${id}.xml"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      })
      .end(xml);
  }
  const xml = almacen.archivo(sentido, id, 'xml');
  const hayPdf = almacen.archivo(sentido, id, 'pdf') !== null;
  html(respuesta, 200, paginaDocumento(config, libro, documento, { xml, hayPdf }));
}

// Un formulario de otro sitio puede apuntar a este puerto. El navegador manda su Origin en un POST:
// se acepta sin Origin (curl) o con el del propio ERP, nada más.
const ORIGENES_PROPIOS = [`http://localhost:${config.puerto}`, `http://127.0.0.1:${config.puerto}`];
const delPropioErp = (pedido) => pedido.headers.origin === undefined || ORIGENES_PROPIOS.includes(pedido.headers.origin);

// A qué nombre se le pidió la página. El ERP se abre solo como localhost o 127.0.0.1, con su puerto. Otro
// Host es un túnel, que en modo real debe exponer solo los avisos (y aun así podría llegar todo), o una
// página que hace DNS rebinding: un nombre suyo que apunta a 127.0.0.1. Las dos ven 403.
const HOSTS_PROPIOS = [`localhost:${config.puerto}`, `127.0.0.1:${config.puerto}`];
const esUnAviso = (pedido, url) => pedido.method === 'POST' && url.pathname.startsWith('/webhooks/');
const conHostPropio = (pedido) => HOSTS_PROPIOS.includes(pedido.headers.host?.toLowerCase());

// POST /reiniciar: «Empezar de nuevo». Borra lo importado y el estado del aviso.
function reiniciar(pedido, respuesta) {
  if (!delPropioErp(pedido)) return texto(respuesta, 403, 'Solo se borran los datos desde el propio ERP.');
  almacen.borrar();
  redirigir(respuesta, '/');
}

// POST /simular: «Simular el aviso». Solo existe en modo prueba. Del pedido no se lee nada: ni la query
// ni el cuerpo llegan al proceso, que corre siempre el mismo comando, de a uno.
function simular(pedido, respuesta) {
  pedido.resume();
  if (!delPropioErp(pedido)) return texto(respuesta, 403, 'Solo se simula el aviso desde el propio ERP.');
  if (simulador.simular().corriendo) return json(respuesta, 409, { error: 'YA_CORRE', mensaje: 'El aviso ya se está simulando.' });
  json(respuesta, 202, { corriendo: true });
}

// GET /estado: en qué va el aviso y, en modo prueba, la salida de «Simular el aviso». La página lo
// consulta cada 2 segundos. Sin direcciones: ni la URL firmada ni la de la API llegan al navegador.
function estadoDelAviso(pedido, respuesta) {
  const { fase, detalle } = almacen.estado();
  const cuerpo = { fase, detalle: sinDirecciones(detalle) };
  if (simulador) cuerpo.simulacion = { corriendo: simulador.corriendo(), ...simulador.salida() };
  json(respuesta, 200, cuerpo);
}

const RUTAS = {
  'GET /': (pedido, respuesta) => html(respuesta, 200, paginaInicio(config, almacen.resumen())),
  'GET /recorrido': (pedido, respuesta) => html(respuesta, 200, paginaRecorrido(config)),
  // El navegador pide un ícono por su cuenta. El ERP no tiene uno: 204 y sin un 404 en la consola.
  'GET /favicon.ico': (pedido, respuesta) => respuesta.writeHead(204, { 'Cache-Control': 'max-age=86400' }).end(),
  'GET /marca.css': (pedido, respuesta) =>
    respuesta
      .writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' })
      .end(hojaDeMarca(config.marca)),
  'POST /sesion': crearSesion,
  'POST /webhooks/certificacion': recibirAviso,
  'POST /webhooks/respaldo': recibirAviso,
  'GET /productos': lista('productos', (datos) => paginaProductos(config, datos)),
  'GET /clientes': lista('clientes', (datos) => paginaContrapartes(config, 'clientes', datos)),
  'GET /proveedores': lista('proveedores', (datos) => paginaContrapartes(config, 'proveedores', datos)),
  'GET /ventas': lista('ventas', (datos) => paginaDocumentos(config, 'ventas', datos)),
  'GET /compras': lista('compras', (datos) => paginaDocumentos(config, 'compras', datos)),
  'POST /reiniciar': reiniciar,
  // Borrar no va por GET: un enlace o una precarga del navegador no deben poder hacerlo.
  'GET /reiniciar': (pedido, respuesta) => texto(respuesta, 405, 'Use el botón «Borrar los datos» del inicio.', { Allow: 'POST' }),
  'GET /estado': estadoDelAviso,
  // «Simular el aviso» existe solo en modo prueba: en modo real, la ruta es un 404 como cualquier otra.
  ...(simulador ? { 'POST /simular': simular } : {}),
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
    console.error(`La API respondió ${error.status}${error.codigo ? ` ${error.codigo}` : ''}: ${error.mensaje} (${error.urlDeAyuda})`);
    // 401: la API no aceptó su usuario y su APIKey. Lo arregla el .env, no un reintento.
    if (error instanceof ErrorDeAutenticacion) {
      json(respuesta, 502, {
        error: 'CREDENCIALES_RECHAZADAS',
        mensaje: 'La API rechazó las credenciales: revise ENROLAMIENTO_USUARIO y ENROLAMIENTO_APIKEY en el .env y reinicie el Mini ERP.',
      });
      return;
    }
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
    // Los avisos llegan con el Host del túnel y se verifican por su firma. Todo lo demás, solo con el del ERP.
    if (!esUnAviso(pedido, url) && !conHostPropio(pedido)) {
      pedido.resume();
      return texto(respuesta, 403, `Abra el ERP en http://localhost:${config.puerto}.`);
    }
    const ruta = RUTAS[`${pedido.method} ${url.pathname}`];
    if (ruta) await ruta(pedido, respuesta, url);
    else if (pedido.method === 'GET' && Object.hasOwn(PUBLICOS, url.pathname)) await servirPublico(respuesta, url.pathname);
    else if (pedido.method === 'GET' && RUTA_DE_DOCUMENTO.test(url.pathname)) servirDocumento(respuesta, ...RUTA_DE_DOCUMENTO.exec(url.pathname).slice(1));
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
