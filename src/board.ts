import {
  BoxGeometry,
  createComponent,
  DoubleSide,
  Entity,
  Group,
  Interactable,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  TorusGeometry,
  Types,
  Vector3,
  World,
} from "@iwsdk/core";

export const BoardCell = createComponent("BoardCell", {
  index: { type: Types.Int32, default: 0 },
  owner: {
    type: Types.Enum,
    enum: { None: "none", Player: "player", AI: "ai" },
    default: "none",
  },
});

export const BoardRoot = createComponent("BoardRoot", {}, "");

const CELL_SPACING = 0.11;
const CELL_SIZE = 0.1;
const BOARD_SIZE = 0.34;

/** Builds an X or O mark mesh, laid flat on the cell surface. */
export function createMark(symbol: "X" | "O"): Group {
  const group = new Group();
  if (symbol === "X") {
    const material = new MeshStandardMaterial({ color: 0xef4444 });
    const bar = new BoxGeometry(0.075, 0.008, 0.016);
    const barA = new Mesh(bar, material);
    barA.rotateY(Math.PI / 4);
    const barB = new Mesh(bar, material);
    barB.rotateY(-Math.PI / 4);
    group.add(barA, barB);
  } else {
    const material = new MeshStandardMaterial({ color: 0x3b82f6 });
    const ring = new Mesh(new TorusGeometry(0.032, 0.008, 8, 24), material);
    ring.rotateX(Math.PI / 2);
    group.add(ring);
  }
  group.position.y = 0.012;
  return group;
}

/** Attaches a mark as a plain Three.js child of the cell's own Object3D (no extra entity needed). */
export function attachMark(cell: Entity, symbol: "X" | "O") {
  cell.object3D!.add(createMark(symbol));
}

/**
 * Translucent full-size preview of the board (plate + tiles + target ring) shown
 * while placing. Shows the exact footprint and orientation before confirming.
 */
export function createBoardGhost(): Group {
  const group = new Group();

  const plateMaterial = new MeshBasicMaterial({
    color: 0x22d3ee,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const tileMaterial = new MeshBasicMaterial({
    color: 0x22d3ee,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });

  const plate = new Mesh(new BoxGeometry(BOARD_SIZE, 0.01, BOARD_SIZE), plateMaterial);
  group.add(plate);

  const tileGeometry = new BoxGeometry(CELL_SIZE, 0.006, CELL_SIZE);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const tile = new Mesh(tileGeometry, tileMaterial);
      tile.position.set((col - 1) * CELL_SPACING, 0.008, (row - 1) * CELL_SPACING);
      group.add(tile);
    }
  }

  const ring = new Mesh(
    new RingGeometry(BOARD_SIZE * 0.72, BOARD_SIZE * 0.78, 48),
    new MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  ring.rotateX(-Math.PI / 2);
  ring.position.y = 0.002;
  group.add(ring);

  return group;
}

/** Creates the board plate + 9 interactable cell entities at the given world transform. */
export function createBoard(
  world: World,
  position: Vector3,
  quaternion: Quaternion,
): { root: Entity; cells: Entity[] } {
  const plateMaterial = new MeshStandardMaterial({ color: 0x1c1c22 });
  const cellMaterial = new MeshStandardMaterial({ color: 0x3a3a45 });

  const plate = new Mesh(new BoxGeometry(BOARD_SIZE, 0.01, BOARD_SIZE), plateMaterial);
  const root = world.createTransformEntity(plate);
  root.object3D!.position.copy(position);
  root.object3D!.quaternion.copy(quaternion);
  root.addComponent(BoardRoot);

  const cells: Entity[] = [];
  let index = 0;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const tile = new Mesh(new BoxGeometry(CELL_SIZE, 0.006, CELL_SIZE), cellMaterial);
      const cell = world.createTransformEntity(tile, { parent: root });
      cell.object3D!.position.set(
        (col - 1) * CELL_SPACING,
        0.008,
        (row - 1) * CELL_SPACING,
      );
      cell.addComponent(Interactable).addComponent(BoardCell, { index });
      cells.push(cell);
      index++;
    }
  }

  return { root, cells };
}

/** Frees GPU resources for the whole board (one traversal from the root) and releases all entities. */
export function disposeBoard(root: Entity, cells: Entity[]) {
  root.dispose();
  for (const cell of cells) {
    cell.destroy();
  }
}
