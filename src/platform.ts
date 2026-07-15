import type { World } from "@iwsdk/core";

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
// The exact feature set Variant's Launch viewer documents for its polyfill.
// Anything else (local-floor, layers, plane-detection...) is IWSDK's default
// request shape, which the viewer starts a session for but WITHOUT hit-test —
// leaving placement silently dead.
const VARIANT_SESSION_FEATURES = ["local", "anchors", "dom-overlay", "hit-test"];

/**
 * Starts an immersive-ar session tailored to the Variant Launch viewer and
 * hands it to the IWSDK renderer (mirroring what `world.launchXR()` does after
 * `requestSession`). Returns false if the session couldn't start, so callers
 * can fall back to the standard launch path.
 */
export async function launchVariantAR(world: World): Promise<boolean> {
  if (!navigator.xr?.requestSession) {
    return false;
  }
  try {
    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: VARIANT_SESSION_FEATURES,
      domOverlay: { root: document.body },
    } as XRSessionInit);

    // IWSDK's EnvironmentRaycastSystem checks session.enabledFeatures for
    // 'hit-test' and disables itself when absent — polyfills often omit it.
    if (!session.enabledFeatures) {
      try {
        Object.defineProperty(session, "enabledFeatures", {
          value: VARIANT_SESSION_FEATURES,
          configurable: true,
        });
      } catch {
        /* best effort */
      }
    }

    // IWSDK only hides the sky dome when environmentBlendMode reports an AR
    // mode; if the polyfill reports 'opaque' (or omits it), the sky is drawn
    // over the camera feed and the user sees sky instead of passthrough.
    const blendMode = session.environmentBlendMode as string | undefined;
    if (!blendMode || blendMode === "opaque") {
      try {
        Object.defineProperty(session, "environmentBlendMode", {
          value: "alpha-blend",
          configurable: true,
        });
      } catch {
        /* best effort */
      }
    }

    const xrManager = world.renderer.xr as unknown as {
      getDepthSensingMesh: () => unknown;
      setReferenceSpaceType: (type: XRReferenceSpaceType) => void;
      setSession: (session: XRSession) => Promise<void>;
    };
    xrManager.getDepthSensingMesh = () => null;
    xrManager.setReferenceSpaceType("local"); // the viewer only supports 'local'
    await xrManager.setSession(session);
    world.session = session;

    const onEnd = () => {
      session.removeEventListener("end", onEnd);
      world.session = undefined;
    };
    session.addEventListener("end", onEnd);
    return true;
  } catch (error) {
    console.warn("[platform] Variant Launch AR session failed:", error);
    return false;
  }
}

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
  if (!isIOS()) {
    return;
  }

  // Surface ARKit tracking state in the ?debug overlay (fires inside the
  // Launch viewer; harmless elsewhere).
  document.addEventListener("vlaunch-ar-tracking", (event) => {
    const detail = (event as CustomEvent).detail;
    (window as { __vlTracking?: string }).__vlTracking =
      typeof detail === "string" ? detail : JSON.stringify(detail);
  });

  if (!key || (await supportsImmersiveAR())) {
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
