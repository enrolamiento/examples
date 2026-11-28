// El HTML de cada pantalla del Mini ERP. Todo valor que se interpola pasa por `escapar`: el nombre
// de la marca sale del .env y, más adelante, los datos salen del respaldo de la empresa.
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
  { ruta: '/recorrido', nombre: 'Traer empresa' },
];

function pagina(config, { titulo, actual, cuerpo, scripts = [] }) {
  const { marca } = config;
  const menu = SECCIONES.map(
    (s) => `<li><a href="${s.ruta}"${s.ruta === actual ? ' aria-current="page"' : ''}>${escapar(s.nombre)}</a></li>`,
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

// Inicio. Sin datos, la invitación a traer la empresa; el resumen con datos llega con el importador.
export function paginaInicio(config) {
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
