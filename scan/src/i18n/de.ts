/** The texts of the verifier in German; see en.ts for the source and the meaning of each key. */

import type { Texts } from "./en.ts";
import { count, domainList, list } from "./grammar.ts";

const L = "de-DE";

export const de: Texts = {
  code: "de",
  locale: L,
  language: "Sprache",

  appName: "DKDS Prüfung",

  outcomes: {
    valid: {
      title: "Signatur gültig",
      description: "Der Stempel wurde mit dem Schlüssel signiert, den seine Domain veröffentlicht.",
    },
    malformed: {
      title: "Kein gültiger Stempel",
      description: "Der Code ist kein gültiger DKDS-Stempel.",
    },
    unsupported: {
      title: "Nicht unterstützter Stempel",
      description: "Der Stempel verwendet eine Version oder einen Algorithmus, die dieses Prüfprogramm nicht unterstützt.",
    },
    "key-not-found": {
      title: "Schlüssel nicht gefunden",
      description: "Für diesen Stempel ist kein Schlüssel veröffentlicht. Seine Herkunft kann nicht bestätigt werden.",
    },
    "key-revoked": {
      title: "Schlüssel widerrufen",
      description: "Der Schlüssel dieses Stempels wurde vom Inhaber der Domain widerrufen.",
    },
    "invalid-signature": {
      title: "Ungültige Signatur",
      description: "Die Signatur stimmt nicht mit dem Inhalt des Stempels überein.",
    },
    unavailable: {
      title: "Schlüssel nicht verfügbar",
      description: "Der Schlüssel konnte nicht abgerufen werden. Der Stempel kann später erneut geprüft werden.",
    },
  },

  warnings: {
    idn: ({ ascii }) => ["Die Domain enthält Zeichen außerhalb des lateinischen Grundalphabets. Im DNS wird sie ", { domain: ascii }, " geschrieben."],
    "mixed-script": () => ["Die Domain mischt Zeichen verschiedener Schriften, eine Methode, mit der andere Domains nachgeahmt werden."],
    "single-resolver": () => ["Nur einer der beiden DNS-Resolver hat geantwortet, sodass der Schlüssel nicht zwischen ihnen verglichen werden konnte."],
    "key-changed": () => [
      "Der für diese Domain veröffentlichte Schlüssel unterscheidet sich von dem Schlüssel, der zuvor auf diesem Gerät gesehen wurde. Der Inhaber kann ihn ersetzt haben, oder die DNS-Antwort kann gefälscht sein.",
    ],
    "key-disappeared": () => ["Ein zuvor auf diesem Gerät gesehener Schlüssel wird für diese Domain nicht mehr veröffentlicht."],
    "similar-domain": ({ similar }) => [
      "Die Domain ähnelt ",
      ...domainList(L, similar),
      ", deren Stempel zuvor auf diesem Gerät geprüft wurden.",
    ],
  },

  home: {
    title: "Prüfung von Dokumentstempeln",
    lede:
      "Das Prüfprogramm liest einen DKDS-Stempel von einem Dokument und prüft seine Signatur mit dem Schlüssel, den der Aussteller im DNS veröffentlicht.",
    camera: "Kamera öffnen",
    file: "Datei öffnen",
    text: "Text einfügen",
    fileHint: "Bilder (PNG, JPEG, WebP, HEIC) und PDF-Dateien",
    drop: "Datei ablegen, um sie zu lesen",
    install: "App installieren",
  },

  privacy: {
    title: "Datenschutz",
    body:
      "Bilder, PDF-Dateien und Kamerabilder werden in diesem Browser verarbeitet und nie gesendet. Um einen Stempel zu prüfen, fragt das Prüfprogramm über eine verschlüsselte Verbindung zwei DNS-Resolver, Cloudflare und Google, nach dem Schlüssel des Ausstellers. Die Anfrage nennt die Domain des Ausstellers und die Schlüssel-ID und kann den DNS-Betreiber des Ausstellers erreichen. Keine anderen Daten verlassen das Gerät.",
    store: (n) =>
      n === 0
        ? "Auf diesem Gerät sind derzeit keine geprüften Domains gespeichert."
        : `Die Schlüssel von ${count(L, n, { one: "geprüften Domain", other: "geprüften Domains" })} sind auf diesem Gerät gespeichert, um geänderte Schlüssel und ähnliche Domains zu erkennen.`,
    forget: "Geprüfte Domains vergessen",
    forgetConfirm: (n) => (n === 1 ? "Die auf diesem Gerät geprüfte Domain vergessen?" : `Die ${n} auf diesem Gerät geprüften Domains vergessen?`),
    forgotten: "Die geprüften Domains wurden vergessen.",
  },

  footer: {
    about: "Über DKDS",
    docs: "Dokumentation",
    source: "Quellcode",
    madeIn: "Mit 💙 in Delft gemacht",
    licences: "Lizenzen",
    version: (version, build) => `Prüfprogramm ${version} · Build ${build}`,
  },

  camera: {
    title: "Kamera",
    close: "Kamera schließen",
    torchOn: "Licht einschalten",
    torchOff: "Licht ausschalten",
    switch: "Kamera wechseln",
    starting: "Die Kamera wird gestartet",
    aim: "Die Kamera auf den Stempel richten",
    steady: "Den Stempel ruhig halten und den Rahmen damit ausfüllen. Gleichmäßiges Licht und etwas Abstand helfen bei dichten Stempeln.",
    notStamp: "Dieser QR-Code ist kein DKDS-Stempel.",
    found: "Stempel gefunden",
  },

  paste: {
    title: "Stempeltext",
    lede: "Die Textform eines Stempels beginnt mit DKDS: und ist das, was ein QR-Code-Leser für einen Stempel ausgibt.",
    label: "Text des Stempels",
    submit: "Text prüfen",
    empty: "Den Text eines Stempels eingeben.",
  },

  working: {
    reading: (name) => `${name} wird gelesen`,
    unnamed: "die Datei",
    page: (i, n) => `Seite ${i} von ${n} wird gelesen`,
    loadingPdf: "Der PDF-Leser wird geladen",
    verifying: (n) => (n === 1 ? "Der Schlüssel des Ausstellers wird abgerufen" : `${n} Stempel werden geprüft`),
    cancel: "Lesen beenden",
  },

  result: {
    title: (n) => (n === 1 ? "Prüfergebnis" : `Prüfergebnisse: ${n} Stempel`),
    fromCamera: "Kamera",
    fromText: "Text",
    unread: (from, to) => `Die Seiten ${from} bis ${to} wurden nicht gelesen; von einer PDF-Datei werden höchstens 50 Seiten gelesen.`,
    others: (n) =>
      n === 1
        ? "1 weiterer QR-Code wurde gefunden, der kein DKDS-Stempel ist; sein Inhalt wird nicht angezeigt."
        : `${n} weitere QR-Codes wurden gefunden, die keine DKDS-Stempel sind; ihr Inhalt wird nicht angezeigt.`,
    page: (pages) => (pages.length === 1 ? `Seite ${pages[0]}` : `Seiten ${list(L, pages.map(String))}`),
    labels: { domain: "Domain", signed: "Signiert", dns: "DNS", warnings: "Warnungen" },
    stated: "Laut Aussteller",
    dnssec: (validated) => (validated ? "Antwort mit DNSSEC validiert" : "Antwort nicht mit DNSSEC validiert"),
    contentsBy: "Inhalt des Stempels, signiert von",
    compare: "Die Felder mit dem Dokument vergleichen. Ein Unterschied zeigt, dass eines von beiden verändert wurde.",
    fieldName: "Feld",
    fieldValue: "Wert",
    raw: "Rohtext",
    copy: "Stempeltext kopieren",
    copied: "Kopiert",
    emptyValue: "leer",
    offline: "Dieses Gerät ist offline.",
    whitespace: "Der Text beginnt oder endet mit einem Leerzeichen oder einem Zeilenumbruch, die nicht zu einem Stempel gehören.",
    details: "Technische Details",
    step: (step) => `Festgestellt in Schritt ${step} des Verfahrens in Abschnitt 8.2 der Spezifikation.`,
    again: "Erneut prüfen",
    next: "Weiteren Stempel prüfen",
  },

  problem: {
    back: "Zurück",
    retryCamera: "Kamera öffnen",
    openFile: "Datei öffnen",
    pasteText: "Text einfügen",
    cameraDenied: {
      title: "Kamerazugriff verweigert",
      body:
        "Der Browser hat dieser Seite die Nutzung der Kamera nicht erlaubt. Der Zugriff kann in den Browsereinstellungen für scan.dkds.org gewährt werden; danach kann die Kamera erneut geöffnet werden. Ein Foto des Stempels kann auch als Datei geöffnet werden.",
      ios: "Auf iPhone und iPad wird der Kamerazugriff für Websites unter Einstellungen, Apps, Safari, Kamera festgelegt.",
      android: "In Chrome wird der Kamerazugriff über das Symbol links neben der Adresse und dann Berechtigungen festgelegt.",
    },
    cameraMissing: {
      title: "Keine Kamera gefunden",
      body: "Dieses Gerät hat keine Kamera, die der Browser verwenden kann. Ein Foto oder Scan des Dokuments kann stattdessen als Datei geöffnet werden.",
    },
    cameraBusy: {
      title: "Kamera nicht verfügbar",
      body: "Die Kamera konnte nicht gestartet werden. Möglicherweise verwendet eine andere Anwendung sie; sie wird verfügbar, sobald diese Anwendung sie freigibt.",
    },
    cameraUnsupported: {
      title: "Kamera nicht unterstützt",
      body: "Dieser Browser gibt Webseiten keinen Zugriff auf die Kamera. Ein Foto des Stempels kann stattdessen als Datei geöffnet werden.",
    },
    cameraInsecure: {
      title: "Kamera über diese Verbindung nicht verfügbar",
      body: "Browser erlauben die Kamera nur auf Seiten, die über HTTPS geladen wurden. Das Prüfprogramm ist unter https://scan.dkds.org erreichbar.",
    },
    cameraStopped: {
      title: "Kamera angehalten",
      body: "Die Kamera sendet keine Bilder mehr, zum Beispiel weil sie getrennt oder von einer anderen Anwendung belegt wurde.",
    },
    fileType: {
      title: "Dateityp nicht unterstützt",
      body: (name) =>
        `${name} ist weder ein Bild noch eine PDF-Datei. Das Prüfprogramm liest PNG-, JPEG- und WebP-Bilder, HEIC-Bilder, wo der Browser sie unterstützt, sowie PDF-Dateien.`,
    },
    fileTooLarge: {
      title: "Datei zu groß",
      body: (name) => `${name} ist größer als 100 MB, die größte Datei, die das Prüfprogramm liest.`,
    },
    fileEmpty: {
      title: "Leere Datei",
      body: (name) => `${name} enthält keine Daten.`,
    },
    imageUnreadable: {
      title: "Bild konnte nicht geöffnet werden",
      body: (name) =>
        `Dieser Browser kann ${name} nicht decodieren. Die Datei ist möglicherweise beschädigt oder liegt in einem Format vor, das der Browser nicht unterstützt, etwa HEIC außerhalb von Safari. Stattdessen kann ein Bildschirmfoto oder eine JPEG-Kopie des Bildes geöffnet werden.`,
    },
    pdfUnreadable: {
      title: "PDF-Datei konnte nicht gelesen werden",
      body: (name) => `${name} ist beschädigt oder keine PDF-Datei.`,
    },
    pdfUnavailable: {
      title: "PDF-Leser nicht verfügbar",
      body: "Der PDF-Leser konnte nicht geladen werden. Er wird geladen, wenn die erste PDF-Datei geöffnet wird, wofür eine Netzwerkverbindung nötig ist. Stattdessen kann ein Bildschirmfoto der Seite mit dem Stempel als Bild geöffnet werden.",
    },
    pdfPassword: {
      title: "Passwort erforderlich",
      body: (name) => `${name} ist mit einem Passwort geschützt. Das Passwort wird nur auf diesem Gerät verwendet.`,
      label: "Passwort",
      submit: "PDF-Datei öffnen",
      incorrect: "Das Passwort ist falsch.",
    },
    noCode: {
      title: "Kein QR-Code gefunden",
      image: (name) =>
        `In ${name} wurde kein QR-Code gefunden. Ein Stempel wird am zuverlässigsten aus einem scharfen, gleichmäßig beleuchteten Bild gelesen, in dem er groß und von vorn zu sehen ist.`,
      pdf: (name, pages) => `Auf ${pages === 1 ? "der gelesenen Seite" : `den ${pages} gelesenen Seiten`} von ${name} wurde kein QR-Code gefunden.`,
    },
    notStamp: {
      title: "Kein DKDS-Stempel",
      body: (n) =>
        n === 1
          ? "Der gefundene QR-Code ist kein DKDS-Stempel. Sein Inhalt wird nicht angezeigt, da das Prüfprogramm nur Stempel anzeigt."
          : `Die ${n} gefundenen QR-Codes sind keine DKDS-Stempel. Ihr Inhalt wird nicht angezeigt, da das Prüfprogramm nur Stempel anzeigt.`,
    },
    readerFailed: {
      title: "QR-Leser nicht verfügbar",
      body: "Der QR-Leser konnte in diesem Browser nicht gestartet werden. Der Text eines Stempels kann weiterhin eingefügt und geprüft werden.",
    },
    browser: {
      title: "Browser nicht unterstützt",
      body: "Diesem Browser fehlen Funktionen, die das Prüfprogramm benötigt. Es läuft in aktuellen Versionen von Safari, Chrome, Edge und Firefox.",
    },
    unexpected: {
      title: "Unerwarteter Fehler",
      body: (message) => `Das Prüfprogramm wurde wegen eines Fehlers beendet: ${message}`,
    },
    multipleFiles: "Nur die erste der Dateien wurde gelesen.",
  },
};
