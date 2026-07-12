/**
 * Platform detection and iOS WebXR bootstrapping.
 *
 * iOS Safari (and every iOS browser — they're all WebKit) has no WebXR AR
 * support. The Variant Launch SDK bridges that gap: on iOS it hands the page
 * off to an App Clip viewer that provides a WebXR polyfill backed by ARKit
 * (camera tracking, hit-test, anchors). On platforms with native WebXR the
 * SDK is never loaded.
 *
 * Setup: create a project at https://launch.variant3d.com, then set
 * `VITE_VARIANT_LAUNCH_KEY` (e.g. in `.env.local`, or in Vercel's project
 * environment variables). Without a key, iOS visitors simply stay in the 2D
 * browser view.
 */

/** iPhone/iPad detection. Modern iPadOS reports as Mac, hence the touch probe. */
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) {
    return true;
  }
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export async function supportsImmersiveAR(): Promise<boolean> {
  if (!navigator.xr?.isSessionSupported) {
    return false;
  }
  try {
    return await navigator.xr.isSessionSupported("immersive-ar");
  } catch {
    return false;
  }
}

/**
 * Loads the Variant Launch SDK when we're on iOS without native WebXR and a
 * key is configured. Must complete before `World.create()` so the polyfill
 * (or the redirect into the Launch viewer) is in place before the engine
 * queries `navigator.xr`. Resolves either way — the app always continues
 * into the 2D fallback if AR isn't available.
 */
/**
 * iOS Safari tap reliability for the canvas-forwarded pointer pipeline.
 *
 * Two WebKit hazards, both harmless elsewhere:
 * 1. Canvas pointer events are processed in batches on the next frame. For a
 *    quick tap the touch may already be gone by then, and WebKit throws
 *    NotFoundError from setPointerCapture — which can take down the whole
 *    forwarding pipeline. We make capture calls non-fatal.
 * 2. Safari sometimes swallows pointer events entirely (gesture recognition).
 *    Touch events still fire, so when a tap produces no pointerup we replay
 *    it as synthetic pointerdown/pointerup through the same pipeline.
 */
export function installIOSTapFallback(canvas: HTMLCanvasElement): void {
  if (!isIOS()) {
    return;
  }

  const originalSet = canvas.setPointerCapture.bind(canvas);
  const originalRelease = canvas.releasePointerCapture.bind(canvas);
  canvas.setPointerCapture = (pointerId: number) => {
    try {
      originalSet(pointerId);
    } catch {
      /* pointer already gone — capture is best-effort */
    }
  };
  canvas.releasePointerCapture = (pointerId: number) => {
    try {
      originalRelease(pointerId);
    } catch {
      /* ignore */
    }
  };

  let sawPointerUp = false;
  let sawPointerCancel = false;
  canvas.addEventListener("pointerup", () => {
    sawPointerUp = true;
  });
  canvas.addEventListener("pointercancel", () => {
    sawPointerCancel = true;
  });
  canvas.addEventListener(
    "touchstart",
    () => {
      sawPointerUp = false;
      sawPointerCancel = false;
    },
    { passive: true },
  );
  canvas.addEventListener(
    "touchend",
    (event) => {
      if (sawPointerUp && !sawPointerCancel) {
        return; // native pointer path delivered the tap
      }
      const touch = event.changedTouches[0];
      if (!touch) {
        return;
      }
      const init: PointerEventInit = {
        clientX: touch.clientX,
        clientY: touch.clientY,
        pointerId: 9999,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: 1,
        bubbles: true,
        cancelable: true,
      };
      canvas.dispatchEvent(new PointerEvent("pointerdown", init));
      canvas.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
    },
    { passive: true },
  );
}

// Client-side key (ships in the bundle by design; Variant scopes it to the
// domains registered in the Launch admin). VITE_VARIANT_LAUNCH_KEY overrides.
const DEFAULT_VARIANT_LAUNCH_KEY = "rKkoCAdleySa9U84SoC2979uY1K10ltb";

export async function setupIOSXRSupport(): Promise<void> {
  const key =
    (import.meta.env.VITE_VARIANT_LAUNCH_KEY as string | undefined) ||
    DEFAULT_VARIANT_LAUNCH_KEY;
  if (!key || !isIOS() || (await supportsImmersiveAR())) {
    return;
  }

  await new Promise<void>((resolve) => {
    const script = document.createElement("script");
    // redirect=true: iOS visitors are bounced into the Launch App Clip viewer,
    // which reloads this same URL with WebXR available.
    script.src = `https://launchar.app/sdk/v1?key=${encodeURIComponent(key)}&redirect=true`;
    script.onload = () => resolve();
    script.onerror = () => {
      console.warn("[platform] Variant Launch SDK failed to load; continuing without iOS AR.");
      resolve();
    };
    document.head.appendChild(script);
  });
}
