// El recorrido: monta el widget con la marca del ERP y, al terminar, muestra «Esperando el aviso».
// Es un script clásico, no un módulo: `Enrolamiento` lo dejó global el script del widget.

// La marca llega en atributos data- del <body>, no en un script en línea: la CSP no lo dejaría correr.
const marca = { nombre: document.body.dataset.marcaNombre, color: document.body.dataset.marcaColor };

const seccionWidget = document.querySelector('#widget');
const cargando = document.querySelector('#cargando');
const esperando = document.querySelector('#esperando');
const cajaDeError = document.querySelector('#recorrido-error');
const textoDeError = document.querySelector('#recorrido-error-texto');
const acciones = document.querySelector('#esperando-acciones');

function mostrarError(texto) {
  textoDeError.textContent = texto;
  cajaDeError.hidden = false;
}

// Le pide una sesión al servidor del ERP. La APIKey vive ahí; acá llega solo el client_secret.
async function pedirSesion(ruta) {
  const respuesta = await fetch(ruta, { method: 'POST' });
  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(cuerpo.mensaje ?? `El servidor respondió ${respuesta.status}.`);
  return cuerpo.client_secret;
}

let portabilidad;
let turno = 0;

async function empezar() {
  // Si llega otro «Reintentar» mientras se espera la sesión, este pedido queda viejo y no monta nada.
  const miTurno = ++turno;
  cajaDeError.hidden = true;
  esperando.hidden = true;
  seccionWidget.hidden = false;
  cargando.hidden = false;
  // Sin el script del widget no hay recorrido: se dice en vez de quedar en «Preparando la sesión…».
  if (typeof Enrolamiento !== 'function') {
    cargando.hidden = true;
    seccionWidget.hidden = true;
    mostrarError(
      'No cargó el script del widget (enrolamiento.js). Revise su conexión, un bloqueador de contenido o ENROLAMIENTO_WIDGET en el .env, y recargue la página.',
    );
    return;
  }
  let clientSecret;
  try {
    clientSecret = await pedirSesion('/sesion');
  } catch (error) {
    if (miTurno === turno) {
      // Sin sesión, el recuadro del widget quedaría vacío: se oculta hasta «Reintentar».
      cargando.hidden = true;
      seccionWidget.hidden = true;
      mostrarError(`No se pudo crear la sesión. ${error.message}`);
    }
    return;
  }
  if (miTurno !== turno) return;

  portabilidad?.unmount();
  // Solo las claves básicas de la apariencia: funcionan igual con o sin marca blanca. El logo se
  // publica en el portal; el widget no lo toma de acá.
  portabilidad = Enrolamiento().portabilidad({
    clientSecret,
    locale: 'es-CL',
    appearance: { nombre: marca.nombre, variables: { colorPrimary: marca.color } },
  });

  // Los oyentes se registran antes de montar: un client_secret mal formado avisa por `error` un
  // instante después de mount, y un oyente que llega tarde no lo ve.
  portabilidad.on('ready', () => {
    cargando.hidden = true;
  });
  // No es el fin del recorrido: también llega por un rechazo que la empresa corrige en el widget, y
  // el widget le muestra el mensaje. Acá queda anotado para quien depura.
  portabilidad.on('error', (e) => console.info(`El widget avisó un error: ${e.codigo}`));
  // Sirve para la pantalla. Lo que el ERP activa, lo activa el webhook certificacion.finalizada.
  portabilidad.on('completed', () => {
    seccionWidget.hidden = true;
    esperando.hidden = false;
    esperarAviso();
  });
  // La sesión vence a los 60 minutos: se pide otra para la misma empresa, sin reiniciar el guion, y el
  // widget sigue sin recargarse.
  portabilidad.on('session_expired', async () => {
    try {
      portabilidad.update({ clientSecret: await pedirSesion('/sesion?seguir=1') });
    } catch (error) {
      mostrarError(`No se pudo renovar la sesión. ${error.message}`);
    }
  });

  portabilidad.mount('#portabilidad');
}

// --- Esperando el aviso ------------------------------------------------------------------------
// La página consulta GET /estado cada 2 segundos: cuando el receptor importó el respaldo, va al inicio.
// En modo prueba, el estado trae también la salida de «Simular el aviso», que el servidor corre como
// proceso hijo con argumentos fijos. Lo que escribe el CLI se pinta como texto, nunca como HTML.

const PUERTO = location.port || '80';
// El comando que corre el servidor, tal cual. El script mini-erp:aviso es el mismo, en el puerto 3000.
const COMANDO = `enrolamiento webhooks enviar certificacion.finalizada --url http://localhost:${PUERTO}/webhooks/certificacion`;
const A_MANO =
  PUERTO === '3000'
    ? 'npm run mini-erp:aviso'
    : `node --env-file=.env node_modules/enrolamiento/dist/cli.js webhooks enviar certificacion.finalizada --url http://localhost:${PUERTO}/webhooks/certificacion`;

let consulta = null;
let panel = null;
// Una consulta que llega después de otra más nueva no pinta nada: mostraría un estado viejo.
let ultimaConsulta = 0;

// Un elemento con su clase y su texto. textContent: lo que trae el servidor nunca se lee como HTML.
function crear(etiqueta, clase, texto) {
  const elemento = document.createElement(etiqueta);
  if (clase) elemento.className = clase;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
}

function linea(textoAntes, comando) {
  const parrafo = crear('p', 'tenue', textoAntes);
  parrafo.append(crear('code', null, comando));
  return parrafo;
}

// Arma el panel una vez. `simulable` es el modo prueba: el estado trae la simulación.
function armarPanel(simulable) {
  const raiz = crear('div', 'simular');
  const detalle = crear('p', 'simular-detalle');
  detalle.hidden = true;
  raiz.append(detalle);
  panel = { detalle };
  if (simulable) {
    const boton = crear('button', 'boton boton-primario', 'Simular el aviso');
    boton.type = 'button';
    boton.addEventListener('click', simularAviso);
    const salida = crear('pre', 'xml salida-del-cli');
    const codigo = crear('code');
    salida.append(codigo);
    salida.hidden = true;
    const mensaje = crear('p', 'simular-mensaje');
    mensaje.setAttribute('role', 'status');
    raiz.append(
      boton,
      linea('El botón le pide al servidor del ERP que corra el CLI del SDK, que firma el aviso con su secreto y deja el respaldo de ejemplo para descargar: ', COMANDO),
      linea('Lo mismo, a mano en otra terminal: ', A_MANO),
      salida,
      mensaje,
    );
    Object.assign(panel, { boton, salida, codigo, mensaje });
  } else {
    raiz.append(crear('p', 'tenue', 'En modo real el aviso llega de Enrolamiento, por el túnel que apunta a este puerto.'));
  }
  acciones.replaceChildren(raiz);
}

function pintarSimulacion({ corriendo, lineas, termino, codigo }) {
  panel.boton.disabled = corriendo;
  panel.codigo.textContent = lineas.join('\n');
  panel.salida.hidden = lineas.length === 0;
  panel.salida.scrollTop = panel.salida.scrollHeight;
  if (corriendo) panel.mensaje.textContent = 'Corriendo el comando…';
  else if (!termino) panel.mensaje.textContent = '';
  else if (codigo === 0) panel.mensaje.textContent = 'El comando terminó bien: el receptor aceptó el aviso y descargó el respaldo.';
  else if (codigo === null) panel.mensaje.textContent = 'El comando no terminó. Revise la salida y vuelva a intentarlo.';
  else panel.mensaje.textContent = `El comando terminó con el código ${codigo}. Revise la salida y vuelva a intentarlo.`;
}

async function consultarEstado() {
  const miConsulta = ++ultimaConsulta;
  let estado;
  try {
    const respuesta = await fetch('/estado', { cache: 'no-store' });
    if (!respuesta.ok) throw new Error(String(respuesta.status));
    estado = await respuesta.json();
  } catch {
    if (miConsulta !== ultimaConsulta) return;
    if (panel) {
      panel.detalle.textContent = 'No se pudo consultar el estado del ERP. ¿Sigue corriendo el servidor?';
      panel.detalle.hidden = false;
    }
    return;
  }
  if (miConsulta !== ultimaConsulta) return;
  if (estado.fase === 'listo') {
    clearInterval(consulta);
    location.assign('/');
    return;
  }
  if (!panel) armarPanel(estado.simulacion !== undefined);
  panel.detalle.textContent = estado.detalle ?? '';
  panel.detalle.hidden = !estado.detalle;
  panel.detalle.classList.toggle('simular-error', estado.fase === 'error');
  if (estado.simulacion && panel.boton) pintarSimulacion(estado.simulacion);
}

function esperarAviso() {
  if (consulta !== null) return;
  consultarEstado();
  consulta = setInterval(consultarEstado, 2000);
}

async function simularAviso() {
  panel.boton.disabled = true;
  panel.mensaje.textContent = 'Corriendo el comando…';
  try {
    const respuesta = await fetch('/simular', { method: 'POST' });
    // 409: ya hay uno corriendo. La consulta muestra su salida igual.
    if (respuesta.status !== 202 && respuesta.status !== 409) {
      panel.mensaje.textContent = `El servidor respondió ${respuesta.status} al simular el aviso.`;
      panel.boton.disabled = false;
      return;
    }
  } catch {
    panel.mensaje.textContent = 'No se pudo hablar con el servidor del ERP. ¿Sigue corriendo?';
    panel.boton.disabled = false;
    return;
  }
  consultarEstado();
}

document.querySelector('#reintentar').addEventListener('click', empezar);
empezar();
