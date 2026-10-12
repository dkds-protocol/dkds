/**
 * The texts of the verifier in French; see en.ts for the source and the meaning of each key. French
 * typography places a narrow no-break space (U+202F) before ; ? ! and a no-break space (U+00A0)
 * before a colon.
 */

import type { Texts } from "./en.ts";
import { count, domainList, list } from "./grammar.ts";

const L = "fr-FR";

export const fr: Texts = {
  code: "fr",
  locale: L,
  language: "Langue",

  appName: "DKDS Vérification",

  outcomes: {
    valid: {
      title: "Signature valide",
      description: "Le cachet a été signé avec la clé que publie son domaine.",
    },
    malformed: {
      title: "Cachet non valide",
      description: "Le code n’est pas un cachet DKDS valide.",
    },
    unsupported: {
      title: "Cachet non pris en charge",
      description: "Le cachet utilise une version ou un algorithme que ce vérificateur ne prend pas en charge.",
    },
    "key-not-found": {
      title: "Clé introuvable",
      description: "Aucune clé n’est publiée pour ce cachet. Son origine ne peut pas être confirmée.",
    },
    "key-revoked": {
      title: "Clé révoquée",
      description: "La clé de ce cachet a été révoquée par le titulaire du domaine.",
    },
    "invalid-signature": {
      title: "Signature non valide",
      description: "La signature ne correspond pas au contenu du cachet.",
    },
    unavailable: {
      title: "Clé indisponible",
      description: "La clé n’a pas pu être obtenue. Le cachet peut être vérifié de nouveau plus tard.",
    },
  },

  warnings: {
    idn: ({ ascii }) => ["Le domaine contient des caractères hors de l’alphabet latin de base. Dans le DNS, il s’écrit ", { domain: ascii }, "."],
    "mixed-script": () => ["Le domaine mêle des caractères de différentes écritures, un procédé utilisé pour imiter d’autres domaines."],
    "single-resolver": () => ["Un seul des deux résolveurs DNS a répondu ; la clé n’a donc pas pu être comparée entre eux."],
    "key-changed": () => [
      "La clé publiée pour ce domaine diffère de celle vue auparavant sur cet appareil. Le titulaire l’a peut-être remplacée, ou la réponse DNS est peut-être falsifiée.",
    ],
    "key-disappeared": () => ["Une clé vue auparavant sur cet appareil n’est plus publiée pour ce domaine."],
    "similar-domain": ({ similar }) => [
      "Le domaine ressemble à ",
      ...domainList(L, similar),
      ", dont des cachets ont déjà été vérifiés sur cet appareil.",
    ],
  },

  home: {
    title: "Vérification des cachets de documents",
    lede:
      "Le vérificateur lit un cachet DKDS sur un document et contrôle sa signature à l’aide de la clé que l’émetteur publie dans le DNS.",
    camera: "Ouvrir la caméra",
    file: "Ouvrir un fichier",
    text: "Coller le texte",
    fileHint: "Images (PNG, JPEG, WebP, HEIC) et fichiers PDF",
    drop: "Déposer le fichier pour le lire",
    install: "Installer l’application",
  },

  privacy: {
    title: "Confidentialité",
    body:
      "Les images, les fichiers PDF et les images de la caméra sont traités dans ce navigateur et ne sont jamais envoyés. Pour vérifier un cachet, le vérificateur demande la clé de l’émetteur à deux résolveurs DNS, Cloudflare et Google, par une connexion chiffrée. La requête indique le domaine de l’émetteur et l’identifiant de la clé, et peut parvenir à l’opérateur DNS de l’émetteur. Aucune autre donnée ne quitte l’appareil.",
    store: (n) =>
      n === 0
        ? "Aucun domaine vérifié n’est actuellement enregistré sur cet appareil."
        : `Les clés de ${count(L, n, { one: "domaine vérifié", other: "domaines vérifiés" })} sont enregistrées sur cet appareil, afin de détecter les clés modifiées et les domaines similaires.`,
    forget: "Oublier les domaines vérifiés",
    forgetConfirm: (n) => (n === 1 ? "Oublier le domaine vérifié sur cet appareil ?" : `Oublier les ${n} domaines vérifiés sur cet appareil ?`),
    forgotten: "Les domaines vérifiés ont été oubliés.",
  },

  footer: {
    about: "À propos de DKDS",
    docs: "Documentation",
    source: "Code source",
    madeIn: "Fait avec 💙 à Delft",
    licences: "Licences",
    version: (version, build) => `Vérificateur ${version} · build ${build}`,
  },

  camera: {
    title: "Caméra",
    close: "Fermer la caméra",
    torchOn: "Allumer la lampe",
    torchOff: "Éteindre la lampe",
    switch: "Changer de caméra",
    starting: "Démarrage de la caméra",
    aim: "Dirigez la caméra vers le cachet",
    steady: "Tenez le cachet immobile et remplissez-en le cadre. Un éclairage uniforme et un peu de distance aident pour les cachets denses.",
    notStamp: "Ce code QR n’est pas un cachet DKDS.",
    found: "Cachet trouvé",
  },

  paste: {
    title: "Texte du cachet",
    lede: "La forme textuelle d’un cachet commence par DKDS: et correspond à ce qu’un lecteur de codes QR renvoie pour un cachet.",
    label: "Texte du cachet",
    submit: "Vérifier le texte",
    empty: "Saisissez le texte d’un cachet.",
  },

  working: {
    reading: (name) => `Lecture de ${name}`,
    unnamed: "le fichier",
    page: (i, n) => `Lecture de la page ${i} sur ${n}`,
    loadingPdf: "Chargement du lecteur PDF",
    verifying: (n) => (n === 1 ? "Obtention de la clé de l’émetteur" : `Vérification de ${n} cachets`),
    cancel: "Arrêter la lecture",
  },

  result: {
    title: (n) => (n === 1 ? "Résultat de la vérification" : `Résultats de la vérification : ${n} cachets`),
    fromCamera: "Caméra",
    fromText: "Texte",
    unread: (from, to) => `Les pages ${from} à ${to} n’ont pas été lues ; au plus 50 pages d’un fichier PDF sont lues.`,
    others: (n) =>
      n === 1
        ? "1 autre code QR a été trouvé, qui n’est pas un cachet DKDS ; son contenu n’est pas affiché."
        : `${n} autres codes QR ont été trouvés, qui ne sont pas des cachets DKDS ; leur contenu n’est pas affiché.`,
    page: (pages) => (pages.length === 1 ? `Page ${pages[0]}` : `Pages ${list(L, pages.map(String))}`),
    labels: { domain: "Domaine", signed: "Signé", dns: "DNS", warnings: "Avertissements" },
    dnssec: (validated) => (validated ? "Réponse validée par DNSSEC" : "Réponse non validée par DNSSEC"),
    contentsBy: "Contenu du cachet, signé par",
    fieldName: "Champ",
    fieldValue: "Valeur",
    raw: "Texte brut",
    copy: "Copier le texte du cachet",
    copied: "Copié",
    emptyValue: "vide",
    offline: "Cet appareil est hors ligne.",
    whitespace: "Le texte commence ou se termine par une espace ou un saut de ligne, qui ne font pas partie d’un cachet.",
    details: "Détails techniques",
    step: (step) => `Déterminé à l’étape ${step} de la procédure de la section 8.2 de la spécification.`,
    again: "Vérifier de nouveau",
    next: "Vérifier un autre cachet",
  },

  problem: {
    back: "Retour",
    retryCamera: "Ouvrir la caméra",
    openFile: "Ouvrir un fichier",
    pasteText: "Coller le texte",
    cameraDenied: {
      title: "Accès à la caméra refusé",
      body:
        "Le navigateur n’a pas autorisé cette page à utiliser la caméra. L’accès peut être accordé dans les paramètres du navigateur pour scan.dkds.org, après quoi la caméra peut être rouverte. Une photo du cachet peut aussi être ouverte comme fichier.",
      ios: "Sur iPhone et iPad, l’accès à la caméra pour les sites web se règle dans Réglages, Apps, Safari, Appareil photo.",
      android: "Dans Chrome, l’accès à la caméra se règle par l’icône à gauche de l’adresse, puis Autorisations.",
    },
    cameraMissing: {
      title: "Aucune caméra trouvée",
      body: "Cet appareil n’a aucune caméra que le navigateur puisse utiliser. Une photo ou un scan du document peut être ouvert comme fichier à la place.",
    },
    cameraBusy: {
      title: "Caméra indisponible",
      body: "La caméra n’a pas pu être démarrée. Une autre application l’utilise peut-être ; elle redevient disponible lorsque cette application la libère.",
    },
    cameraUnsupported: {
      title: "Caméra non prise en charge",
      body: "Ce navigateur ne donne pas aux pages web l’accès à la caméra. Une photo du cachet peut être ouverte comme fichier à la place.",
    },
    cameraInsecure: {
      title: "Caméra indisponible sur cette connexion",
      body: "Les navigateurs n’autorisent la caméra que sur les pages chargées en HTTPS. Le vérificateur est disponible à l’adresse https://scan.dkds.org.",
    },
    cameraStopped: {
      title: "Caméra arrêtée",
      body: "La caméra a cessé d’envoyer des images, par exemple parce qu’elle a été déconnectée ou prise par une autre application.",
    },
    fileType: {
      title: "Type de fichier non pris en charge",
      body: (name) =>
        `${name} n’est ni une image ni un fichier PDF. Le vérificateur lit les images PNG, JPEG et WebP, les images HEIC lorsque le navigateur les prend en charge, et les fichiers PDF.`,
    },
    fileTooLarge: {
      title: "Fichier trop volumineux",
      body: (name) => `${name} dépasse 100 Mo, la taille maximale de fichier que lit le vérificateur.`,
    },
    fileEmpty: {
      title: "Fichier vide",
      body: (name) => `${name} ne contient aucune donnée.`,
    },
    imageUnreadable: {
      title: "Image impossible à ouvrir",
      body: (name) =>
        `Ce navigateur ne peut pas décoder ${name}. Le fichier est peut-être endommagé, ou dans un format que le navigateur ne prend pas en charge, comme HEIC en dehors de Safari. Une capture d’écran ou une copie JPEG de l’image peut être ouverte à la place.`,
    },
    pdfUnreadable: {
      title: "Fichier PDF illisible",
      body: (name) => `${name} est endommagé ou n’est pas un fichier PDF.`,
    },
    pdfUnavailable: {
      title: "Lecteur PDF indisponible",
      body: "Le lecteur PDF n’a pas pu être chargé. Il est chargé à l’ouverture du premier fichier PDF, ce qui nécessite une connexion réseau. Une capture d’écran de la page portant le cachet peut être ouverte comme image à la place.",
    },
    pdfPassword: {
      title: "Mot de passe requis",
      body: (name) => `${name} est protégé par un mot de passe. Le mot de passe n’est utilisé que sur cet appareil.`,
      label: "Mot de passe",
      submit: "Ouvrir le fichier PDF",
      incorrect: "Le mot de passe est incorrect.",
    },
    noCode: {
      title: "Aucun code QR trouvé",
      image: (name) =>
        `Aucun code QR n’a été trouvé dans ${name}. Un cachet se lit le plus sûrement sur une image nette et uniformément éclairée, où il apparaît en grand et de face.`,
      pdf: (name, pages) => `Aucun code QR n’a été trouvé sur ${pages === 1 ? "la page lue" : `les ${pages} pages lues`} de ${name}.`,
    },
    notStamp: {
      title: "Pas un cachet DKDS",
      body: (n) =>
        n === 1
          ? "Le code QR trouvé n’est pas un cachet DKDS. Son contenu n’est pas affiché, car le vérificateur n’affiche que des cachets."
          : `Les ${n} codes QR trouvés ne sont pas des cachets DKDS. Leur contenu n’est pas affiché, car le vérificateur n’affiche que des cachets.`,
    },
    readerFailed: {
      title: "Lecteur QR indisponible",
      body: "Le lecteur QR n’a pas pu être démarré dans ce navigateur. Le texte d’un cachet peut toujours être collé et vérifié.",
    },
    browser: {
      title: "Navigateur non pris en charge",
      body: "Il manque à ce navigateur des fonctions nécessaires au vérificateur. Celui-ci fonctionne dans les versions actuelles de Safari, Chrome, Edge et Firefox.",
    },
    unexpected: {
      title: "Erreur inattendue",
      body: (message) => `Le vérificateur s’est arrêté en raison d’une erreur : ${message}`,
    },
    multipleFiles: "Seul le premier des fichiers a été lu.",
  },
};
