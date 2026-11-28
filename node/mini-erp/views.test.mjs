// Las pantallas del ERP con el respaldo de ejemplo del SDK ya importado: las listas, el detalle de un
// documento con su XML y su PDF, «Empezar de nuevo» y que todo dato del respaldo sale escapado.
//
// Cada servidor corre con su propia carpeta de datos (MINI_ERP_DATOS), temporal: nunca datos/.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { abrirAlmacen } from './store.mjs';
import { importarRespaldo } from './import.mjs';
import { fecha, monto } from './views.mjs';

const RUT = '11111111-1';
const RAIZ = `mipyme-backup-${RUT}`;
const EJEMPLO = await readFile(new URL('../node_modules/enrolamiento/assets/respaldo-de-ejemplo.zip', import.meta.url));
const VENTA = '11111111-1_33_1201';
const COMPRA = '77777777-7_33_8812';
const MALICIOSO = '<script>x</script>';
const procesos = [];
const carpetas = [];

const sitios = {};

async function puertoLibre() {
  const libre = createServer();
  await new Promise((listo) => libre.listen(0, '127.0.0.1', listo));
  const numero = libre.address().port;
  await new Promise((listo) => libre.close(listo));
  return numero;
}

// Una carpeta de datos temporal, con el .zip importado si se pasa uno.
async function carpetaConDatos(zip) {
  const carpeta = await mkdtemp(join(tmpdir(), 'mini-erp-pantallas-'));
  carpetas.push(carpeta);
  if (zip) await importarRespaldo(zip, { rut: RUT, bytesEsperados: zip.length, almacen: abrirAlmacen(carpeta) });
  return carpeta;
}

async function arrancar(carpeta) {
  const numero = await puertoLibre();
  const erp = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: {
      ...process.env,
      PUERTO: String(numero),
      MINI_ERP_DATOS: carpeta,
      ENROLAMIENTO_USUARIO: '',
      ENROLAMIENTO_APIKEY: '',
      ENROLAMIENTO_URL: 'http://127.0.0.1:9',
      MINI_ERP_NOMBRE: '',
      MINI_ERP_COLOR: '',
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

// El ejemplo con datos que traen HTML: el nombre de la empresa, un cliente, un producto y una línea.
function ejemploMalicioso() {
  const entradas = unzipSync(new Uint8Array(EJEMPLO));
  const cambiar = (nombre, cambio) => {
    const valor = JSON.parse(new TextDecoder().decode(entradas[`${RAIZ}/${nombre}.json`]));
    cambio(valor);
    entradas[`${RAIZ}/${nombre}.json`] = strToU8(JSON.stringify(valor));
  };
  cambiar('ventas', (ventas) => {
    ventas.empresa.razon_social = MALICIOSO;
    const venta = ventas.items.find((item) => item.id === VENTA);
    venta.emisor.razon_social = MALICIOSO;
    venta.receptor.razon_social = MALICIOSO;
    venta.tipo_dte_nombre = MALICIOSO;
    venta.detalle[0].nombre = MALICIOSO;
  });
  cambiar('clientes', (clientes) => (clientes.items[0].razon_social = MALICIOSO));
  cambiar('proveedores', (proveedores) => (proveedores.items[0].razon_social = MALICIOSO));
  cambiar('productos', (productos) => (productos.items[0].nombre = MALICIOSO));
  return Buffer.from(zipSync(entradas, { level: 1 }));
}

before(async () => {
  sitios.ejemplo = await arrancar(await carpetaConDatos(EJEMPLO));
  sitios.malicioso = await arrancar(await carpetaConDatos(ejemploMalicioso()));
  sitios.vacio = await arrancar(await carpetaConDatos(null));
  sitios.reiniciar = await arrancar(await carpetaConDatos(EJEMPLO));
});

after(async () => {
  for (const erp of procesos) erp.kill();
  for (const carpeta of carpetas) await rm(carpeta, { recursive: true, force: true });
});

const pagina = async (ruta, sitio = sitios.ejemplo) => {
  const respuesta = await fetch(`${sitio}${ruta}`, { redirect: 'manual' });
  return { respuesta, html: await respuesta.text() };
};

// Las filas del cuerpo de la tabla y los títulos de sus columnas.
const filas = (html) => (/<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1].match(/<tr[\s>]/g) ?? []).length;
const columnas = (html) => [.../<thead>([\s\S]*?)<\/thead>/.exec(html)?.[1].matchAll(/<th[^>]*>([^<]*)<\/th>/g) ?? []].map((m) => m[1]);

const SIN_SCRIPTS_NI_ESTILOS_EN_LINEA = /<script(?![^>]*\bsrc=)[^>]*>|<style|\sstyle=|\son[a-z]+=/i;

const LISTAS = [
  { ruta: '/productos', cuantas: 12, columnas: ['Código', 'Nombre', 'Tipo', 'Precio último'] },
  { ruta: '/clientes', cuantas: 5, columnas: ['RUT', 'Razón social', 'Documentos', 'Monto total'] },
  { ruta: '/proveedores', cuantas: 4, columnas: ['RUT', 'Razón social', 'Documentos', 'Monto total'] },
  { ruta: '/ventas', cuantas: 20, columnas: ['Tipo', 'Folio', 'Fecha', 'Cliente', 'Total'] },
  { ruta: '/compras', cuantas: 10, columnas: ['Tipo', 'Folio', 'Fecha', 'Proveedor', 'Total'] },
];

for (const lista of LISTAS) {
  test(`${lista.ruta} muestra una fila por cada uno del respaldo, con sus columnas`, async () => {
    const { respuesta, html } = await pagina(lista.ruta);
    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(respuesta.headers.get('content-security-policy'), /^default-src 'self'/);
    assert.equal(filas(html), lista.cuantas);
    assert.deepEqual(columnas(html), lista.columnas);
    assert.match(html, new RegExp(`<a href="${lista.ruta}" aria-current="page"`));
    assert.doesNotMatch(html, SIN_SCRIPTS_NI_ESTILOS_EN_LINEA);
  });
}

test('los montos van en pesos con separador de miles y las fechas en dd-mm-aaaa', async () => {
  assert.equal(monto(257754), '$257.754');
  assert.equal(monto(0), '$0');
  assert.equal(monto(-11293), '-$11.293');
  assert.equal(monto(null), '—');
  assert.equal(monto(1250.5, 'USD'), 'USD 1.250,5');
  assert.equal(fecha('2026-05-06'), '06-05-2026');
  assert.equal(fecha(null), '—');
  assert.equal(fecha('mañana'), 'mañana');

  const productos = (await pagina('/productos')).html;
  assert.ok(productos.includes('$9.490'), 'precio último del martillo');
  const clientes = (await pagina('/clientes')).html;
  assert.ok(clientes.includes('$1.031.004'), 'monto total de Constructora Los Robles');
  const ventas = (await pagina('/ventas')).html;
  assert.ok(ventas.includes('06-05-2026'));
  assert.ok(ventas.includes('$257.754'));
});

test('cada venta y cada compra de la lista lleva a su detalle', async () => {
  assert.ok((await pagina('/ventas')).html.includes(`href="/ventas/${VENTA}"`));
  assert.ok((await pagina('/compras')).html.includes(`href="/compras/${COMPRA}"`));
});

test('el inicio con datos muestra la empresa, cuántos hay de cada cosa y lleva a cada lista', async () => {
  const { respuesta, html } = await pagina('/');
  assert.equal(respuesta.status, 200);
  assert.ok(html.includes('Ferretería El Faro SpA'));
  assert.ok(html.includes(RUT));
  assert.ok(!html.includes('Trae tu empresa desde el facturador gratuito'));
  for (const { ruta, cuantas } of LISTAS) {
    assert.match(html, new RegExp(`<a [^>]*href="${ruta}"[^>]*>\\s*<span class="cifra-numero">${cuantas}</span>`), ruta);
  }
  assert.match(html, /<form [^>]*method="post"[^>]*action="\/reiniciar"/);
  assert.doesNotMatch(html, SIN_SCRIPTS_NI_ESTILOS_EN_LINEA);
});

test('el detalle de una venta trae tipo, folio, partes, líneas, total, el PDF incrustado y el XML escapado', async () => {
  const { respuesta, html } = await pagina(`/ventas/${VENTA}`);
  assert.equal(respuesta.status, 200);
  assert.match(respuesta.headers.get('content-security-policy'), /frame-src 'self'/);
  for (const texto of [
    'Factura Electrónica',
    '1201',
    '06-05-2026',
    'Ferretería El Faro SpA',
    '11111111-1',
    'Constructora Los Robles SpA',
    '22222222-2',
    'Cemento 25 kg',
    'Despacho a domicilio',
    '$211.600',
    '$41.154',
    '$257.754',
  ]) {
    assert.ok(html.includes(texto), texto);
  }
  assert.equal(filas(html), 2);
  assert.match(html, new RegExp(`<iframe [^>]*src="/ventas/${VENTA}/pdf"`));
  assert.match(html, new RegExp(`<a [^>]*href="/ventas/${VENTA}/pdf"[^>]*download`));
  assert.match(html, new RegExp(`<a [^>]*href="/ventas/${VENTA}/xml"[^>]*download`));
  // El XML, como texto: escapado, nunca como marcado.
  assert.ok(html.includes('&lt;DTE xmlns=&quot;http://www.sii.cl/SiiDte&quot;'));
  assert.ok(html.includes('&lt;MntTotal&gt;257754&lt;/MntTotal&gt;'));
  assert.ok(!html.includes('<DTE'));
  assert.ok(!html.includes('<MntTotal'));
  assert.match(html, /<a href="\/ventas" aria-current="page"/);
  assert.doesNotMatch(html, SIN_SCRIPTS_NI_ESTILOS_EN_LINEA);
});

test('el detalle de una nota de crédito muestra el documento al que se refiere', async () => {
  const { html } = await pagina('/ventas/11111111-1_61_51');
  assert.ok(html.includes('Nota de Crédito Electrónica'));
  assert.ok(html.includes('Devolución de 10 sacos'));
  assert.ok(html.includes('1205'));
});

test('el detalle de una compra muestra al proveedor y su PDF', async () => {
  const { respuesta, html } = await pagina(`/compras/${COMPRA}`);
  assert.equal(respuesta.status, 200);
  assert.ok(html.includes('Distribuidora Ferretera Los Andes Ltda.'));
  assert.ok(html.includes('$375.564'));
  assert.match(html, new RegExp(`<iframe [^>]*src="/compras/${COMPRA}/pdf"`));
  assert.match(html, /<a href="\/compras" aria-current="page"/);
});

test('el PDF sale como application/pdf, sin que el navegador adivine el tipo', async () => {
  for (const ruta of [`/ventas/${VENTA}/pdf`, `/compras/${COMPRA}/pdf`]) {
    const respuesta = await fetch(`${sitios.ejemplo}${ruta}`);
    assert.equal(respuesta.status, 200, ruta);
    assert.equal(respuesta.headers.get('content-type'), 'application/pdf');
    assert.equal(respuesta.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(Buffer.from(await respuesta.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  }
});

test('el XML se descarga como adjunto, nunca se muestra como página', async () => {
  for (const [ruta, id] of [
    [`/ventas/${VENTA}/xml`, VENTA],
    [`/compras/${COMPRA}/xml`, COMPRA],
  ]) {
    const respuesta = await fetch(`${sitios.ejemplo}${ruta}`);
    assert.equal(respuesta.status, 200, ruta);
    assert.match(respuesta.headers.get('content-type'), /^(text\/plain|application\/xml)/);
    assert.equal(respuesta.headers.get('content-disposition'), `attachment; filename="${id}.xml"`);
    assert.equal(respuesta.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((await respuesta.text()).includes('<DTE'));
  }
});

test('un id que no existe, de otro sentido o con .. responde 404', async () => {
  for (const ruta of [
    '/ventas/11111111-1_33_9999',
    '/ventas/11111111-1_33_9999/pdf',
    '/ventas/11111111-1_33_9999/xml',
    `/ventas/${COMPRA}`,
    `/compras/${VENTA}/pdf`,
    `/ventas/${VENTA}..`,
    `/ventas/${VENTA}/otro`,
    `/ventas/${VENTA}/pdf/`,
    '/ventas/..%2F..%2Fserver.mjs',
    '/ventas/..%2f..%2fpackage.json/xml',
    '/ventas/%2e%2e%2f%2e%2e%2fserver.mjs/pdf',
    '/compras/..%5C..%5Cserver.mjs/xml',
    '/compras/%00/pdf',
    '/ventas/',
  ]) {
    assert.equal((await fetch(`${sitios.ejemplo}${ruta}`, { redirect: 'manual' })).status, 404, ruta);
  }
});

test('todo dato del respaldo sale escapado: un nombre con HTML no llega crudo a ninguna pantalla', async () => {
  for (const ruta of ['/', '/productos', '/clientes', '/proveedores', '/ventas', `/ventas/${VENTA}`]) {
    const { respuesta, html } = await pagina(ruta, sitios.malicioso);
    assert.equal(respuesta.status, 200, ruta);
    assert.ok(!html.includes(MALICIOSO), ruta);
    assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'), ruta);
  }
});

test('con el almacén vacío, las listas llevan al inicio', async () => {
  for (const { ruta } of LISTAS) {
    const respuesta = await fetch(`${sitios.vacio}${ruta}`, { redirect: 'manual' });
    assert.equal(respuesta.status, 303, ruta);
    assert.equal(respuesta.headers.get('location'), '/');
  }
  assert.equal((await fetch(`${sitios.vacio}/ventas/${VENTA}`, { redirect: 'manual' })).status, 404);
  assert.ok((await pagina('/', sitios.vacio)).html.includes('Trae tu empresa desde el facturador gratuito'));
});

test('«Empezar de nuevo» borra lo importado solo con POST desde el mismo ERP', async () => {
  const sitio = sitios.reiniciar;
  const conDatos = async () => (await pagina('/', sitio)).html.includes('Ferretería El Faro SpA');

  const conGet = await fetch(`${sitio}/reiniciar`, { redirect: 'manual' });
  assert.equal(conGet.status, 405);
  assert.equal(conGet.headers.get('allow'), 'POST');
  assert.ok(await conDatos(), 'GET no borra');

  // Un formulario de otro sitio que apunta a este ERP no borra nada.
  const deOtroSitio = await fetch(`${sitio}/reiniciar`, { method: 'POST', redirect: 'manual', headers: { Origin: 'https://otro.example' } });
  assert.equal(deOtroSitio.status, 403);
  assert.ok(await conDatos(), 'otro origen no borra');

  const respuesta = await fetch(`${sitio}/reiniciar`, { method: 'POST', redirect: 'manual', headers: { Origin: sitio } });
  assert.equal(respuesta.status, 303);
  assert.equal(respuesta.headers.get('location'), '/');
  const { html } = await pagina('/', sitio);
  assert.ok(html.includes('Trae tu empresa desde el facturador gratuito'));
  assert.equal((await fetch(`${sitio}/ventas`, { redirect: 'manual' })).status, 303);
});
