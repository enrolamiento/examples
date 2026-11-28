// Lo que el Mini ERP lee del entorno (el .env): el modo, la marca, los secretos de los avisos, el
// puerto y la carpeta de datos. Nada más lee process.env: el resto del ejemplo recibe este objeto.

import { fileURLToPath } from 'node:url';

// En su sistema el RUT sale de lo que ya sabe del usuario que inició sesión; nunca de un campo
// que el navegador pueda cambiar. Acá es un RUT de prueba fijo.
export const RUT_DE_LA_EMPRESA = '11111111-1';

const MARCA_DE_FABRICA = { nombre: 'Andes ERP', color: '#1D4ED8' };
// El widget acepta un nombre de hasta 60 caracteres; uno más largo lo ignoraría.
const LARGO_DEL_NOMBRE = 60;

export function leerConfig(env) {
  return {
    puerto: leerPuerto(env.PUERTO),
    // Solo «real» enciende el modo real: un error de tipeo deja el modo prueba, que no toca nada.
    modo: env.MINI_ERP_MODO === 'real' ? 'real' : 'prueba',
    // El origen del widget. El script se carga siempre desde ahí: no se copia a su dominio.
    widget: env.ENROLAMIENTO_WIDGET || 'https://widget.enrolamiento.cl',
    urlBase: env.ENROLAMIENTO_URL || 'https://api.enrolamiento.cl',
    marca: leerMarca(env),
    // Cada evento es una suscripción con su propio secreto de firma (Mi Cuenta > Notificaciones).
    secretoCertificacion: leerSecreto(env.ENROLAMIENTO_WEBHOOK_SECRETO),
    secretoRespaldo: leerSecreto(env.ENROLAMIENTO_WEBHOOK_SECRETO_RESPALDO),
    // Donde queda lo importado (fuera de git). Las pruebas usan una carpeta temporal.
    datos: env.MINI_ERP_DATOS || fileURLToPath(new URL('./datos/', import.meta.url)),
  };
}

function leerPuerto(texto) {
  const puerto = Number(texto);
  return texto && Number.isInteger(puerto) && puerto > 0 && puerto < 65536 ? puerto : 3000;
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
