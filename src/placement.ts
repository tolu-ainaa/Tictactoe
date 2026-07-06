import {
  createSystem,
  Entity,
  EnvironmentRaycastTarget,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RaycastSpace,
  RingGeometry,
  Vector3,
  Visibility,
} from "@iwsdk/core";

import { createBoard, disposeBoard } from "./board.js";
import { GameLogicSystem } from "./game.js";
import { getGlobals } from "./globals.js";

export class PlacementSystem extends createSystem({}) {
  private reticle!: Entity;
  private tempPosition!: Vector3;
  private tempQuaternion!: Quaternion;

  init() {
    this.tempPosition = new Vector3();
    this.tempQuaternion = new Quaternion();

    const ringMesh = new Mesh(
      new RingGeometry(0.12, 0.15, 32),
      new MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9 }),
    );
    ringMesh.rotateX(-Math.PI / 2);

    this.reticle = this.world
      .createTransformEntity(ringMesh)
      .addComponent(EnvironmentRaycastTarget, { space: RaycastSpace.Viewer })
      .addComponent(Visibility);

    const globals = getGlobals(this.world);
    this.cleanupFuncs.push(
      globals.gamePhase.subscribe((phase) => {
        this.reticle.setValue(Visibility, "isVisible", phase === "placement");
      }),
    );
  }

  update() {
    const globals = getGlobals(this.world);
    if (globals.gamePhase.peek() !== "placement") {
      return;
    }

    const hit = this.reticle.getValue(EnvironmentRaycastTarget, "xrHitTestResult");
    const selecting =
      this.input.xr.gamepads.left?.getSelectStart() ||
      this.input.xr.gamepads.right?.getSelectStart();
    if (!hit || !selecting) {
      return;
    }

    this.reticle.object3D!.getWorldPosition(this.tempPosition);
    this.reticle.object3D!.getWorldQuaternion(this.tempQuaternion);

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
}
