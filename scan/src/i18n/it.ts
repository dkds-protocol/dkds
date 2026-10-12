/** The texts of the verifier in Italian; see en.ts for the source and the meaning of each key. */

import type { Texts } from "./en.ts";
import { count, domainList, list } from "./grammar.ts";

const L = "it-IT";

export const it: Texts = {
  code: "it",
  locale: L,
  language: "Lingua",

  appName: "DKDS Verifica",

  outcomes: {
    valid: {
      title: "Firma valida",
      description: "Il timbro è stato firmato con la chiave pubblicata dal suo dominio.",
    },
    malformed: {
      title: "Timbro non valido",
      description: "Il codice non è un timbro DKDS valido.",
    },
    unsupported: {
      title: "Timbro non supportato",
      description: "Il timbro usa una versione o un algoritmo che questo verificatore non supporta.",
    },
    "key-not-found": {
      title: "Chiave non trovata",
      description: "Per questo timbro non è pubblicata alcuna chiave. La sua origine non può essere confermata.",
    },
    "key-revoked": {
      title: "Chiave revocata",
      description: "La chiave di questo timbro è stata revocata dal titolare del dominio.",
    },
    "invalid-signature": {
      title: "Firma non valida",
      description: "La firma non corrisponde al contenuto del timbro.",
    },
    unavailable: {
      title: "Chiave non disponibile",
      description: "Non è stato possibile ottenere la chiave. Il timbro può essere verificato di nuovo più tardi.",
    },
  },

  warnings: {
    idn: ({ ascii }) => ["Il dominio contiene caratteri esterni all’alfabeto latino di base. Nel DNS si scrive ", { domain: ascii }, "."],
    "mixed-script": () => ["Il dominio mescola caratteri di scritture diverse, un metodo usato per imitare altri domini."],
    "single-resolver": () => ["Ha risposto solo uno dei due resolver DNS, quindi non è stato possibile confrontare la chiave tra i due."],
    "key-changed": () => [
      "La chiave pubblicata per questo dominio è diversa da quella vista in precedenza su questo dispositivo. Il titolare potrebbe averla sostituita, oppure la risposta DNS potrebbe essere falsificata.",
    ],
    "key-disappeared": () => ["Una chiave vista in precedenza su questo dispositivo non è più pubblicata per questo dominio."],
    "similar-domain": ({ similar }) => [
      "Il dominio somiglia a ",
      ...domainList(L, similar),
      ", di cui sono già stati verificati timbri su questo dispositivo.",
    ],
  },

  home: {
    title: "Verifica dei timbri sui documenti",
    lede:
      "Il verificatore legge un timbro DKDS da un documento e ne controlla la firma con la chiave che l’emittente pubblica nel DNS.",
    camera: "Apri fotocamera",
    file: "Apri file",
    text: "Incolla testo",
    fileHint: "Immagini (PNG, JPEG, WebP, HEIC) e file PDF",
    drop: "Rilascia il file per leggerlo",
    install: "Installa app",
  },

  privacy: {
    title: "Privacy",
    body:
      "Immagini, file PDF e fotogrammi della fotocamera vengono elaborati in questo browser e non vengono mai inviati. Per controllare un timbro, il verificatore chiede la chiave dell’emittente a due resolver DNS, Cloudflare e Google, tramite una connessione cifrata. La richiesta indica il dominio dell’emittente e l’ID della chiave, e può raggiungere il gestore DNS dell’emittente. Nessun altro dato lascia il dispositivo.",
    store: (n) =>
      n === 0
        ? "Su questo dispositivo non sono attualmente memorizzati domini verificati."
        : `Le chiavi di ${count(L, n, { one: "dominio verificato", other: "domini verificati" })} sono memorizzate su questo dispositivo, per rilevare chiavi cambiate e domini simili.`,
    forget: "Dimentica domini verificati",
    forgetConfirm: (n) => (n === 1 ? "Dimenticare il dominio verificato su questo dispositivo?" : `Dimenticare i ${n} domini verificati su questo dispositivo?`),
    forgotten: "I domini verificati sono stati dimenticati.",
  },

  footer: {
    about: "Informazioni su DKDS",
    docs: "Documentazione",
    source: "Codice sorgente",
    madeIn: "Fatto con 💙 a Delft",
    licences: "Licenze",
    version: (version, build) => `Verificatore ${version} · build ${build}`,
  },

  camera: {
    title: "Fotocamera",
    close: "Chiudi fotocamera",
    torchOn: "Accendi torcia",
    torchOff: "Spegni torcia",
    switch: "Cambia fotocamera",
    starting: "Avvio della fotocamera",
    aim: "Inquadra il timbro con la fotocamera",
    steady: "Tieni fermo il timbro e riempi la cornice. Una luce uniforme e un po’ di distanza aiutano con i timbri densi.",
    notStamp: "Questo codice QR non è un timbro DKDS.",
    found: "Timbro trovato",
  },

  paste: {
    title: "Testo del timbro",
    lede: "La forma testuale di un timbro inizia con DKDS: ed è ciò che un lettore di codici QR restituisce per un timbro.",
    label: "Testo del timbro",
    submit: "Verifica testo",
    empty: "Inserisci il testo di un timbro.",
  },

  working: {
    reading: (name) => `Lettura di ${name}`,
    unnamed: "il file",
    page: (i, n) => `Lettura della pagina ${i} di ${n}`,
    loadingPdf: "Caricamento del lettore PDF",
    verifying: (n) => (n === 1 ? "Recupero della chiave dell’emittente" : `Verifica di ${n} timbri`),
    cancel: "Interrompi lettura",
  },

  result: {
    title: (n) => (n === 1 ? "Risultato della verifica" : `Risultati della verifica: ${n} timbri`),
    fromCamera: "Fotocamera",
    fromText: "Testo",
    unread: (from, to) => `Le pagine da ${from} a ${to} non sono state lette; di un file PDF si leggono al massimo 50 pagine.`,
    others: (n) =>
      n === 1
        ? "È stato trovato 1 altro codice QR che non è un timbro DKDS; il suo contenuto non viene mostrato."
        : `Sono stati trovati altri ${n} codici QR che non sono timbri DKDS; il loro contenuto non viene mostrato.`,
    page: (pages) => (pages.length === 1 ? `Pagina ${pages[0]}` : `Pagine ${list(L, pages.map(String))}`),
    labels: { domain: "Dominio", signed: "Firmato", dns: "DNS", warnings: "Avvisi" },
    dnssec: (validated) => (validated ? "Risposta convalidata con DNSSEC" : "Risposta non convalidata con DNSSEC"),
    contentsBy: "Contenuto del timbro, firmato da",
    fieldName: "Campo",
    fieldValue: "Valore",
    raw: "Testo grezzo",
    copy: "Copia testo del timbro",
    copied: "Copiato",
    emptyValue: "vuoto",
    offline: "Questo dispositivo è offline.",
    whitespace: "Il testo inizia o termina con uno spazio o un a capo, che non fanno parte di un timbro.",
    details: "Dettagli tecnici",
    step: (step) => `Determinato al passo ${step} della procedura nella sezione 8.2 della specifica.`,
    again: "Verifica di nuovo",
    next: "Verifica un altro timbro",
  },

  problem: {
    back: "Indietro",
    retryCamera: "Apri fotocamera",
    openFile: "Apri file",
    pasteText: "Incolla testo",
    cameraDenied: {
      title: "Accesso alla fotocamera negato",
      body:
        "Il browser non ha consentito a questa pagina di usare la fotocamera. L’accesso può essere concesso nelle impostazioni del browser per scan.dkds.org, dopodiché la fotocamera può essere riaperta. Una foto del timbro può anche essere aperta come file.",
      ios: "Su iPhone e iPad, l’accesso alla fotocamera per i siti web si imposta in Impostazioni, App, Safari, Fotocamera.",
      android: "In Chrome, l’accesso alla fotocamera si imposta dall’icona a sinistra dell’indirizzo, poi Autorizzazioni.",
    },
    cameraMissing: {
      title: "Nessuna fotocamera trovata",
      body: "Questo dispositivo non ha una fotocamera che il browser possa usare. In alternativa, una foto o una scansione del documento può essere aperta come file.",
    },
    cameraBusy: {
      title: "Fotocamera non disponibile",
      body: "Non è stato possibile avviare la fotocamera. Un’altra applicazione potrebbe usarla; diventa disponibile quando quell’applicazione la rilascia.",
    },
    cameraUnsupported: {
      title: "Fotocamera non supportata",
      body: "Questo browser non concede alle pagine web l’accesso alla fotocamera. In alternativa, una foto del timbro può essere aperta come file.",
    },
    cameraInsecure: {
      title: "Fotocamera non disponibile su questa connessione",
      body: "I browser consentono la fotocamera solo nelle pagine caricate tramite HTTPS. Il verificatore è disponibile all’indirizzo https://scan.dkds.org.",
    },
    cameraStopped: {
      title: "Fotocamera interrotta",
      body: "La fotocamera ha smesso di inviare immagini, per esempio perché è stata scollegata o occupata da un’altra applicazione.",
    },
    fileType: {
      title: "Tipo di file non supportato",
      body: (name) =>
        `${name} non è né un’immagine né un file PDF. Il verificatore legge immagini PNG, JPEG e WebP, immagini HEIC dove il browser le supporta, e file PDF.`,
    },
    fileTooLarge: {
      title: "File troppo grande",
      body: (name) => `${name} supera i 100 MB, la dimensione massima di file che il verificatore legge.`,
    },
    fileEmpty: {
      title: "File vuoto",
      body: (name) => `${name} non contiene dati.`,
    },
    imageUnreadable: {
      title: "Impossibile aprire l’immagine",
      body: (name) =>
        `Questo browser non riesce a decodificare ${name}. Il file potrebbe essere danneggiato o in un formato che il browser non supporta, come HEIC al di fuori di Safari. In alternativa, si può aprire uno screenshot o una copia JPEG dell’immagine.`,
    },
    pdfUnreadable: {
      title: "Impossibile leggere il file PDF",
      body: (name) => `${name} è danneggiato o non è un file PDF.`,
    },
    pdfUnavailable: {
      title: "Lettore PDF non disponibile",
      body: "Non è stato possibile caricare il lettore PDF. Viene caricato all’apertura del primo file PDF, che richiede una connessione di rete. In alternativa, uno screenshot della pagina con il timbro può essere aperto come immagine.",
    },
    pdfPassword: {
      title: "Password richiesta",
      body: (name) => `${name} è protetto da una password. La password viene usata solo su questo dispositivo.`,
      label: "Password",
      submit: "Apri file PDF",
      incorrect: "La password non è corretta.",
    },
    noCode: {
      title: "Nessun codice QR trovato",
      image: (name) =>
        `Nessun codice QR trovato in ${name}. Un timbro si legge in modo più affidabile da un’immagine nitida e illuminata in modo uniforme, in cui il timbro appare grande e di fronte.`,
      pdf: (name, pages) => `Nessun codice QR trovato ${pages === 1 ? "nella pagina letta" : `nelle ${pages} pagine lette`} di ${name}.`,
    },
    notStamp: {
      title: "Non è un timbro DKDS",
      body: (n) =>
        n === 1
          ? "Il codice QR trovato non è un timbro DKDS. Il suo contenuto non viene mostrato, perché il verificatore mostra solo timbri."
          : `I ${n} codici QR trovati non sono timbri DKDS. Il loro contenuto non viene mostrato, perché il verificatore mostra solo timbri.`,
    },
    readerFailed: {
      title: "Lettore QR non disponibile",
      body: "Non è stato possibile avviare il lettore QR in questo browser. Il testo di un timbro può comunque essere incollato e verificato.",
    },
    browser: {
      title: "Browser non supportato",
      body: "A questo browser mancano funzioni necessarie al verificatore. Funziona nelle versioni attuali di Safari, Chrome, Edge e Firefox.",
    },
    unexpected: {
      title: "Errore imprevisto",
      body: (message) => `Il verificatore si è interrotto a causa di un errore: ${message}`,
    },
    multipleFiles: "È stato letto solo il primo dei file.",
  },
};
