// Lo que el Mini ERP lee del entorno (el .env): el modo, la marca, los secretos de los avisos, el
// puerto y la carpeta de datos. Nada más lee process.env: el resto del ejemplo recibe este objeto.
// Las credenciales de la API van aparte (leerCredenciales), para que no lleguen a las pantallas.

import { fileURLToPath } from 'node:url';

// En su sistema el RUT sale de lo que ya sabe del usuario que inició sesión; nunca de un campo
// que el navegador pueda cambiar. En modo prueba es el RUT sintético del respaldo de ejemplo; en modo
// real, el de MINI_ERP_RUT.
export const RUT_DE_LA_EMPRESA = '11111111-1';

// Lo que muestran el recorrido y POST /sesion en modo real sin una empresa.
export const SIN_RUT =
  'Falta MINI_ERP_RUT en el .env, o no es un RUT válido. En modo real es el RUT de la empresa que trae sus datos, con guion y dígito verificador. Defínalo y reinicie el Mini ERP.';

const MARCA_DE_FABRICA = { nombre: 'Andes ERP', color: '#1D4ED8' };
// El widget acepta un nombre de hasta 60 caracteres; uno más largo lo ignoraría.
const LARGO_DEL_NOMBRE = 60;

export function leerConfig(env) {
  // Solo «real» enciende el modo real: un error de tipeo deja el modo prueba, que no toca nada.
  const modo = env.MINI_ERP_MODO === 'real' ? 'real' : 'prueba';
  return {
    puerto: leerPuerto(env.PUERTO),
    modo,
    // La empresa de la sesión y de los avisos. En modo real, null si MINI_ERP_RUT falta o no es válido:
    // el ERP arranca igual y el recorrido dice qué falta.
    rut: modo === 'real' ? leerRut(env.MINI_ERP_RUT) : RUT_DE_LA_EMPRESA,
    // El origen del widget. El script se carga siempre desde ahí: no se copia a su dominio.
    widget: env.ENROLAMIENTO_WIDGET || 'https://widget.enrolamiento.cl',
    urlBase: env.ENROLAMIENTO_URL || 'https://api.enrolamiento.cl',
    marca: leerMarca(env),
    // Cada evento es una suscripción con su propio secreto de firma (Mi Cuenta > Notificaciones).
    secretoCertificacion: leerSecreto(env.ENROLAMIENTO_WEBHOOK_SECRETO),
    secretoRespaldo: leerSecreto(env.ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO),
    // Dónde se guarda el respaldo importado. Por omisión mini-erp/datos/, fuera de git; las pruebas
    // usan una carpeta temporal.
    datos: env.MINI_ERP_DATOS || fileURLToPath(new URL('./datos/', import.meta.url)),
  };
}

// Su usuario y su APIKey, para pedir la URL firmada del respaldo. Son los mismos que lee el SDK.
export function leerCredenciales(env) {
  return { usuario: env.ENROLAMIENTO_USUARIO || null, apikey: env.ENROLAMIENTO_APIKEY || null };
}

function leerPuerto(texto) {
  const puerto = Number(texto);
  return texto && Number.isInteger(puerto) && puerto > 0 && puerto < 65536 ? puerto : 3000;
}

// Formato 12345678-5 y dígito verificador de módulo 11. Una k minúscula se lee como K.
function leerRut(texto) {
  const rut = typeof texto === 'string' ? texto.trim().toUpperCase() : '';
  const partes = /^(\d{7,8})-([0-9K])$/.exec(rut);
  if (!partes) return null;
  let suma = 0;
  let factor = 2;
  for (const digito of [...partes[1]].reverse()) {
    suma += Number(digito) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  return partes[2] === (resto === 11 ? '0' : resto === 10 ? 'K' : String(resto)) ? rut : null;
}

function leerSecreto(texto) {
  return typeof texto === 'string' && texto.trim() !== '' ? texto : null;
}

function leerMarca(env) {
  // Un color que no es #RRGGBB se ignora: el valor llega a una hoja CSS y al widget, y así no
  // puede llevar nada más que un color.
  const color = /^#[0-9A-Fa-f]{6}$/.test(env.MINI_ERP_COLOR ?? '') ? env.MINI_ERP_COLOR.toUpperCase() : MARCA_DE_FABRICA.color;
  return {
    nombre: recortar((env.MINI_ERP_NOMBRE ?? '').trim()) || MARCA_DE_FABRICA.nombre,
    color,
    textoSobreColor: textoQueMasContrasta(color),
  };
}

// Corta en caracteres completos: un emoji no queda partido por la mitad.
function recortar(nombre) {
  const caracteres = Array.from(nombre);
  while (caracteres.join('').length > LARGO_DEL_NOMBRE) caracteres.pop();
  return caracteres.join('').trim();
}

// Blanco o negro, el que más contrasta con el color según WCAG 2.
function textoQueMasContrasta(color) {
  const canal = (inicio) => {
    const valor = parseInt(color.slice(inicio, inicio + 2), 16) / 255;
    return valor <= 0.03928 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4;
  };
  const luminancia = 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
  const contraBlanco = 1.05 / (luminancia + 0.05);
  const contraNegro = (luminancia + 0.05) / 0.05;
  return contraBlanco >= contraNegro ? '#FFFFFF' : '#000000';
}
