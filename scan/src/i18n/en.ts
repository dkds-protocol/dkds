/**
 * The texts of the verifier in English, the source language: every other language has exactly these
 * keys, which the type {@link Texts} enforces. Field names and values of stamps are never translated;
 * they are shown as the issuer signed them.
 *
 * The outcome descriptions are also the source of the table "Other outcomes" in the documentation
 * page "Building a verifier", which the site build renders from this module.
 */

import type { Outcome } from "../../../dkds.js/src/index.ts";
import { count, domainList, list, type Sentence } from "./grammar.ts";

const L = "en-GB";

/** The details a warning sentence can name. */
export interface WarningDetail {
  /** The domain in its ASCII form, as written in the DNS. */
  readonly ascii: string;
  /** Domains verified before on this device that the stamp's domain resembles. */
  readonly similar: readonly string[];
}

export const en = {
  /** The language tag, as in the lang attribute. */
  code: "en",
  /** The locale of dates, plurals and lists. */
  locale: L,
  /** The accessible name of the language menu. */
  language: "Language",

  appName: "DKDS Verifier",

  /** The status line and the explanation of each outcome. */
  outcomes: {
    valid: {
      title: "Signature valid",
      description: "The stamp was signed with the key that its domain publishes.",
    },
    malformed: {
      title: "Not a valid stamp",
      description: "The code is not a valid DKDS stamp.",
    },
    unsupported: {
      title: "Unsupported stamp",
      description: "The stamp uses a version or algorithm that this verifier does not support.",
    },
    "key-not-found": {
      title: "Key not found",
      description: "No key is published for this stamp. Its origin cannot be confirmed.",
    },
    "key-revoked": {
      title: "Key revoked",
      description: "The key of this stamp has been revoked by the holder of the domain.",
    },
    "invalid-signature": {
      title: "Invalid signature",
      description: "The signature does not match the contents of the stamp.",
    },
    unavailable: {
      title: "Key unavailable",
      description: "The key could not be retrieved. The stamp can be checked again later.",
    },
  } satisfies Record<Outcome, { title: string; description: string }>,

  /** Warning codes of dkds.js and the sentence shown for each. */
  warnings: {
    idn: ({ ascii }: WarningDetail): Sentence => ["The domain contains characters outside the basic Latin alphabet. In the DNS it is written ", { domain: ascii }, "."],
    "mixed-script": (_: WarningDetail): Sentence => ["The domain mixes characters of different scripts, a method used to imitate other domains."],
    "single-resolver": (_: WarningDetail): Sentence => ["Only one of the two DNS resolvers answered, so the key could not be compared between them."],
    "key-changed": (_: WarningDetail): Sentence => [
      "The key published for this domain differs from the key seen on this device before. The holder may have replaced it, or the DNS answer may be forged.",
    ],
    "key-disappeared": (_: WarningDetail): Sentence => ["A key seen on this device before is no longer published for this domain."],
    "similar-domain": ({ similar }: WarningDetail): Sentence => [
      "The domain resembles ",
      ...domainList(L, similar),
      ", of which stamps were verified on this device before.",
    ],
  },

  home: {
    title: "Document stamp verification",
    lede:
      "The verifier reads a DKDS stamp from a document and checks its signature against the key that the issuer publishes in the DNS.",
    camera: "Open camera",
    file: "Open file",
    text: "Paste text",
    fileHint: "Images (PNG, JPEG, WebP, HEIC) and PDF files",
    drop: "Drop the file to read it",
    install: "Install app",
  },

  privacy: {
    title: "Privacy",
    body:
      "Images, PDF files and camera frames are processed in this browser and never sent. To check a stamp, the verifier asks two DNS resolvers, Cloudflare and Google, for the issuer's key over an encrypted connection. The query names the issuer's domain and key ID, and can reach the issuer's DNS operator. No other data leaves the device.",
    store: (n: number) =>
      n === 0
        ? "No verified domains are currently stored on this device."
        : `Keys of ${count(L, n, { one: "verified domain is", other: "verified domains are" })} stored on this device, to detect changed keys and similar domains.`,
    forget: "Forget verified domains",
    forgetConfirm: (n: number) => `Forget the ${count(L, n, { one: "domain", other: "domains" })} verified on this device?`,
    forgotten: "The verified domains have been forgotten.",
  },

  footer: {
    about: "About DKDS",
    docs: "Documentation",
    source: "Source code",
    madeIn: "Made with 💙 in Delft",
    licences: "Licences",
    version: (version: string, build: string) => `Verifier ${version} · build ${build}`,
  },

  camera: {
    title: "Camera",
    close: "Close camera",
    torchOn: "Turn on torch",
    torchOff: "Turn off torch",
    switch: "Switch camera",
    starting: "Starting the camera",
    aim: "Point the camera at the stamp",
    steady: "Hold the stamp steady and fill the frame with it. Even light and a little distance help with dense stamps.",
    notStamp: "This QR code is not a DKDS stamp.",
    found: "Stamp found",
  },

  paste: {
    title: "Stamp text",
    lede: "The text form of a stamp begins with DKDS: and is what a QR code reader returns for a stamp.",
    label: "Text of the stamp",
    submit: "Verify text",
    empty: "Enter the text of a stamp.",
  },

  working: {
    reading: (name: string) => `Reading ${name}`,
    /** The name used for a file that has none, as in "Reading the file". */
    unnamed: "the file",
    page: (i: number, n: number) => `Reading page ${i} of ${n}`,
    loadingPdf: "Loading the PDF reader",
    verifying: (n: number) => (n === 1 ? "Retrieving the issuer's key" : `Verifying ${n} stamps`),
    cancel: "Stop reading",
  },

  result: {
    title: (n: number) => (n === 1 ? "Verification result" : `Verification results: ${n} stamps`),
    /** The tag of a result read with the camera or entered as text; a file is tagged with its name. */
    fromCamera: "Camera",
    fromText: "Text",
    unread: (from: number, to: number) => `Pages ${from} to ${to} were not read; at most 50 pages of a PDF file are read.`,
    others: (n: number) =>
      n === 1
        ? "1 other QR code was found that is not a DKDS stamp; its content is not shown."
        : `${n} other QR codes were found that are not DKDS stamps; their content is not shown.`,
    page: (pages: readonly number[]) => (pages.length === 1 ? `Page ${pages[0]}` : `Pages ${list(L, pages.map(String))}`),
    labels: { domain: "Domain", signed: "Signed", dns: "DNS", warnings: "Warnings" },
    /** The note below the time of signing, which the signer chooses (specification 9.1). */
    stated: "As stated by the issuer",
    dnssec: (validated: boolean): string => (validated ? "Answer validated with DNSSEC" : "Answer not validated with DNSSEC"),
    /** The heading of the fields, followed by the domain. */
    contentsBy: "Contents of the stamp, signed by",
    /** The sentence below the fields: the comparison that the verifier does not make. */
    compare: "Compare the fields with the document. A difference shows that one of them was altered.",
    /** The column headings of the fields, and the summary that shows the text form of the stamp. */
    fieldName: "Field",
    fieldValue: "Value",
    raw: "Raw text",
    copy: "Copy stamp text",
    copied: "Copied",
    emptyValue: "empty",
    offline: "This device is offline.",
    whitespace: "The text begins or ends with a space or a line break, which is not part of a stamp.",
    details: "Technical details",
    step: (step: number) => `Determined at step ${step} of the procedure in section 8.2 of the specification.`,
    again: "Verify again",
    next: "Verify another stamp",
  },

  problem: {
    back: "Back",
    retryCamera: "Open camera",
    openFile: "Open file",
    pasteText: "Paste text",
    cameraDenied: {
      title: "Camera access denied",
      body:
        "The browser has not allowed this page to use the camera. Access can be granted in the browser's settings for scan.dkds.org, after which the camera can be opened again. A photo of the stamp can also be opened as a file.",
      ios: "On iPhone and iPad, camera access for websites is set under Settings, Apps, Safari, Camera.",
      android: "In Chrome, camera access is set under the icon to the left of the address, then Permissions.",
    },
    cameraMissing: {
      title: "No camera found",
      body: "This device has no camera that the browser can use. A photo or scan of the document can be opened as a file instead.",
    },
    cameraBusy: {
      title: "Camera unavailable",
      body: "The camera could not be started. Another application may be using it; it becomes available when that application releases it.",
    },
    cameraUnsupported: {
      title: "Camera not supported",
      body: "This browser does not give web pages access to the camera. A photo of the stamp can be opened as a file instead.",
    },
    cameraInsecure: {
      title: "Camera not available on this connection",
      body: "Browsers allow the camera only on pages loaded over HTTPS. The verifier is served at https://scan.dkds.org.",
    },
    cameraStopped: {
      title: "Camera stopped",
      body: "The camera stopped sending images, for example because it was disconnected or claimed by another application.",
    },
    fileType: {
      title: "File type not supported",
      body: (name: string) =>
        `${name} is neither an image nor a PDF file. The verifier reads PNG, JPEG and WebP images, HEIC images where the browser supports them, and PDF files.`,
    },
    fileTooLarge: {
      title: "File too large",
      body: (name: string) => `${name} is larger than 100 MB, the largest file the verifier reads.`,
    },
    fileEmpty: {
      title: "Empty file",
      body: (name: string) => `${name} contains no data.`,
    },
    imageUnreadable: {
      title: "Image could not be opened",
      body: (name: string) =>
        `This browser cannot decode ${name}. The file may be damaged, or in a format the browser does not support, such as HEIC outside Safari. A screenshot or a JPEG copy of the image can be opened instead.`,
    },
    pdfUnreadable: {
      title: "PDF file could not be read",
      body: (name: string) => `${name} is damaged or is not a PDF file.`,
    },
    pdfUnavailable: {
      title: "PDF reader unavailable",
      body: "The PDF reader could not be loaded. It is loaded when the first PDF file is opened, which requires a network connection. A screenshot of the page with the stamp can be opened as an image instead.",
    },
    pdfPassword: {
      title: "Password required",
      body: (name: string) => `${name} is protected with a password. The password is used on this device only.`,
      label: "Password",
      submit: "Open PDF file",
      incorrect: "The password is incorrect.",
    },
    noCode: {
      title: "No QR code found",
      image: (name: string) =>
        `No QR code was found in ${name}. A stamp is read most reliably from a sharp, evenly lit image in which the stamp is large and seen straight on.`,
      pdf: (name: string, pages: number) =>
        `No QR code was found on ${pages === 1 ? "the page" : `the ${pages} pages`} of ${name} that were read.`,
    },
    notStamp: {
      title: "Not a DKDS stamp",
      body: (n: number) =>
        n === 1
          ? "The QR code that was found is not a DKDS stamp. Its content is not shown, because the verifier displays only stamps."
          : `The ${n} QR codes that were found are not DKDS stamps. Their content is not shown, because the verifier displays only stamps.`,
    },
    readerFailed: {
      title: "QR reader unavailable",
      body: "The QR reader could not be started in this browser. The text of a stamp can still be pasted and verified.",
    },
    browser: {
      title: "Browser not supported",
      body: "This browser lacks functions that the verifier requires. It runs in current versions of Safari, Chrome, Edge and Firefox.",
    },
    unexpected: {
      title: "Unexpected error",
      body: (message: string) => `The verifier stopped because of an error: ${message}`,
    },
    multipleFiles: "Only the first of the files was read.",
  },
};

/** The shape of the texts of one language. */
export type Texts = typeof en;
