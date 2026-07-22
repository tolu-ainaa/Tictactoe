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
import { OnlineMatchSystem } from "./network.js";
import { Robot } from "./robot.js";

function oppositeSymbol(symbol: Symbol): Symbol {
  return symbol === "X" ? "O" : "X";
}

const AI_THINK_DELAY = 0.6;

/**
 * Turn/ownership model across modes — BoardCell.owner stays the win-checker's
 * "player"/"ai" vocabulary, reinterpreted per mode:
 * - ai:     player = the human, ai = the bot (original behavior)
 * - local:  player = X, ai = O (two humans alternating on one device)
 * - online: player = me, ai = my opponent
 */
export class GameLogicSystem extends createSystem({
  cells: { required: [BoardCell] },
  pressedEmpty: {
    required: [BoardCell, Pressed],
    where: [eq(BoardCell, "owner", "none")],
  },
  robot: { required: [Robot] },
}) {
  private aiThinkTimer = 0;
  /** Remote moves that arrived before our board was placed. */
  private pendingRemoteMoves: number[] = [];

  init() {
    this.queries.pressedEmpty.subscribe("qualify", (entity) => {
      this.tryPlayerMove(entity);
    });

    const online = this.world.getSystem(OnlineMatchSystem);
    if (online) {
      online.onRemoteMove = (index) => this.applyRemoteMove(index);
      online.onRemoteRestart = () => this.resetGame();
      online.onPeerJoined = () => this.handlePeerJoined();
    }
  }

  update(delta: number) {
    const globals = getGlobals(this.world);
    if (globals.gameMode.peek() !== "ai") {
      return;
    }
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

  /** Panel entry point: restart locally and, in online mode, tell the opponent. */
  requestRestart() {
    const globals = getGlobals(this.world);
    if (globals.gameMode.peek() === "online") {
      this.world.getSystem(OnlineMatchSystem)?.sendRestart();
    }
    this.resetGame();
  }

  /**
   * Starts a fresh round on the current (empty) board.
   * - ai: honors `nextStarter` ("loser starts next round") and the chosen symbol.
   * - local: X always opens; both humans share the device.
   * - online: X always opens; host is X, guest is O. If the opponent hasn't
   *   joined yet we sit in "ai-thinking" (rendered as "waiting for friend").
   */
  beginRound() {
    const globals = getGlobals(this.world);
    const mode = globals.gameMode.peek();
    globals.turnSymbol.value = "X";

    if (mode === "ai") {
      globals.activePlayerSymbol.value = globals.playerSymbol.peek();
      if (globals.nextStarter.peek() === "ai") {
        this.aiThinkTimer = AI_THINK_DELAY;
        globals.gamePhase.value = "ai-thinking";
      } else {
        globals.gamePhase.value = "player-turn";
      }
      return;
    }

    if (mode === "local") {
      globals.gamePhase.value = "player-turn";
      return;
    }

    // online
    const mySymbol = this.myOnlineSymbol();
    globals.activePlayerSymbol.value = mySymbol;
    if (!globals.onlinePeer.peek()) {
      globals.gamePhase.value = "ai-thinking";
    } else {
      globals.gamePhase.value = mySymbol === "X" ? "player-turn" : "ai-thinking";
    }
    this.flushPendingRemoteMoves();
  }

  /**
   * Attempts a local player move on the given cell. Guards phase and cell
   * ownership itself, so it's safe to call from any input path (Pressed query
   * on headset, ScreenInputSystem tap raycasts on phone AR).
   */
  tryPlayerMove(cellEntity: Entity) {
    const globals = getGlobals(this.world);
    if (globals.gamePhase.peek() !== "player-turn") {
      return;
    }
    if (cellEntity.getValue(BoardCell, "owner") !== "none") {
      return;
    }
    const mode = globals.gameMode.peek();

    if (mode === "local") {
      const symbol = globals.turnSymbol.peek();
      this.applyMove(cellEntity, symbol === "X" ? "player" : "ai", symbol);
      if (this.finishIfGameOver()) {
        return;
      }
      globals.turnSymbol.value = oppositeSymbol(symbol);
      return;
    }

    if (mode === "online") {
      const mySymbol = this.myOnlineSymbol();
      const index = cellEntity.getValue(BoardCell, "index")!;
      this.applyMove(cellEntity, "player", mySymbol);
      this.world.getSystem(OnlineMatchSystem)?.sendMove(index);
      if (this.finishIfGameOver()) {
        return;
      }
      globals.turnSymbol.value = oppositeSymbol(mySymbol);
      globals.gamePhase.value = "ai-thinking";
      return;
    }

    // ai
    this.applyMove(cellEntity, "player", globals.activePlayerSymbol.peek());
    if (this.finishIfGameOver()) {
      return;
    }
    this.aiThinkTimer = AI_THINK_DELAY;
    globals.gamePhase.value = "ai-thinking";
  }

  /** A move from the online opponent (or one queued before our board existed). */
  applyRemoteMove(index: number) {
    const globals = getGlobals(this.world);
    if (globals.gameMode.peek() !== "online") {
      return;
    }
    const cellEntity = this.findCell(index);
    if (!cellEntity || !globals.boardRoot.peek()) {
      this.pendingRemoteMoves.push(index);
      return;
    }
    if (cellEntity.getValue(BoardCell, "owner") !== "none") {
      return;
    }

    const mySymbol = this.myOnlineSymbol();
    this.applyMove(cellEntity, "ai", oppositeSymbol(mySymbol));
    this.notifyRobot(cellEntity);

    if (this.finishIfGameOver()) {
      return;
    }
    globals.turnSymbol.value = mySymbol;
    globals.gamePhase.value = "player-turn";
  }

  private handlePeerJoined() {
    const globals = getGlobals(this.world);
    if (globals.gameMode.peek() !== "online") {
      return;
    }
    // Re-derive whose turn it is now that the match is actually live.
    if (globals.boardRoot.peek() && globals.gamePhase.peek() !== "game-over") {
      this.beginRound();
    }
  }

  private flushPendingRemoteMoves() {
    if (this.pendingRemoteMoves.length === 0) {
      return;
    }
    const pending = this.pendingRemoteMoves;
    this.pendingRemoteMoves = [];
    for (const index of pending) {
      this.applyRemoteMove(index);
    }
  }

  private myOnlineSymbol(): Symbol {
    return getGlobals(this.world).onlineRole.peek() === "guest" ? "O" : "X";
  }

  private playAiMove() {
    const globals = getGlobals(this.world);
    const index = getMove(this.readBoard(), globals.difficulty.peek());
    const cellEntity = this.findCell(index);
    if (!cellEntity) {
      return;
    }
    this.applyMove(cellEntity, "ai", oppositeSymbol(globals.activePlayerSymbol.peek()));
    this.notifyRobot(cellEntity);

    if (this.finishIfGameOver()) {
      return;
    }
    globals.gamePhase.value = "player-turn";
  }

  /** Chime + make the robot look at a move made by the non-local side. */
  private notifyRobot(cellEntity: Entity) {
    const robotEntity = this.queries.robot.entities.values().next().value;
    if (robotEntity) {
      AudioUtils.play(robotEntity);
      getGlobals(this.world).aiLookTarget.value = cellEntity;
    }
  }

  private applyMove(cellEntity: Entity, owner: "player" | "ai", symbol: Symbol) {
    cellEntity.setValue(BoardCell, "owner", owner);
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

    // "Winner plays second next round" (ai mode only) — the loser starts.
    // A draw leaves the starter unchanged.
    if (globals.gameMode.peek() === "ai") {
      if (result === "player") {
        globals.nextStarter.value = "ai";
      } else if (result === "ai") {
        globals.nextStarter.value = "player";
      }
    }

    return true;
  }
}
