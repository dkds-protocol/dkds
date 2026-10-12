/** The texts of the verifier in Spanish; see en.ts for the source and the meaning of each key. */

import type { Texts } from "./en.ts";
import { count, domainList, list } from "./grammar.ts";

const L = "es-ES";

export const es: Texts = {
  code: "es",
  locale: L,
  language: "Idioma",

  appName: "DKDS Verificación",

  outcomes: {
    valid: {
      title: "Firma válida",
      description: "El sello se firmó con la clave que publica su dominio.",
    },
    malformed: {
      title: "Sello no válido",
      description: "El código no es un sello DKDS válido.",
    },
    unsupported: {
      title: "Sello no compatible",
      description: "El sello utiliza una versión o un algoritmo que este verificador no admite.",
    },
    "key-not-found": {
      title: "Clave no encontrada",
      description: "No hay ninguna clave publicada para este sello. Su origen no puede confirmarse.",
    },
    "key-revoked": {
      title: "Clave revocada",
      description: "La clave de este sello ha sido revocada por el titular del dominio.",
    },
    "invalid-signature": {
      title: "Firma no válida",
      description: "La firma no coincide con el contenido del sello.",
    },
    unavailable: {
      title: "Clave no disponible",
      description: "No se pudo obtener la clave. El sello puede comprobarse de nuevo más tarde.",
    },
  },

  warnings: {
    idn: ({ ascii }) => ["El dominio contiene caracteres fuera del alfabeto latino básico. En el DNS se escribe ", { domain: ascii }, "."],
    "mixed-script": () => ["El dominio mezcla caracteres de distintas escrituras, un método empleado para imitar otros dominios."],
    "single-resolver": () => ["Solo respondió uno de los dos resolvedores DNS, por lo que la clave no pudo compararse entre ellos."],
    "key-changed": () => [
      "La clave publicada para este dominio difiere de la vista anteriormente en este dispositivo. Es posible que el titular la haya sustituido o que la respuesta DNS esté falsificada.",
    ],
    "key-disappeared": () => ["Una clave vista anteriormente en este dispositivo ya no se publica para este dominio."],
    "similar-domain": ({ similar }) => [
      "El dominio se parece a ",
      ...domainList(L, similar),
      ", cuyos sellos se verificaron antes en este dispositivo.",
    ],
  },

  home: {
    title: "Verificación de sellos de documentos",
    lede:
      "El verificador lee un sello DKDS de un documento y comprueba su firma con la clave que el emisor publica en el DNS.",
    camera: "Abrir cámara",
    file: "Abrir archivo",
    text: "Pegar texto",
    fileHint: "Imágenes (PNG, JPEG, WebP, HEIC) y archivos PDF",
    drop: "Suelte el archivo para leerlo",
    install: "Instalar aplicación",
  },

  privacy: {
    title: "Privacidad",
    body:
      "Las imágenes, los archivos PDF y los fotogramas de la cámara se procesan en este navegador y nunca se envían. Para comprobar un sello, el verificador solicita la clave del emisor a dos resolvedores DNS, Cloudflare y Google, mediante una conexión cifrada. La consulta indica el dominio del emisor y el identificador de la clave, y puede llegar al operador DNS del emisor. Ningún otro dato sale del dispositivo.",
    store: (n) =>
      n === 0
        ? "Actualmente no hay dominios verificados almacenados en este dispositivo."
        : `Las claves de ${count(L, n, { one: "dominio verificado", other: "dominios verificados" })} están almacenadas en este dispositivo para detectar claves cambiadas y dominios similares.`,
    forget: "Olvidar dominios verificados",
    forgetConfirm: (n) => (n === 1 ? "¿Olvidar el dominio verificado en este dispositivo?" : `¿Olvidar los ${n} dominios verificados en este dispositivo?`),
    forgotten: "Los dominios verificados se han olvidado.",
  },

  footer: {
    about: "Acerca de DKDS",
    docs: "Documentación",
    source: "Código fuente",
    madeIn: "Hecho con 💙 en Delft",
    licences: "Licencias",
    version: (version, build) => `Verificador ${version} · compilación ${build}`,
  },

  camera: {
    title: "Cámara",
    close: "Cerrar cámara",
    torchOn: "Encender linterna",
    torchOff: "Apagar linterna",
    switch: "Cambiar cámara",
    starting: "Iniciando la cámara",
    aim: "Apunte la cámara al sello",
    steady: "Mantenga el sello quieto y llene el marco con él. Una luz uniforme y algo de distancia ayudan con los sellos densos.",
    notStamp: "Este código QR no es un sello DKDS.",
    found: "Sello encontrado",
  },

  paste: {
    title: "Texto del sello",
    lede: "La forma de texto de un sello empieza por DKDS: y es lo que devuelve un lector de códigos QR para un sello.",
    label: "Texto del sello",
    submit: "Verificar texto",
    empty: "Introduzca el texto de un sello.",
  },

  working: {
    reading: (name) => `Leyendo ${name}`,
    unnamed: "el archivo",
    page: (i, n) => `Leyendo la página ${i} de ${n}`,
    loadingPdf: "Cargando el lector de PDF",
    verifying: (n) => (n === 1 ? "Obteniendo la clave del emisor" : `Verificando ${n} sellos`),
    cancel: "Detener lectura",
  },

  result: {
    title: (n) => (n === 1 ? "Resultado de la verificación" : `Resultados de la verificación: ${n} sellos`),
    fromCamera: "Cámara",
    fromText: "Texto",
    unread: (from, to) => `Las páginas ${from} a ${to} no se leyeron; de un archivo PDF se leen como máximo 50 páginas.`,
    others: (n) =>
      n === 1
        ? "Se encontró 1 código QR más que no es un sello DKDS; su contenido no se muestra."
        : `Se encontraron ${n} códigos QR más que no son sellos DKDS; su contenido no se muestra.`,
    page: (pages) => (pages.length === 1 ? `Página ${pages[0]}` : `Páginas ${list(L, pages.map(String))}`),
    labels: { domain: "Dominio", signed: "Firmado", dns: "DNS", warnings: "Advertencias" },
    dnssec: (validated) => (validated ? "Respuesta validada con DNSSEC" : "Respuesta no validada con DNSSEC"),
    contentsBy: "Contenido del sello, firmado por",
    fieldName: "Campo",
    fieldValue: "Valor",
    raw: "Texto sin formato",
    copy: "Copiar texto del sello",
    copied: "Copiado",
    emptyValue: "vacío",
    offline: "Este dispositivo no tiene conexión.",
    whitespace: "El texto empieza o termina con un espacio o un salto de línea, que no forman parte de un sello.",
    details: "Detalles técnicos",
    step: (step) => `Determinado en el paso ${step} del procedimiento de la sección 8.2 de la especificación.`,
    again: "Verificar de nuevo",
    next: "Verificar otro sello",
  },

  problem: {
    back: "Volver",
    retryCamera: "Abrir cámara",
    openFile: "Abrir archivo",
    pasteText: "Pegar texto",
    cameraDenied: {
      title: "Acceso a la cámara denegado",
      body:
        "El navegador no ha permitido que esta página use la cámara. El acceso puede concederse en la configuración del navegador para scan.dkds.org, tras lo cual la cámara puede abrirse de nuevo. También puede abrirse una foto del sello como archivo.",
      ios: "En iPhone y iPad, el acceso a la cámara para sitios web se configura en Ajustes, Apps, Safari, Cámara.",
      android: "En Chrome, el acceso a la cámara se configura en el icono a la izquierda de la dirección y después en Permisos.",
    },
    cameraMissing: {
      title: "No se encontró ninguna cámara",
      body: "Este dispositivo no tiene ninguna cámara que el navegador pueda usar. En su lugar, puede abrirse como archivo una foto o un escaneo del documento.",
    },
    cameraBusy: {
      title: "Cámara no disponible",
      body: "No se pudo iniciar la cámara. Puede que otra aplicación la esté usando; quedará disponible cuando esa aplicación la libere.",
    },
    cameraUnsupported: {
      title: "Cámara no compatible",
      body: "Este navegador no permite a las páginas web acceder a la cámara. En su lugar, puede abrirse una foto del sello como archivo.",
    },
    cameraInsecure: {
      title: "Cámara no disponible en esta conexión",
      body: "Los navegadores solo permiten la cámara en páginas cargadas mediante HTTPS. El verificador está disponible en https://scan.dkds.org.",
    },
    cameraStopped: {
      title: "Cámara detenida",
      body: "La cámara dejó de enviar imágenes, por ejemplo porque se desconectó o porque otra aplicación la ocupó.",
    },
    fileType: {
      title: "Tipo de archivo no compatible",
      body: (name) =>
        `${name} no es una imagen ni un archivo PDF. El verificador lee imágenes PNG, JPEG y WebP, imágenes HEIC cuando el navegador las admite, y archivos PDF.`,
    },
    fileTooLarge: {
      title: "Archivo demasiado grande",
      body: (name) => `${name} supera los 100 MB, el tamaño máximo de archivo que lee el verificador.`,
    },
    fileEmpty: {
      title: "Archivo vacío",
      body: (name) => `${name} no contiene datos.`,
    },
    imageUnreadable: {
      title: "No se pudo abrir la imagen",
      body: (name) =>
        `Este navegador no puede descodificar ${name}. Es posible que el archivo esté dañado o que tenga un formato que el navegador no admite, como HEIC fuera de Safari. En su lugar, puede abrirse una captura de pantalla o una copia JPEG de la imagen.`,
    },
    pdfUnreadable: {
      title: "No se pudo leer el archivo PDF",
      body: (name) => `${name} está dañado o no es un archivo PDF.`,
    },
    pdfUnavailable: {
      title: "Lector de PDF no disponible",
      body: "No se pudo cargar el lector de PDF. Se carga al abrir el primer archivo PDF, para lo cual se necesita una conexión de red. En su lugar, puede abrirse como imagen una captura de pantalla de la página con el sello.",
    },
    pdfPassword: {
      title: "Contraseña necesaria",
      body: (name) => `${name} está protegido con una contraseña. La contraseña solo se usa en este dispositivo.`,
      label: "Contraseña",
      submit: "Abrir archivo PDF",
      incorrect: "La contraseña es incorrecta.",
    },
    noCode: {
      title: "No se encontró ningún código QR",
      image: (name) =>
        `No se encontró ningún código QR en ${name}. Un sello se lee con mayor fiabilidad en una imagen nítida y con iluminación uniforme, en la que el sello aparece grande y de frente.`,
      pdf: (name, pages) => `No se encontró ningún código QR en ${pages === 1 ? "la página leída" : `las ${pages} páginas leídas`} de ${name}.`,
    },
    notStamp: {
      title: "No es un sello DKDS",
      body: (n) =>
        n === 1
          ? "El código QR encontrado no es un sello DKDS. Su contenido no se muestra, porque el verificador solo muestra sellos."
          : `Los ${n} códigos QR encontrados no son sellos DKDS. Su contenido no se muestra, porque el verificador solo muestra sellos.`,
    },
    readerFailed: {
      title: "Lector de QR no disponible",
      body: "No se pudo iniciar el lector de QR en este navegador. El texto de un sello todavía puede pegarse y verificarse.",
    },
    browser: {
      title: "Navegador no compatible",
      body: "A este navegador le faltan funciones que el verificador necesita. Funciona en las versiones actuales de Safari, Chrome, Edge y Firefox.",
    },
    unexpected: {
      title: "Error inesperado",
      body: (message) => `El verificador se detuvo debido a un error: ${message}`,
    },
    multipleFiles: "Solo se leyó el primero de los archivos.",
  },
};
