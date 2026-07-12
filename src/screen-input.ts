import {
  createSystem,
  Entity,
  Quaternion,
  Raycaster,
  Vector3,
} from "@iwsdk/core";

import { GameLogicSystem } from "./game.js";
import { getGlobals } from "./globals.js";
import { PlacementSystem } from "./placement.js";

/**
 * Phone AR input. On handheld AR (Android Chrome), screen taps arrive as
 * transient XR input sources with `targetRayMode: "screen"` — the SDK's
 * gamepad/Interactable pipeline only tracks left/right sources, so taps never
 * produce Hovered/Pressed. This system listens to session `select` events and
 * routes taps by game phase:
 *
 * - placement  → confirm the ghost preview (PlacementSystem)
 * - player-turn → raycast the tap against board cells and play the move
 * - game-over  → tap the board to start a new round
 *
 * Headset input is untouched: controller/hand selects have a left/right
 * targetRayMode and are ignored here.
 */
export class ScreenInputSystem extends createSystem({}) {
  // Manual Raycaster is justified here: Interactable's BVH raycasting only
  // serves canvas pointers and left/right XR rays, not transient screen taps.
  private raycaster!: Raycaster;
  private tempOrigin!: Vector3;
  private tempDirection!: Vector3;
  private tempQuaternion!: Quaternion;

  init() {
    this.raycaster = new Raycaster();
    this.tempOrigin = new Vector3();
    this.tempDirection = new Vector3();
    this.tempQuaternion = new Quaternion();

    const onSessionStart = () => {
      const session = this.xrManager.getSession();
      if (!session) {
        return;
      }
      const onSelect = (event: XRInputSourceEvent) => this.handleSelect(event);
      session.addEventListener("select", onSelect);
      session.addEventListener(
        "end",
        () => session.removeEventListener("select", onSelect),
        { once: true },
      );
    };
    this.xrManager.addEventListener("sessionstart", onSessionStart);
    this.cleanupFuncs.push(() =>
      this.xrManager.removeEventListener("sessionstart", onSessionStart),
    );
  }

  private handleSelect(event: XRInputSourceEvent) {
    if (event.inputSource.targetRayMode !== "screen") {
      return;
    }

    const globals = getGlobals(this.world);
    const phase = globals.gamePhase.peek();

    if (phase === "placement") {
      this.world.getSystem(PlacementSystem)?.confirmPlacement();
      return;
    }
    if (phase !== "player-turn" && phase !== "game-over") {
      return;
    }

    const referenceSpace = this.xrManager.getReferenceSpace();
    if (!referenceSpace) {
      return;
    }
    const pose = event.frame.getPose(event.inputSource.targetRaySpace, referenceSpace);
    if (!pose) {
      return;
    }

    // Pose is in reference-space coordinates, i.e. local to the player rig.
    const { position, orientation } = pose.transform;
    this.tempOrigin.set(position.x, position.y, position.z);
    this.player.localToWorld(this.tempOrigin);
    this.tempQuaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
    this.tempDirection.set(0, 0, -1).applyQuaternion(this.tempQuaternion);
    this.player.getWorldQuaternion(this.tempQuaternion);
    this.tempDirection.applyQuaternion(this.tempQuaternion).normalize();
    this.raycaster.set(this.tempOrigin, this.tempDirection);

    if (phase === "player-turn") {
      const cell = this.findTappedCell(globals.boardCells.peek());
      if (cell) {
        this.world.getSystem(GameLogicSystem)?.tryPlayerMove(cell);
      }
      return;
    }

    // game-over: tapping anywhere on the board starts the next round.
    const root = globals.boardRoot.peek();
    if (root && this.raycaster.intersectObject(root.object3D!, true).length > 0) {
      this.world.getSystem(GameLogicSystem)?.resetGame();
    }
  }

  private findTappedCell(cells: Entity[]): Entity | null {
    let closest: Entity | null = null;
    let closestDistance = Infinity;
    for (const cell of cells) {
      const hits = this.raycaster.intersectObject(cell.object3D!, true);
      if (hits.length > 0 && hits[0].distance < closestDistance) {
        closestDistance = hits[0].distance;
        closest = cell;
      }
    }
    return closest;
  }
}
