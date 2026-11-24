// El widget de Portabilidad dentro de una página propia, con una sesión de prueba.
//
//   node --env-file=.env portability-widget/server.mjs
//
// Hace las dos mitades de la integración: este servidor crea la sesión con su APIKey, y la página
// (index.html + page.js) monta el widget con el client_secret. La APIKey no sale de este proceso.
// Una sesión de prueba recorre un guion: no consulta al SII, no crea nada y no descuenta cupos.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import Enrolamiento, { ErrorDeApi, ErrorDeConfiguracion } from 'enrolamiento';

const PUERTO = Number(process.env.PUERTO ?? 3000);
// El origen del widget. El script se carga siempre desde ahí: no se copia a su dominio.
const WIDGET = process.env.ENROLAMIENTO_WIDGET ?? 'https://widget.enrolamiento.cl';
// En su sistema el RUT sale de lo que ya sabe del usuario que inició sesión; nunca de un campo
// que el navegador pueda cambiar. Acá es un RUT de prueba fijo.
const RUT_DE_LA_EMPRESA = '11111111-1';
const ESCENARIOS = ['camino_feliz', 'certificado_no_administrador', 'conflicto', 'respaldo_en_curso', 'resolucion_emitida'];

// Lee ENROLAMIENTO_USUARIO y ENROLAMIENTO_APIKEY del entorno.
const enrolamiento = new Enrolamiento(process.env.ENROLAMIENTO_URL ? { urlBase: process.env.ENROLAMIENTO_URL } : {});

// La política de seguridad de contenido de esta página: lo propio, más el script y el iframe del
// widget. No hace falta 'unsafe-inline' ni tocar connect-src.
const CSP = `default-src 'self'; script-src 'self' ${WIDGET}; frame-src ${WIDGET}`;

const archivo = (nombre) => readFile(new URL(nombre, import.meta.url), 'utf8');

async function crearSesion(escenario) {
  const sesion = await enrolamiento.portabilidad.sesiones({
    rut: RUT_DE_LA_EMPRESA,
    referencia_externa: 'cliente-4821',
    prueba: true,
    // Con escenario, el guion de la empresa empieza de cero; sin él, sigue donde iba.
    ...(escenario ? { escenario } : {}),
  });
  // Al navegador va solo el client_secret: vale 60 minutos y sirve solo para esta empresa.
  return { client_secret: sesion.client_secret };
}

function responderError(respuesta, error) {
  if (error instanceof ErrorDeConfiguracion) {
    console.error(error.message);
    respuesta.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Faltan las credenciales en el servidor.' }));
    return;
  }
  if (error instanceof ErrorDeApi) {
    // Decida por el código, no por el status. Un 404 sin código es el widget sin habilitar para su cuenta.
    console.error(`La API respondió ${error.status} ${error.codigo ?? ''}: ${error.mensaje} (${error.urlDeAyuda})`);
    const motivo = error.status === 404 && error.codigo === null ? 'WIDGET_NO_HABILITADO' : (error.codigo ?? 'SIN_CODIGO');
    respuesta.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: motivo }));
    return;
  }
  console.error(error);
  respuesta.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Falla del servidor.' }));
}

const servidor = createServer(async (pedido, respuesta) => {
  const url = new URL(pedido.url, 'http://localhost');
  try {
    if (pedido.method === 'GET' && url.pathname === '/') {
      const html = (await archivo('./index.html')).replaceAll('{{WIDGET}}', WIDGET);
      respuesta.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP }).end(html);
    } else if (pedido.method === 'GET' && url.pathname === '/page.js') {
      respuesta.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(await archivo('./page.js'));
    } else if (pedido.method === 'POST' && url.pathname === '/sesion') {
      // En su sistema esta ruta exige la sesión de su usuario: quien no inició sesión no pide una.
      const escenario = url.searchParams.get('escenario');
      if (escenario !== null && !ESCENARIOS.includes(escenario)) {
        respuesta.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Escenario desconocido.' }));
        return;
      }
      const sesion = await crearSesion(escenario);
      respuesta.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(sesion));
    } else {
      respuesta.writeHead(404).end();
    }
  } catch (error) {
    responderError(respuesta, error);
  }
});

servidor.listen(PUERTO, '127.0.0.1', () => console.log(`Abra http://localhost:${PUERTO} (escuchando en el puerto ${PUERTO})`));
