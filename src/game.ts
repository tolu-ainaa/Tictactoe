import {
  AudioUtils,
  createSystem,
  eq,
  Entity,
  Pressed,
  Quaternion,
  Vector3,
} from "@iwsdk/core";

import { checkResult, getMove } from "./ai.js";
import type { Owner } from "./ai.js";
import { attachMark, BoardCell, createBoard, disposeBoard } from "./board.js";
import { getGlobals } from "./globals.js";
import type { Symbol } from "./globals.js";
import { Robot } from "./robot.js";

function oppositeSymbol(symbol: Symbol): Symbol {
  return symbol === "X" ? "O" : "X";
}

const AI_THINK_DELAY = 0.6;

export class GameLogicSystem extends createSystem({
  cells: { required: [BoardCell] },
  pressedEmpty: {
    required: [BoardCell, Pressed],
    where: [eq(BoardCell, "owner", "none")],
  },
  robot: { required: [Robot] },
}) {
  private aiThinkTimer = 0;

  init() {
    this.queries.pressedEmpty.subscribe("qualify", (entity) => {
      this.handlePlayerMove(entity);
    });
  }

  update(delta: number) {
    const globals = getGlobals(this.world);
    if (globals.gamePhase.peek() !== "ai-thinking") {
      return;
    }
    this.aiThinkTimer -= delta;
    if (this.aiThinkTimer > 0) {
      return;
    }
    this.playAiMove();
  }

  /** Called by the panel's "Play Again" button. Clears the board at the same placed transform. */
  resetGame() {
    const globals = getGlobals(this.world);
    const root = globals.boardRoot.peek();
    const cells = globals.boardCells.peek();
    if (!root) {
      return;
    }

    const position = new Vector3();
    const quaternion = new Quaternion();
    root.object3D!.getWorldPosition(position);
    root.object3D!.getWorldQuaternion(quaternion);

    disposeBoard(root, cells);

    const created = createBoard(this.world, position, quaternion);
    globals.boardRoot.value = created.root;
    globals.boardCells.value = created.cells;
    this.beginRound();
  }

  /**
   * Starts a fresh round on the current (empty) board: snapshots the player's chosen
   * symbol for the duration of the round, and honors `nextStarter` (the "loser starts
   * next round" fairness rule) — kicking off an AI opening move if the AI is due to start.
   */
  beginRound() {
    const globals = getGlobals(this.world);
    globals.activePlayerSymbol.value = globals.playerSymbol.peek();

    if (globals.nextStarter.peek() === "ai") {
      this.aiThinkTimer = AI_THINK_DELAY;
      globals.gamePhase.value = "ai-thinking";
    } else {
      globals.gamePhase.value = "player-turn";
    }
  }

  private handlePlayerMove(cellEntity: Entity) {
    const globals = getGlobals(this.world);
    if (globals.gamePhase.peek() !== "player-turn") {
      return;
    }

    this.applyMove(cellEntity, "player");
    if (this.finishIfGameOver()) {
      return;
    }

    this.aiThinkTimer = AI_THINK_DELAY;
    globals.gamePhase.value = "ai-thinking";
  }

  private playAiMove() {
    const globals = getGlobals(this.world);
    const index = getMove(this.readBoard(), globals.difficulty.peek());
    const cellEntity = this.findCell(index);
    if (!cellEntity) {
      return;
    }
    this.applyMove(cellEntity, "ai");

    const robotEntity = this.queries.robot.entities.values().next().value;
    if (robotEntity) {
      AudioUtils.play(robotEntity);
      globals.aiLookTarget.value = cellEntity;
    }

    if (this.finishIfGameOver()) {
      return;
    }
    globals.gamePhase.value = "player-turn";
  }

  private applyMove(cellEntity: Entity, owner: "player" | "ai") {
    cellEntity.setValue(BoardCell, "owner", owner);
    const activeSymbol = getGlobals(this.world).activePlayerSymbol.peek();
    const symbol = owner === "player" ? activeSymbol : oppositeSymbol(activeSymbol);
    attachMark(cellEntity, symbol);
  }

  private readBoard(): Owner[] {
    const board: Owner[] = new Array(9).fill("none");
    for (const cell of this.queries.cells.entities) {
      const index = cell.getValue(BoardCell, "index")!;
      board[index] = cell.getValue(BoardCell, "owner") as Owner;
    }
    return board;
  }

  private findCell(index: number): Entity | undefined {
    for (const cell of this.queries.cells.entities) {
      if (cell.getValue(BoardCell, "index") === index) {
        return cell;
      }
    }
    return undefined;
  }

  /** Evaluates the board; on a terminal result, publishes it and flips to game-over. */
  private finishIfGameOver(): boolean {
    const result = checkResult(this.readBoard());
    if (!result) {
      return false;
    }
    const globals = getGlobals(this.world);
    globals.lastWinner.value = result;
    globals.gameOverSeq.value = globals.gameOverSeq.peek() + 1;
    globals.gamePhase.value = "game-over";

    // "Winner plays second next round" — the loser (or AI, on a player win) starts next.
    // A draw leaves the starter unchanged.
    if (result === "player") {
      globals.nextStarter.value = "ai";
    } else if (result === "ai") {
      globals.nextStarter.value = "player";
    }

    return true;
  }
}
