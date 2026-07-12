import {
  createSystem,
  Entity,
  EnvironmentRaycastTarget,
  Group,
  Hovered,
  PanelUI,
  Quaternion,
  RaycastSpace,
  Vector3,
} from "@iwsdk/core";

import { createBoard, createBoardGhost, disposeBoard } from "./board.js";
import { GameLogicSystem } from "./game.js";
import { getGlobals } from "./globals.js";

export class PlacementSystem extends createSystem({
  hoveredPanels: { required: [PanelUI, Hovered] },
}) {
  private reticle!: Entity;
  private ghost!: Group;
  private tempPosition!: Vector3;
  private tempQuaternion!: Quaternion;

  init() {
    this.tempPosition = new Vector3();
    this.tempQuaternion = new Quaternion();

    // EnvironmentRaycastSystem drives the root's full transform (position + surface-normal
    // alignment, yaw-less) and its `visible` flag (hidden while no surface is hit). All
    // visuals therefore live in a child group, which we yaw toward the player each frame
    // without fighting the system.
    const anchor = new Group();
    this.ghost = createBoardGhost();
    anchor.add(this.ghost);

    this.reticle = this.world.createTransformEntity(anchor);
    anchor.visible = false; // hidden until the first surface hit

    const globals = getGlobals(this.world);
    this.cleanupFuncs.push(
      globals.gamePhase.subscribe((phase) => {
        this.setPlacementActive(phase === "placement");
      }),
    );
  }

  update(_delta: number, time: number) {
    const globals = getGlobals(this.world);
    if (globals.gamePhase.peek() !== "placement") {
      return;
    }

    const hit = this.reticle.getValue(EnvironmentRaycastTarget, "xrHitTestResult");
    if (!hit) {
      return;
    }

    // Yaw the preview toward the player so the board always reads the same way,
    // instead of inheriting the hit test's arbitrary orientation.
    this.player.head.getWorldPosition(this.tempPosition);
    this.reticle.object3D!.worldToLocal(this.tempPosition);
    this.ghost.rotation.y = Math.atan2(this.tempPosition.x, this.tempPosition.z);

    // Gentle breathing pulse: reads as "preview, not placed yet".
    this.ghost.scale.setScalar(1 + 0.02 * Math.sin(time * 4));

    const selecting =
      this.input.xr.gamepads.left?.getSelectStart() ||
      this.input.xr.gamepads.right?.getSelectStart();
    // A pinch aimed at the UI panel is a button press, not a placement.
    if (!selecting || this.queries.hoveredPanels.entities.size > 0) {
      return;
    }

    this.confirmPlacement();
  }

  /**
   * Places the board at the ghost preview's current transform. Called from the
   * controller/hand select path in update(), and by ScreenInputSystem for phone
   * AR screen taps. No-op unless we're in placement phase with a surface hit.
   */
  confirmPlacement() {
    const globals = getGlobals(this.world);
    if (globals.gamePhase.peek() !== "placement") {
      return;
    }
    if (!this.reticle.getValue(EnvironmentRaycastTarget, "xrHitTestResult")) {
      return;
    }

    this.ghost.getWorldPosition(this.tempPosition);
    this.ghost.getWorldQuaternion(this.tempQuaternion);

    const { root, cells } = createBoard(this.world, this.tempPosition, this.tempQuaternion);
    globals.boardRoot.value = root;
    globals.boardCells.value = cells;
    this.world.getSystem(GameLogicSystem)?.beginRound();
  }

  /** Tears down the current board (if any) and re-enters placement mode. */
  requestPlacement() {
    const globals = getGlobals(this.world);
    const root = globals.boardRoot.peek();
    const cells = globals.boardCells.peek();
    if (root) {
      disposeBoard(root, cells);
    }
    globals.boardRoot.value = null;
    globals.boardCells.value = [];
    globals.gamePhase.value = "placement";
  }

  /**
   * Attaches/detaches the hit-test target with the placement phase. Removing the
   * component cancels the XR hit-test source and hides the preview; the raycast
   * system shows it again on the first hit after re-adding.
   */
  private setPlacementActive(active: boolean) {
    if (active && !this.reticle.hasComponent(EnvironmentRaycastTarget)) {
      this.reticle.addComponent(EnvironmentRaycastTarget, {
        space: RaycastSpace.Viewer,
      });
      this.reticle.object3D!.visible = false;
    } else if (!active && this.reticle.hasComponent(EnvironmentRaycastTarget)) {
      this.reticle.removeComponent(EnvironmentRaycastTarget);
    }
  }
}
