/**
 * The camera: the rear camera where there is one, read continuously until a stamp is found.
 */

import type { Decoder } from "./decoder.ts";
import { canvas2d, release } from "./image.ts";
import { Problem } from "./problem.ts";

/** The longest side of a frame passed to the decoder. */
const MAX_FRAME_SIDE = 1920;
/** The shortest interval between two decoded frames, in milliseconds. */
const FRAME_INTERVAL = 120;

/** Maps an error of getUserMedia to the problem shown to the reader. */
function cameraProblem(error: unknown): Problem {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return new Problem("camera-denied");
    case "NotFoundError":
    case "OverconstrainedError":
    case "DevicesNotFoundError":
      return new Problem("camera-missing");
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return new Problem("camera-busy");
    default:
      return new Problem("unexpected", { message: error instanceof Error ? error.message : String(error) });
  }
}

/** Callbacks of a running scanner. */
export interface ScannerEvents {
  /** Stamps were found in a frame; scanning has stopped. */
  onStamps(texts: readonly string[]): void;
  /** A QR code that is not a stamp is in view. */
  onOther(): void;
  /** The camera or the decoder failed; scanning has stopped. */
  onProblem(problem: Problem): void;
}

/** A running camera. */
export interface Scanner {
  /** Whether the camera has a torch that can be switched. */
  readonly hasTorch: boolean;
  /** Whether the device has more than one camera. */
  readonly canSwitch: boolean;
  setTorch(on: boolean): Promise<void>;
  /**
   * Changes to the camera facing the other way. Where the browser does not report the direction, as
   * on most computers, changes to the next camera in the browser's list.
   */
  switchCamera(): Promise<void>;
  stop(): void;
}

/** Throws a {@link Problem} when the browser offers no camera access. */
function assertCameraApi(): void {
  if (!window.isSecureContext) throw new Problem("camera-insecure");
  if (!navigator.mediaDevices?.getUserMedia) throw new Problem("camera-unsupported");
}

/** The camera to open: a device, a direction that is required, or by default the rear camera where there is one. */
type CameraChoice = { readonly deviceId: string } | { readonly facing: "user" | "environment" } | Record<string, never>;

async function openStream(choice: CameraChoice = {}): Promise<MediaStream> {
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  const video: MediaTrackConstraints =
    "deviceId" in choice
      ? { deviceId: { exact: choice.deviceId }, ...size }
      : { facingMode: "facing" in choice ? { exact: choice.facing } : { ideal: "environment" }, ...size };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (e) {
    throw cameraProblem(e);
  }
}

/** Resolves at the next video frame, or after one animation frame where frame callbacks are absent. */
function nextFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(() => resolve());
    else requestAnimationFrame(() => resolve());
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts the camera in `video` and scans its frames. Throws a {@link Problem} when the camera cannot
 * be started.
 */
export async function startScanner(video: HTMLVideoElement, decoder: Decoder, events: ScannerEvents): Promise<Scanner> {
  assertCameraApi();
  let stream = await openStream();
  let active = true;
  let torch = false;

  const track = () => stream.getVideoTracks()[0];
  const capabilities = () => (track()?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };

  const attach = async () => {
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    track()?.addEventListener("ended", () => {
      if (!active) return;
      stop();
      events.onProblem(new Problem("camera-stopped"));
    });
    try {
      await video.play();
    } catch {
      // Autoplay of a muted video is permitted; a rejection here is followed by frames once the user interacts.
    }
  };

  const stop = () => {
    active = false;
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
  };

  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  const cameras = devices.filter((d) => d.kind === "videoinput");
  await attach();

  const loop = async () => {
    let last = 0;
    let frame: { canvas: HTMLCanvasElement | OffscreenCanvas; context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | undefined;
    try {
      while (active) {
        await nextFrame(video);
        const wait = last + FRAME_INTERVAL - performance.now();
        if (wait > 0) await sleep(wait);
        if (!active) break;
        if (video.readyState < 2 || video.videoWidth === 0) continue;
        last = performance.now();
        const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
        const width = Math.round(video.videoWidth * scale);
        const height = Math.round(video.videoHeight * scale);
        if (!frame || frame.canvas.width !== width || frame.canvas.height !== height) {
          if (frame) release(frame.canvas);
          frame = canvas2d(width, height);
        }
        frame.context.drawImage(video, 0, 0, width, height);
        const result = await decoder.decode(frame.context.getImageData(0, 0, width, height), "camera");
        if (!active) break;
        if (result.stamps.length > 0) {
          stop();
          events.onStamps(result.stamps);
          break;
        }
        if (result.others > 0) events.onOther();
      }
    } catch (e) {
      if (!active) return;
      stop();
      events.onProblem(e instanceof Problem ? e : new Problem("reader-failed"));
    } finally {
      if (frame) release(frame.canvas);
    }
  };
  void loop();

  return {
    get hasTorch() {
      return capabilities().torch === true;
    },
    canSwitch: cameras.length > 1,
    async setTorch(on) {
      torch = on;
      await track()?.applyConstraints({ advanced: [{ torch } as MediaTrackConstraintSet] });
    },
    async switchCamera() {
      const settings = track()?.getSettings() ?? {};
      const index = cameras.findIndex((c) => c.deviceId === settings.deviceId);
      const nextId = cameras[(index + 1) % Math.max(1, cameras.length)]?.deviceId;
      const next: CameraChoice = nextId ? { deviceId: nextId } : {};
      const facing = settings.facingMode === "user" ? "environment" : settings.facingMode === "environment" ? "user" : undefined;
      // A phone opens one camera at a time.
      for (const t of stream.getTracks()) t.stop();
      stream = facing ? await openStream({ facing }).catch(() => openStream(next)) : await openStream(next);
      torch = false;
      await attach();
    },
    stop,
  };
}
