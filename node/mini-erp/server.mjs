// El Mini ERP: un software ficticio que trae los datos de la empresa con el widget de Portabilidad.
//
//   npm run mini-erp        (node --env-file=.env mini-erp/server.mjs)
//
// Este archivo arranca el servidor, reparte las rutas y pone las cabeceras. Lo que se lee del
// entorno está en config.mjs, el HTML de cada pantalla en views.mjs y lo importado en store.mjs.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import Enrolamiento, { ErrorDeApi, ErrorDeConfiguracion } from 'enrolamiento';
import { leerConfig, RUT_DE_LA_EMPRESA } from './config.mjs';
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

// Lo importado del respaldo: en su sistema, su base de datos.
const almacen = abrirAlmacen(config.datos);

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
  // Al navegador va solo el client_secret: vale 60 minutos y sirve solo para esta empresa.
  json(respuesta, 200, { client_secret: sesion.client_secret });
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

// POST /reiniciar: «Empezar de nuevo». Borra lo importado y el estado del aviso.
function reiniciar(pedido, respuesta) {
  if (!delPropioErp(pedido)) return texto(respuesta, 403, 'Solo se borran los datos desde el propio ERP.');
  almacen.borrar();
  redirigir(respuesta, '/');
}

const RUTAS = {
  'GET /': (pedido, respuesta) => html(respuesta, 200, paginaInicio(config, almacen.resumen())),
  'GET /recorrido': (pedido, respuesta) => html(respuesta, 200, paginaRecorrido(config)),
  'GET /marca.css': (pedido, respuesta) =>
    respuesta.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' }).end(hojaDeMarca(config.marca)),
  'POST /sesion': crearSesion,
  'GET /productos': lista('productos', (datos) => paginaProductos(config, datos)),
  'GET /clientes': lista('clientes', (datos) => paginaContrapartes(config, 'clientes', datos)),
  'GET /proveedores': lista('proveedores', (datos) => paginaContrapartes(config, 'proveedores', datos)),
  'GET /ventas': lista('ventas', (datos) => paginaDocumentos(config, 'ventas', datos)),
  'GET /compras': lista('compras', (datos) => paginaDocumentos(config, 'compras', datos)),
  'POST /reiniciar': reiniciar,
  // Borrar no va por GET: un enlace o una precarga del navegador no deben poder hacerlo.
  'GET /reiniciar': (pedido, respuesta) => texto(respuesta, 405, 'Use el botón «Borrar los datos» del inicio.', { Allow: 'POST' }),
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
