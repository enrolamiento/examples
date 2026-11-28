// El HTML de cada pantalla del Mini ERP. Todo valor que se interpola pasa por `escapar`: el nombre
// de la marca sale del .env y los datos salen del respaldo de la empresa, que arma un tercero. Sin
// escapar se interpolan solo trozos de HTML armados por otra función de este archivo.
//
// Las páginas no traen scripts ni estilos en línea: la política de seguridad (CSP) de server.mjs no
// los deja correr. La marca llega al CSS por /marca.css y al script del recorrido por atributos data-.

export function escapar(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Las variables CSS de la marca. El color ya viene validado como #RRGGBB por config.mjs.
export function hojaDeMarca(marca) {
  return `:root {\n  --marca: ${marca.color};\n  --marca-texto: ${marca.textoSobreColor};\n}\n`;
}

const SECCIONES = [
  { ruta: '/', nombre: 'Inicio' },
  { grupo: 'Datos de la empresa' },
  { ruta: '/productos', nombre: 'Productos' },
  { ruta: '/clientes', nombre: 'Clientes' },
  { ruta: '/proveedores', nombre: 'Proveedores' },
  { ruta: '/ventas', nombre: 'Ventas' },
  { ruta: '/compras', nombre: 'Compras' },
  { grupo: 'Portabilidad' },
  { ruta: '/recorrido', nombre: 'Traer empresa' },
];

// Montos y fechas como se leen en Chile. Devuelven texto: se escapan al interpolar, como todo.
export function monto(valor, moneda = 'CLP') {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '—';
  const signo = valor < 0 ? '-' : '';
  if (moneda && moneda !== 'CLP') return `${moneda} ${signo}${numero(Math.abs(valor))}`;
  return `${signo}$${numero(Math.abs(valor))}`;
}

// Punto para los miles y coma para los decimales, hasta cuatro y sin ceros de más. A mano, no con
// Intl: así no depende de los datos de idioma con que se compiló Node.
export function numero(valor) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '—';
  const [entero, decimales] = Math.abs(valor).toFixed(4).split('.');
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraccion = decimales.replace(/0+$/, '');
  return `${valor < 0 ? '-' : ''}${conMiles}${fraccion ? `,${fraccion}` : ''}`;
}

// AAAA-MM-DD, como viene en el respaldo, a dd-mm-aaaa. Otra cosa se muestra tal cual.
export function fecha(valor) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof valor === 'string' ? valor : '');
  if (partes) return `${partes[3]}-${partes[2]}-${partes[1]}`;
  return valor ? String(valor) : '—';
}

function pagina(config, { titulo, actual, cuerpo, scripts = [] }) {
  const { marca } = config;
  const menu = SECCIONES.map((s) =>
    s.grupo
      ? `<li class="menu-grupo">${escapar(s.grupo)}</li>`
      : `<li><a href="${escapar(s.ruta)}"${s.ruta === actual ? ' aria-current="page"' : ''}>${escapar(s.nombre)}</a></li>`,
  ).join('\n          ');
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapar(titulo)} · ${escapar(marca.nombre)}</title>
    <link rel="stylesheet" href="/public/app.css">
    <link rel="stylesheet" href="/marca.css">
  </head>
  <body data-marca-nombre="${escapar(marca.nombre)}" data-marca-color="${escapar(marca.color)}">
    <div class="marco">
      <aside class="lateral">
        <a class="marca" href="/">
          <span class="marca-sello" aria-hidden="true">${escapar(Array.from(marca.nombre)[0].toUpperCase())}</span>
          <span class="marca-nombre">${escapar(marca.nombre)}</span>
        </a>
        <nav aria-label="Secciones">
          <ul class="menu">
          ${menu}
          </ul>
        </nav>
        <p class="lateral-pie"><span class="insignia">${config.modo === 'real' ? 'Modo real' : 'Modo prueba'}</span> Ejemplo de integración</p>
      </aside>
      <main class="contenido">
${cuerpo}
      </main>
    </div>
${scripts.map((src) => `    <script src="${escapar(src)}"></script>`).join('\n')}
  </body>
</html>
`;
}

// Lo que muestra el inicio con datos, en este orden.
const CIFRAS = [
  { clave: 'productos', ruta: '/productos', rotulo: 'Productos y servicios' },
  { clave: 'clientes', ruta: '/clientes', rotulo: 'Clientes' },
  { clave: 'proveedores', ruta: '/proveedores', rotulo: 'Proveedores' },
  { clave: 'ventas', ruta: '/ventas', rotulo: 'Ventas' },
  { clave: 'compras', ruta: '/compras', rotulo: 'Compras' },
];

// Inicio. Sin datos, la invitación a traer la empresa. Con datos, el resumen de almacen.resumen():
// la empresa, cuántos hay de cada cosa y el acceso a cada lista.
export function paginaInicio(config, resumen = null) {
  if (resumen?.empresa) return paginaInicioConDatos(config, resumen);
  const nombre = escapar(config.marca.nombre);
  return pagina(config, {
    titulo: 'Inicio',
    actual: '/',
    cuerpo: `        <section class="vacio">
          <svg class="vacio-icono" viewBox="0 0 48 48" aria-hidden="true">
            <rect x="6" y="10" width="36" height="30" rx="4" fill="none" stroke="currentColor" stroke-width="2.5"></rect>
            <path d="M6 18h36M16 27h16M16 33h10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path>
          </svg>
          <h1>Trae tu empresa desde el facturador gratuito</h1>
          <p class="entrada">La empresa certifica su facturación electrónica sin salir de ${nombre}. Al terminar, el respaldo
            del facturador gratuito del SII llega solo, con todo lo que la empresa ya tenía.</p>
          <ul class="vacio-lista">
            <li>Productos</li>
            <li>Clientes</li>
            <li>Proveedores</li>
            <li>Ventas</li>
            <li>Compras</li>
          </ul>
          <a class="boton boton-primario" href="/recorrido">Traer mi empresa</a>
        </section>`,
  });
}

function paginaInicioConDatos(config, resumen) {
  const cifras = CIFRAS.map(
    (c) => `<li>
            <a class="cifra" href="${escapar(c.ruta)}">
              <span class="cifra-numero">${escapar(numero(resumen[c.clave]))}</span>
              <span class="cifra-rotulo">${escapar(c.rotulo)}</span>
            </a>
          </li>`,
  ).join('\n          ');
  return pagina(config, {
    titulo: 'Inicio',
    actual: '/',
    cuerpo: `        <header class="encabezado">
          <p class="sobretitulo">Empresa</p>
          <h1>${escapar(resumen.empresa.razon_social)}</h1>
          <p class="entrada">RUT ${escapar(resumen.empresa.rut)} · Datos traídos del respaldo del facturador gratuito del SII.</p>
        </header>
        <ul class="cifras">
          ${cifras}
        </ul>
        <section class="tarjeta zona-reinicio">
          <div>
            <h2>Empezar de nuevo</h2>
            <p>Borra los datos importados y deja ${escapar(config.marca.nombre)} como recién instalado, para repetir la demo.</p>
          </div>
          <form method="post" action="/reiniciar">
            <button class="boton boton-peligro" type="submit">Borrar los datos</button>
          </form>
        </section>`,
  });
}

// La tabla de una lista. `columnas`: [{ titulo, numerica }]; `filas`: el HTML de cada <tr>.
function tabla(columnas, filas, vacia) {
  if (filas.length === 0) return `        <p class="tarjeta tabla-vacia">${escapar(vacia)}</p>`;
  const encabezados = columnas
    .map((c) => `<th scope="col"${c.numerica ? ' class="num"' : ''}>${escapar(c.titulo)}</th>`)
    .join('');
  return `        <div class="tarjeta tabla-marco">
          <table class="tabla">
            <thead><tr>${encabezados}</tr></thead>
            <tbody>
              ${filas.join('\n              ')}
            </tbody>
          </table>
        </div>`;
}

function encabezadoDeLista(titulo, entrada) {
  return `        <header class="encabezado">
          <h1>${escapar(titulo)}</h1>
          <p class="entrada">${escapar(entrada)}</p>
        </header>`;
}

// Una cantidad con su palabra: «1 producto», «12 productos».
const cuantos = (n, singular, plural) => `${numero(n)} ${n === 1 ? singular : plural}`;

// Productos: el catálogo normalizado del respaldo. Los alias son los otros nombres con que aparece
// el mismo producto en los documentos.
export function paginaProductos(config, datos) {
  const filas = datos.items.map((p) => {
    const alias = (p.alias ?? []).filter((a) => a !== p.nombre);
    return `<tr>
                <td class="mono">${escapar(p.codigo)}</td>
                <td>${escapar(p.nombre)}${alias.length ? `<span class="secundario">También: ${escapar(alias.join(' · '))}</span>` : ''}</td>
                <td><span class="etiqueta">${escapar(p.tipo === 'servicio' ? 'Servicio' : p.tipo === 'producto' ? 'Producto' : p.tipo)}</span></td>
                <td class="num">${escapar(monto(p.precio?.ultimo, p.monedas?.[0]))}</td>
              </tr>`;
  });
  return pagina(config, {
    titulo: 'Productos',
    actual: '/productos',
    cuerpo: `${encabezadoDeLista('Productos', `${cuantos(datos.items.length, 'producto o servicio', 'productos y servicios')} de ${datos.empresa?.razon_social ?? 'la empresa'}.`)}
${tabla(
  [{ titulo: 'Código' }, { titulo: 'Nombre' }, { titulo: 'Tipo' }, { titulo: 'Precio último', numerica: true }],
  filas,
  'El respaldo no trae productos.',
)}`,
  });
}

const CONTRAPARTES = {
  clientes: { titulo: 'Clientes', ruta: '/clientes', singular: 'cliente', plural: 'clientes', vacia: 'El respaldo no trae clientes.' },
  proveedores: { titulo: 'Proveedores', ruta: '/proveedores', singular: 'proveedor', plural: 'proveedores', vacia: 'El respaldo no trae proveedores.' },
};

// Clientes o proveedores. El monto total ya resta las notas de crédito.
export function paginaContrapartes(config, cual, datos) {
  const { titulo, ruta, singular, plural, vacia } = CONTRAPARTES[cual];
  const filas = datos.items.map(
    (c) => `<tr>
                <td class="mono sin-corte">${escapar(c.rut)}</td>
                <td>${escapar(c.razon_social)}${c.giro ? `<span class="secundario">${escapar(c.giro)}</span>` : ''}</td>
                <td class="num">${escapar(numero(c.cantidad_documentos))}</td>
                <td class="num">${escapar(monto(c.monto_total))}</td>
              </tr>`,
  );
  return pagina(config, {
    titulo,
    actual: ruta,
    cuerpo: `${encabezadoDeLista(titulo, `${cuantos(datos.items.length, singular, plural)}, con los documentos de cada uno y su monto neto de notas de crédito.`)}
${tabla(
  [{ titulo: 'RUT' }, { titulo: 'Razón social' }, { titulo: 'Documentos', numerica: true }, { titulo: 'Monto total', numerica: true }],
  filas,
  vacia,
)}`,
  });
}

const LIBROS = {
  ventas: { titulo: 'Ventas', ruta: '/ventas', contraparte: 'receptor', rotulo: 'Cliente', verbo: 'emitidos', vacia: 'El respaldo no trae ventas.' },
  compras: { titulo: 'Compras', ruta: '/compras', contraparte: 'emisor', rotulo: 'Proveedor', verbo: 'recibidos', vacia: 'El respaldo no trae compras.' },
};

// Lo más nuevo primero. Copia la lista: la del almacén se comparte entre pedidos.
const masNuevoPrimero = (items) =>
  [...items].sort((a, b) => String(b.fecha_emision ?? '').localeCompare(String(a.fecha_emision ?? '')) || (b.folio ?? 0) - (a.folio ?? 0));

const nombreDelTipo = (d) => d.tipo_dte_nombre || `Documento tipo ${d.tipo_dte}`;

// Ventas o compras: una fila por documento, con el folio como acceso al detalle.
export function paginaDocumentos(config, libro, datos) {
  const { titulo, ruta, contraparte, rotulo, verbo, vacia } = LIBROS[libro];
  const filas = masNuevoPrimero(datos.items).map((d) => {
    const parte = d[contraparte] ?? {};
    return `<tr>
                <td><span class="codigo-tipo">${escapar(d.tipo_dte)}</span> ${escapar(nombreDelTipo(d))}</td>
                <td class="num"><a href="${escapar(ruta)}/${escapar(d.id)}">${escapar(d.folio)}</a></td>
                <td class="sin-corte">${escapar(fecha(d.fecha_emision))}</td>
                <td>${escapar(parte.razon_social)}<span class="secundario mono">${escapar(parte.rut)}</span></td>
                <td class="num">${escapar(monto(d.totales?.total, d.moneda))}</td>
              </tr>`;
  });
  return pagina(config, {
    titulo,
    actual: ruta,
    cuerpo: `${encabezadoDeLista(titulo, `${cuantos(datos.items.length, `documento ${verbo.slice(0, -1)}`, `documentos ${verbo}`)}, del más nuevo al más antiguo.`)}
${tabla(
  [{ titulo: 'Tipo' }, { titulo: 'Folio', numerica: true }, { titulo: 'Fecha' }, { titulo: rotulo }, { titulo: 'Total', numerica: true }],
  filas,
  vacia,
)}`,
  });
}

// El XML como texto, en la codificación que declara: los DTE del SII suelen venir en ISO-8859-1. Se
// muestra siempre escapado y no se parsea: ningún parser ve sus entidades ni su DOCTYPE.
function textoDelXml(bytes) {
  const declaracion = /encoding\s*=\s*["']([^"']+)["']/i.exec(bytes.subarray(0, 200).toString('latin1'));
  const latin1 = declaracion && /^(iso-8859-1|latin-?1|windows-1252)$/i.test(declaracion[1]);
  return new TextDecoder(latin1 ? 'latin1' : 'utf-8').decode(bytes);
}

function parteDelDocumento(titulo, parte = {}) {
  const datos = [
    ['RUT', parte.rut],
    ['Giro', parte.giro],
    ['Dirección', [parte.direccion, parte.comuna, parte.ciudad !== parte.comuna ? parte.ciudad : null].filter(Boolean).join(', ')],
    ['Correo', parte.email],
  ].filter(([, valor]) => valor);
  return `<div class="tarjeta parte">
            <h2 class="tarjeta-titulo">${escapar(titulo)}</h2>
            <p class="parte-nombre">${escapar(parte.razon_social)}</p>
            <dl class="datos">
              ${datos.map(([clave, valor]) => `<div><dt>${escapar(clave)}</dt><dd>${escapar(valor)}</dd></div>`).join('\n              ')}
            </dl>
          </div>`;
}

function lineaDelDetalle(linea, moneda) {
  const codigo = linea.codigo_producto ?? linea.codigos?.[0]?.valor ?? '';
  const descuento = typeof linea.descuento_monto === 'number' && linea.descuento_monto !== 0
    ? `<span class="secundario">Descuento ${escapar(monto(linea.descuento_monto, moneda))}${typeof linea.descuento_pct === 'number' ? ` (${escapar(numero(linea.descuento_pct))} %)` : ''}</span>`
    : '';
  return `<tr>
                <td class="num tenue">${escapar(linea.linea)}</td>
                <td class="mono">${escapar(codigo)}</td>
                <td>${escapar(linea.nombre)}${linea.descripcion ? `<span class="secundario">${escapar(linea.descripcion)}</span>` : ''}${descuento}</td>
                <td class="num sin-corte">${escapar(numero(linea.cantidad))}${linea.unidad ? ` ${escapar(linea.unidad)}` : ''}</td>
                <td class="num">${escapar(monto(linea.precio_unitario, moneda))}</td>
                <td class="num">${escapar(monto(linea.monto, moneda))}</td>
              </tr>`;
}

function totalesDelDocumento(totales = {}, moneda) {
  const filas = [
    totales.neto !== null && totales.neto !== undefined ? ['Neto', monto(totales.neto, moneda)] : null,
    totales.exento !== null && totales.exento !== undefined ? ['Exento', monto(totales.exento, moneda)] : null,
    totales.iva !== null && totales.iva !== undefined
      ? [typeof totales.tasa_iva === 'number' ? `IVA (${numero(totales.tasa_iva)} %)` : 'IVA', monto(totales.iva, moneda)]
      : null,
    ...(totales.otros_impuestos ?? []).map((i) => [
      `Impuesto ${i.tipo ?? ''}${typeof i.tasa === 'number' ? ` (${numero(i.tasa)} %)` : ''}`,
      monto(i.monto, moneda),
    ]),
  ].filter(Boolean);
  return `<dl class="totales">
              ${filas.map(([clave, valor]) => `<div><dt>${escapar(clave)}</dt><dd>${escapar(valor)}</dd></div>`).join('\n              ')}
              <div class="totales-total"><dt>Total</dt><dd>${escapar(monto(totales.total, moneda))}</dd></div>
            </dl>`;
}

function referenciasDelDocumento(referencias = []) {
  if (referencias.length === 0) return '';
  const items = referencias.map(
    (r) => `<li>Tipo ${escapar(r.tipo_doc)}, folio <strong>${escapar(r.folio)}</strong>${r.fecha ? `, del ${escapar(fecha(r.fecha))}` : ''}${r.razon ? `: ${escapar(r.razon)}` : ''}</li>`,
  );
  return `
        <section class="tarjeta seccion">
          <h2 class="tarjeta-titulo">Se refiere a</h2>
          <ul class="referencias">
            ${items.join('\n            ')}
          </ul>
        </section>`;
}

// El detalle de una venta o una compra: encabezado, partes, líneas y totales, el PDF incrustado
// (servido por este mismo origen) y el XML como texto. `xml` es el Buffer del almacén, o null.
export function paginaDocumento(config, libro, documento, { xml, hayPdf }) {
  const { titulo, ruta } = LIBROS[libro];
  const base = `${ruta}/${documento.id}`;
  const nombre = `${nombreDelTipo(documento)} N° ${documento.folio}`;
  const moneda = documento.moneda;
  const lineas = (documento.detalle ?? []).map((linea) => lineaDelDetalle(linea, moneda));
  const vence = documento.fecha_vencimiento ? ` · vence el ${fecha(documento.fecha_vencimiento)}` : '';
  const acciones = [
    xml ? `<a class="boton" href="${escapar(base)}/xml" download="${escapar(documento.id)}.xml">Descargar XML</a>` : '',
    hayPdf ? `<a class="boton boton-primario" href="${escapar(base)}/pdf" download="${escapar(documento.id)}.pdf">Descargar PDF</a>` : '',
  ].filter(Boolean);
  return pagina(config, {
    titulo: nombre,
    actual: ruta,
    cuerpo: `        <nav class="migas" aria-label="Ruta"><a href="${escapar(ruta)}">${escapar(titulo)}</a> <span aria-hidden="true">/</span> ${escapar(nombre)}</nav>
        <header class="encabezado encabezado-fila">
          <div>
            <p class="sobretitulo">${escapar(nombreDelTipo(documento))} · tipo ${escapar(documento.tipo_dte)}</p>
            <h1>Folio ${escapar(documento.folio)}</h1>
            <p class="entrada">Emitido el ${escapar(fecha(documento.fecha_emision))}${escapar(vence)}${documento.estado_sii ? ` · <span class="etiqueta">${escapar(documento.estado_sii)}</span>` : ''}</p>
          </div>
          ${acciones.length ? `<div class="acciones">${acciones.join('')}</div>` : ''}
        </header>
        <div class="partes">
          ${parteDelDocumento('Emisor', documento.emisor)}
          ${parteDelDocumento('Receptor', documento.receptor)}
        </div>${referenciasDelDocumento(documento.referencias)}
        <section class="tarjeta seccion">
          <h2 class="tarjeta-titulo">Detalle</h2>
          <div class="tabla-marco">
            <table class="tabla">
              <thead><tr><th scope="col" class="num">#</th><th scope="col">Código</th><th scope="col">Descripción</th><th scope="col" class="num">Cantidad</th><th scope="col" class="num">Precio unitario</th><th scope="col" class="num">Monto</th></tr></thead>
              <tbody>
              ${lineas.join('\n              ')}
              </tbody>
            </table>
          </div>
          ${totalesDelDocumento(documento.totales, moneda)}
        </section>
        <section class="tarjeta seccion">
          <h2 class="tarjeta-titulo">PDF</h2>
          ${hayPdf ? `<iframe class="pdf" src="${escapar(base)}/pdf" title="${escapar(`PDF de ${nombre}`)}"></iframe>` : '<p class="tenue">El respaldo no trae el PDF de este documento.</p>'}
        </section>
        <section class="tarjeta seccion">
          <h2 class="tarjeta-titulo">XML</h2>
          ${xml ? `<pre class="xml"><code>${escapar(textoDelXml(xml))}</code></pre>` : '<p class="tenue">El respaldo no trae el XML de este documento.</p>'}
        </section>`,
  });
}

// El recorrido: el widget y, al terminar, el panel que espera el aviso firmado.
export function paginaRecorrido(config) {
  const nombre = escapar(config.marca.nombre);
  return pagina(config, {
    titulo: 'Traer empresa',
    actual: '/recorrido',
    cuerpo: `        <header class="encabezado">
          <h1>Traer empresa</h1>
          <p class="entrada">La empresa autoriza a ${nombre} y certifica su facturación electrónica. Es una sesión de prueba:
            no consulta al SII, no crea nada y no descuenta cupos.</p>
        </header>
        <div id="recorrido-error" class="aviso aviso-error" role="alert" hidden>
          <p id="recorrido-error-texto"></p>
          <button id="reintentar" class="boton" type="button">Reintentar</button>
        </div>
        <section id="widget" class="tarjeta tarjeta-widget" aria-label="Certificación de la empresa">
          <p id="cargando" class="cargando">Preparando la sesión…</p>
          <div id="portabilidad"></div>
        </section>
        <section id="esperando" class="tarjeta panel-esperando" aria-live="polite" hidden>
          <span class="pulso" aria-hidden="true"></span>
          <div>
            <h2>Esperando el aviso</h2>
            <p>La empresa terminó el recorrido. ${nombre} importa sus datos cuando llega el aviso firmado
              <code>certificacion.finalizada</code> con el respaldo listo: lo que activa su sistema es el webhook, no esta pantalla.</p>
            <div id="esperando-acciones" class="panel-acciones"></div>
          </div>
        </section>`,
    scripts: [`${config.widget}/v1/enrolamiento.js`, '/public/journey.js'],
  });
}

export function paginaNoEncontrada(config) {
  return pagina(config, {
    titulo: 'No encontrada',
    actual: null,
    cuerpo: `        <section class="vacio">
          <h1>Esta página no existe</h1>
          <a class="boton" href="/">Volver al inicio</a>
        </section>`,
  });
}
