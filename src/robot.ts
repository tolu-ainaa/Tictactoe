import {
  AudioUtils,
  createComponent,
  createSystem,
  Pressed,
  Vector3,
} from "@iwsdk/core";

import { getGlobals } from "./globals.js";

export const Robot = createComponent("Robot", {});

/** How long the robot keeps looking at its last move before returning to the player. */
const AI_LOOK_DURATION = 1.5;

export class RobotSystem extends createSystem({
  robot: { required: [Robot] },
  robotClicked: { required: [Robot, Pressed] },
}) {
  private lookAtTarget!: Vector3;
  private vec3!: Vector3;
  private aiLookTimer = 0;

  init() {
    this.lookAtTarget = new Vector3();
    this.vec3 = new Vector3();
    this.queries.robotClicked.subscribe("qualify", (entity) => {
      AudioUtils.play(entity);
    });

    this.cleanupFuncs.push(
      getGlobals(this.world).aiLookTarget.subscribe((target) => {
        if (target) {
          this.aiLookTimer = AI_LOOK_DURATION;
        }
      }),
    );
  }

  update(delta: number) {
    const globals = getGlobals(this.world);
    if (this.aiLookTimer > 0) {
      this.aiLookTimer -= delta;
      if (this.aiLookTimer <= 0) {
        globals.aiLookTarget.value = null;
      }
    }

    const aiTarget = globals.aiLookTarget.peek();

    this.queries.robot.entities.forEach((entity) => {
      const spinnerObject = entity.object3D!;
      spinnerObject.getWorldPosition(this.vec3);

      if (aiTarget?.object3D) {
        aiTarget.object3D.getWorldPosition(this.lookAtTarget);
      } else {
        this.player.head.getWorldPosition(this.lookAtTarget);
      }
      this.lookAtTarget.y = this.vec3.y;
      spinnerObject.lookAt(this.lookAtTarget);
    });
  }
}
