import {
  AssetManifest,
  AssetManager,
  AssetType,
  AudioSource,
  Interactable,
  PanelUI,
  PlaybackMode,
  ScreenSpace,
  SessionMode,
  World,
} from "@iwsdk/core";

import { signal } from "@preact/signals-core";

import { GameLogicSystem } from "./game.js";
import { GamePanelSystem } from "./game-panel.js";
import { getGlobals } from "./globals.js";
import { PlacementSystem } from "./placement.js";
import { Robot, RobotSystem } from "./robot.js";
import { ScoreSystem } from "./score.js";

const assets: AssetManifest = {
  chimeSound: {
    url: "/audio/chime.mp3",
    type: AssetType.Audio,
    priority: "background",
  },
  robot: {
    url: "./gltf/robot/robot.gltf",
    type: AssetType.GLTF,
    priority: "critical",
  },
};

World.create(document.getElementById("scene-container") as HTMLDivElement, {
  assets,
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: "always",
    features: {
      handTracking: { required: true },
      anchors: { required: true },
      hitTest: true,
      planeDetection: true,
      meshDetection: true,
      layers: true,
    },
  },
  features: {
    locomotion: false,
    grabbing: false,
    physics: false,
    sceneUnderstanding: true,
    environmentRaycast: true,
  },
}).then((world) => {
  const { camera } = world;

  camera.position.set(0, 1, 0.5);

  const globals = getGlobals(world);
  globals.gamePhase = signal("placement");
  globals.lastWinner = signal(null);
  globals.gameOverSeq = signal(0);
  globals.boardRoot = signal(null);
  globals.boardCells = signal([]);
  globals.aiLookTarget = signal(null);
  globals.currentStreak = signal(0);
  globals.highScore = signal(0);
  globals.leaderboard = signal([]);
  globals.difficulty = signal("medium");
  globals.playerSymbol = signal("X");
  globals.activePlayerSymbol = signal("X");
  globals.nextStarter = signal("player");

  const { scene: robotMesh } = AssetManager.getGLTF("robot")!;
  robotMesh.position.set(-0.5, 0.15, -0.8);
  robotMesh.scale.setScalar(0.5);

  world
    .createTransformEntity(robotMesh)
    .addComponent(Interactable)
    .addComponent(Robot)
    .addComponent(AudioSource, {
      src: "./audio/chime.mp3",
      maxInstances: 3,
      playbackMode: PlaybackMode.FadeRestart,
    });

  const panelEntity = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: "./ui/game.json",
      maxHeight: 1.4,
      maxWidth: 1.6,
    })
    .addComponent(Interactable)
    .addComponent(ScreenSpace, {
      top: "20px",
      left: "20px",
      height: "85%",
    });
  panelEntity.object3D!.position.set(0, 1.29, -1.9);

  world
    .registerSystem(PlacementSystem, { priority: 0 })
    .registerSystem(GameLogicSystem, { priority: 1 })
    .registerSystem(ScoreSystem, { priority: 2 })
    .registerSystem(RobotSystem, { priority: 10 })
    .registerSystem(GamePanelSystem, { priority: 40 });
});
