/** The texts of the verifier in Dutch; see en.ts for the source and the meaning of each key. */

import type { Texts } from "./en.ts";
import { count, domainList, list } from "./grammar.ts";

const L = "nl-NL";

export const nl: Texts = {
  code: "nl",
  locale: L,
  language: "Taal",

  appName: "DKDS Verificatie",

  outcomes: {
    valid: {
      title: "Handtekening geldig",
      description: "De stempel is ondertekend met de sleutel die het domein ervan publiceert.",
    },
    malformed: {
      title: "Geen geldige stempel",
      description: "De code is geen geldige DKDS-stempel.",
    },
    unsupported: {
      title: "Niet-ondersteunde stempel",
      description: "De stempel gebruikt een versie of algoritme die dit verificatieprogramma niet ondersteunt.",
    },
    "key-not-found": {
      title: "Sleutel niet gevonden",
      description: "Voor deze stempel is geen sleutel gepubliceerd. De herkomst ervan kan niet worden bevestigd.",
    },
    "key-revoked": {
      title: "Sleutel ingetrokken",
      description: "De sleutel van deze stempel is ingetrokken door de houder van het domein.",
    },
    "invalid-signature": {
      title: "Ongeldige handtekening",
      description: "De handtekening komt niet overeen met de inhoud van de stempel.",
    },
    unavailable: {
      title: "Sleutel niet beschikbaar",
      description: "De sleutel kon niet worden opgehaald. De stempel kan later opnieuw worden gecontroleerd.",
    },
  },

  warnings: {
    idn: ({ ascii }) => ["Het domein bevat tekens buiten het Latijnse basisalfabet. In de DNS wordt het geschreven als ", { domain: ascii }, "."],
    "mixed-script": () => ["Het domein mengt tekens uit verschillende schriften, een methode om andere domeinen na te bootsen."],
    "single-resolver": () => ["Slechts een van de twee DNS-resolvers antwoordde, zodat de sleutel niet tussen beide kon worden vergeleken."],
    "key-changed": () => [
      "De sleutel die voor dit domein is gepubliceerd, verschilt van de sleutel die eerder op dit apparaat is gezien. De houder kan hem hebben vervangen, of het DNS-antwoord kan vervalst zijn.",
    ],
    "key-disappeared": () => ["Een sleutel die eerder op dit apparaat is gezien, wordt niet meer voor dit domein gepubliceerd."],
    "similar-domain": ({ similar }) => [
      "Het domein lijkt op ",
      ...domainList(L, similar),
      ", waarvan eerder stempels op dit apparaat zijn geverifieerd.",
    ],
  },

  home: {
    title: "Verificatie van documentstempels",
    lede:
      "Het verificatieprogramma leest een DKDS-stempel van een document en controleert de handtekening met de sleutel die de uitgever in de DNS publiceert.",
    camera: "Camera openen",
    file: "Bestand openen",
    text: "Tekst plakken",
    fileHint: "Afbeeldingen (PNG, JPEG, WebP, HEIC) en pdf-bestanden",
    drop: "Laat het bestand los om het te lezen",
    install: "App installeren",
  },

  privacy: {
    title: "Privacy",
    body:
      "Afbeeldingen, pdf-bestanden en camerabeelden worden in deze browser verwerkt en nooit verzonden. Om een stempel te controleren, vraagt het verificatieprogramma via een versleutelde verbinding twee DNS-resolvers, Cloudflare en Google, om de sleutel van de uitgever. De vraag noemt het domein van de uitgever en de sleutel-ID, en kan de DNS-beheerder van de uitgever bereiken. Geen andere gegevens verlaten het apparaat.",
    store: (n) =>
      n === 0
        ? "Er zijn momenteel geen geverifieerde domeinen op dit apparaat opgeslagen."
        : `Sleutels van ${count(L, n, { one: "geverifieerd domein", other: "geverifieerde domeinen" })} zijn op dit apparaat opgeslagen, om gewijzigde sleutels en gelijkende domeinen te herkennen.`,
    forget: "Geverifieerde domeinen vergeten",
    forgetConfirm: (n) => (n === 1 ? "Het domein dat op dit apparaat is geverifieerd, vergeten?" : `De ${n} domeinen die op dit apparaat zijn geverifieerd, vergeten?`),
    forgotten: "De geverifieerde domeinen zijn vergeten.",
  },

  footer: {
    about: "Over DKDS",
    docs: "Documentatie",
    source: "Broncode",
    madeIn: "Gemaakt met 💙 in Delft",
    licences: "Licenties",
    version: (version, build) => `Verificatieprogramma ${version} · build ${build}`,
  },

  camera: {
    title: "Camera",
    close: "Camera sluiten",
    torchOn: "Zaklamp aanzetten",
    torchOff: "Zaklamp uitzetten",
    switch: "Camera wisselen",
    starting: "De camera wordt gestart",
    aim: "Richt de camera op de stempel",
    steady: "Houd de stempel stil en vul het kader ermee. Gelijkmatig licht en een kleine afstand helpen bij dichte stempels.",
    notStamp: "Deze QR-code is geen DKDS-stempel.",
    found: "Stempel gevonden",
  },

  paste: {
    title: "Stempeltekst",
    lede: "De tekstvorm van een stempel begint met DKDS: en is wat een QR-codelezer voor een stempel teruggeeft.",
    label: "Tekst van de stempel",
    submit: "Tekst verifiëren",
    empty: "Voer de tekst van een stempel in.",
  },

  working: {
    reading: (name) => `Lezen van ${name}`,
    unnamed: "het bestand",
    page: (i, n) => `Pagina ${i} van ${n} wordt gelezen`,
    loadingPdf: "De pdf-lezer wordt geladen",
    verifying: (n) => (n === 1 ? "De sleutel van de uitgever wordt opgehaald" : `${n} stempels worden geverifieerd`),
    cancel: "Lezen stoppen",
  },

  result: {
    title: (n) => (n === 1 ? "Verificatieresultaat" : `Verificatieresultaten: ${n} stempels`),
    fromCamera: "Camera",
    fromText: "Tekst",
    unread: (from, to) => `Pagina ${from} tot en met ${to} zijn niet gelezen; van een pdf-bestand worden ten hoogste 50 pagina's gelezen.`,
    others: (n) =>
      n === 1
        ? "Er is 1 andere QR-code gevonden die geen DKDS-stempel is; de inhoud ervan wordt niet getoond."
        : `Er zijn ${n} andere QR-codes gevonden die geen DKDS-stempels zijn; de inhoud ervan wordt niet getoond.`,
    page: (pages) => (pages.length === 1 ? `Pagina ${pages[0]}` : `Pagina's ${list(L, pages.map(String))}`),
    labels: { domain: "Domein", signed: "Ondertekend", dns: "DNS", warnings: "Waarschuwingen" },
    dnssec: (validated) => (validated ? "Antwoord gevalideerd met DNSSEC" : "Antwoord niet gevalideerd met DNSSEC"),
    contentsBy: "Inhoud van de stempel, ondertekend door",
    fieldName: "Veld",
    fieldValue: "Waarde",
    raw: "Ruwe tekst",
    copy: "Stempeltekst kopiëren",
    copied: "Gekopieerd",
    emptyValue: "leeg",
    offline: "Dit apparaat is offline.",
    whitespace: "De tekst begint of eindigt met een spatie of een regeleinde, die geen deel van een stempel zijn.",
    details: "Technische details",
    step: (step) => `Vastgesteld bij stap ${step} van de procedure in paragraaf 8.2 van de specificatie.`,
    again: "Opnieuw verifiëren",
    next: "Een andere stempel verifiëren",
  },

  problem: {
    back: "Terug",
    retryCamera: "Camera openen",
    openFile: "Bestand openen",
    pasteText: "Tekst plakken",
    cameraDenied: {
      title: "Cameratoegang geweigerd",
      body:
        "De browser heeft deze pagina niet toegestaan de camera te gebruiken. Toegang kan worden verleend in de browserinstellingen voor scan.dkds.org, waarna de camera opnieuw kan worden geopend. Een foto van de stempel kan ook als bestand worden geopend.",
      ios: "Op iPhone en iPad wordt cameratoegang voor websites ingesteld onder Instellingen, Apps, Safari, Camera.",
      android: "In Chrome wordt cameratoegang ingesteld via het pictogram links van het adres en vervolgens Rechten.",
    },
    cameraMissing: {
      title: "Geen camera gevonden",
      body: "Dit apparaat heeft geen camera die de browser kan gebruiken. Een foto of scan van het document kan in plaats daarvan als bestand worden geopend.",
    },
    cameraBusy: {
      title: "Camera niet beschikbaar",
      body: "De camera kon niet worden gestart. Mogelijk gebruikt een andere toepassing hem; hij komt beschikbaar wanneer die toepassing hem vrijgeeft.",
    },
    cameraUnsupported: {
      title: "Camera niet ondersteund",
      body: "Deze browser geeft webpagina's geen toegang tot de camera. Een foto van de stempel kan in plaats daarvan als bestand worden geopend.",
    },
    cameraInsecure: {
      title: "Camera niet beschikbaar via deze verbinding",
      body: "Browsers staan de camera alleen toe op pagina's die via HTTPS zijn geladen. Het verificatieprogramma staat op https://scan.dkds.org.",
    },
    cameraStopped: {
      title: "Camera gestopt",
      body: "De camera stuurt geen beelden meer, bijvoorbeeld omdat hij is losgekoppeld of door een andere toepassing in gebruik is genomen.",
    },
    fileType: {
      title: "Bestandstype niet ondersteund",
      body: (name) =>
        `${name} is geen afbeelding en geen pdf-bestand. Het verificatieprogramma leest PNG-, JPEG- en WebP-afbeeldingen, HEIC-afbeeldingen waar de browser die ondersteunt, en pdf-bestanden.`,
    },
    fileTooLarge: {
      title: "Bestand te groot",
      body: (name) => `${name} is groter dan 100 MB, het grootste bestand dat het verificatieprogramma leest.`,
    },
    fileEmpty: {
      title: "Leeg bestand",
      body: (name) => `${name} bevat geen gegevens.`,
    },
    imageUnreadable: {
      title: "Afbeelding kon niet worden geopend",
      body: (name) =>
        `Deze browser kan ${name} niet decoderen. Het bestand is mogelijk beschadigd of heeft een indeling die de browser niet ondersteunt, zoals HEIC buiten Safari. Een schermafbeelding of een JPEG-kopie van de afbeelding kan in plaats daarvan worden geopend.`,
    },
    pdfUnreadable: {
      title: "Pdf-bestand kon niet worden gelezen",
      body: (name) => `${name} is beschadigd of is geen pdf-bestand.`,
    },
    pdfUnavailable: {
      title: "Pdf-lezer niet beschikbaar",
      body: "De pdf-lezer kon niet worden geladen. Hij wordt geladen wanneer het eerste pdf-bestand wordt geopend, waarvoor een netwerkverbinding nodig is. Een schermafbeelding van de pagina met de stempel kan in plaats daarvan als afbeelding worden geopend.",
    },
    pdfPassword: {
      title: "Wachtwoord vereist",
      body: (name) => `${name} is beveiligd met een wachtwoord. Het wachtwoord wordt alleen op dit apparaat gebruikt.`,
      label: "Wachtwoord",
      submit: "Pdf-bestand openen",
      incorrect: "Het wachtwoord is onjuist.",
    },
    noCode: {
      title: "Geen QR-code gevonden",
      image: (name) =>
        `In ${name} is geen QR-code gevonden. Een stempel wordt het betrouwbaarst gelezen uit een scherpe, gelijkmatig belichte afbeelding waarin de stempel groot en recht van voren te zien is.`,
      pdf: (name, pages) => `Op ${pages === 1 ? "de gelezen pagina" : `de ${pages} gelezen pagina's`} van ${name} is geen QR-code gevonden.`,
    },
    notStamp: {
      title: "Geen DKDS-stempel",
      body: (n) =>
        n === 1
          ? "De gevonden QR-code is geen DKDS-stempel. De inhoud ervan wordt niet getoond, omdat het verificatieprogramma alleen stempels weergeeft."
          : `De ${n} gevonden QR-codes zijn geen DKDS-stempels. De inhoud ervan wordt niet getoond, omdat het verificatieprogramma alleen stempels weergeeft.`,
    },
    readerFailed: {
      title: "QR-lezer niet beschikbaar",
      body: "De QR-lezer kon in deze browser niet worden gestart. De tekst van een stempel kan nog wel worden geplakt en geverifieerd.",
    },
    browser: {
      title: "Browser niet ondersteund",
      body: "Deze browser mist functies die het verificatieprogramma nodig heeft. Het werkt in actuele versies van Safari, Chrome, Edge en Firefox.",
    },
    unexpected: {
      title: "Onverwachte fout",
      body: (message) => `Het verificatieprogramma is door een fout gestopt: ${message}`,
    },
    multipleFiles: "Alleen het eerste van de bestanden is gelezen.",
  },
};
