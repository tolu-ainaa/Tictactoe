import {
  createSystem,
  eq,
  PanelDocument,
  PanelUI,
  UIKit,
  UIKitDocument,
  VisibilityState,
} from "@iwsdk/core";

import type { Difficulty } from "./ai.js";
import { GameLogicSystem } from "./game.js";
import { getGlobals } from "./globals.js";
import type { GameGlobals, GameMode, LeaderboardEntry, Symbol } from "./globals.js";
import { PlacementSystem } from "./placement.js";
import { isIOS, launchVariantAR } from "./platform.js";

function statusFor(globals: GameGlobals): string {
  const phase = globals.gamePhase.peek();
  const mode = globals.gameMode.peek();
  switch (phase) {
    case "placement":
      return "Look at a surface, pinch to place the board";
    case "player-turn":
      return mode === "local" ? `${globals.turnSymbol.peek()}'s turn` : "Your turn";
    case "ai-thinking":
      if (mode === "ai") {
        return "AI is thinking...";
      }
      if (mode === "online") {
        return globals.onlinePeer.peek()
          ? "Friend's turn"
          : "Waiting for a friend to join...";
      }
      return "";
    case "game-over": {
      const winner = globals.lastWinner.peek();
      if (winner === "draw") {
        return "Draw";
      }
      if (mode === "local") {
        return winner === "player" ? "X wins!" : "O wins!";
      }
      if (mode === "online") {
        return winner === "player" ? "You win!" : "Friend wins!";
      }
      return winner === "player" ? "You win!" : "AI wins";
    }
  }
  return "";
}

const ACTIVE_COLORS = { backgroundColor: "#fafafa", color: "#09090b" };
const INACTIVE_COLORS = { backgroundColor: "#27272a", color: "#fafafa" };

function highlight(button: UIKit.Text, active: boolean) {
  button.setProperties(active ? ACTIVE_COLORS : INACTIVE_COLORS);
}

export class GamePanelSystem extends createSystem({
  gamePanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/game.json")],
  },
}) {
  init() {
    this.queries.gamePanel.subscribe("qualify", (entity) => {
      const document = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!document) {
        return;
      }

      const statusText = document.getElementById("status") as UIKit.Text;
      const scoreText = document.getElementById("score") as UIKit.Text;
      const lbRows = [0, 1, 2, 3, 4].map(
        (i) => document.getElementById(`lb-row-${i}`) as UIKit.Text,
      );
      const playAgainButton = document.getElementById("play-again") as UIKit.Text;
      const replaceBoardButton = document.getElementById("replace-board") as UIKit.Text;
      const xrButton = document.getElementById("xr-button") as UIKit.Text;
      const onlineInfo = document.getElementById("online-info") as UIKit.Text;
      const symHeading = document.getElementById("sym-heading") as UIKit.Text;
      const symRow = document.getElementById("sym-row") as UIKit.Container;
      const diffHeading = document.getElementById("diff-heading") as UIKit.Text;
      const diffRow = document.getElementById("diff-row") as UIKit.Container;

      const modeButtons: Record<GameMode, UIKit.Text> = {
        ai: document.getElementById("mode-ai") as UIKit.Text,
        local: document.getElementById("mode-local") as UIKit.Text,
        online: document.getElementById("mode-online") as UIKit.Text,
      };
      const symbolButtons: Record<Symbol, UIKit.Text> = {
        X: document.getElementById("symbol-x") as UIKit.Text,
        O: document.getElementById("symbol-o") as UIKit.Text,
      };
      const difficultyButtons: Record<Difficulty, UIKit.Text> = {
        easy: document.getElementById("diff-easy") as UIKit.Text,
        medium: document.getElementById("diff-medium") as UIKit.Text,
        hard: document.getElementById("diff-hard") as UIKit.Text,
      };

      const globals = getGlobals(this.world);

      const updateStatus = () => {
        statusText.setProperties({ text: statusFor(globals) });
      };

      // Transient message in the status line, restored to phase text after.
      let flashTimer: ReturnType<typeof setTimeout> | undefined;
      const flashStatus = (text: string) => {
        statusText.setProperties({ text });
        clearTimeout(flashTimer);
        flashTimer = setTimeout(updateStatus, 2500);
      };

      // Detect AR support up front so the XR button can say so instead of
      // silently failing (desktop browsers, iOS Safari outside the viewer).
      let arSupported: boolean | null = null;
      navigator.xr
        ?.isSessionSupported?.("immersive-ar")
        .then((supported) => {
          arSupported = supported;
          if (!supported) {
            xrButton.setProperties({ text: "AR Not Available Here" });
          }
        })
        .catch(() => {
          arSupported = false;
        });

      const updateScore = () => {
        scoreText.setProperties({
          text: `Streak: ${globals.currentStreak.peek()}    Best: ${globals.highScore.peek()}`,
        });
      };

      const updateLeaderboard = (entries: LeaderboardEntry[]) => {
        lbRows.forEach((row, i) => {
          const entry = entries[i];
          if (entry) {
            row.setProperties({
              text: `${i + 1}. Streak ${entry.streak} — ${entry.date}`,
              display: "flex",
            });
          } else {
            row.setProperties({ display: "none" });
          }
        });
      };

      const updateSymbolButtons = (symbol: Symbol) => {
        highlight(symbolButtons.X, symbol === "X");
        highlight(symbolButtons.O, symbol === "O");
      };

      const updateDifficultyButtons = (difficulty: Difficulty) => {
        highlight(difficultyButtons.easy, difficulty === "easy");
        highlight(difficultyButtons.medium, difficulty === "medium");
        highlight(difficultyButtons.hard, difficulty === "hard");
      };

      const updateModeUI = (mode: GameMode) => {
        highlight(modeButtons.ai, mode === "ai");
        highlight(modeButtons.local, mode === "local");
        highlight(modeButtons.online, mode === "online");
        // Symbol/difficulty only apply to the AI mode.
        const aiDisplay = mode === "ai" ? "flex" : "none";
        symHeading.setProperties({ display: aiDisplay });
        symRow.setProperties({ display: aiDisplay });
        diffHeading.setProperties({ display: aiDisplay });
        diffRow.setProperties({ display: aiDisplay });
      };

      const updateOnlineInfo = () => {
        if (globals.gameMode.peek() !== "online") {
          onlineInfo.setProperties({ display: "none" });
          return;
        }
        const room = globals.onlineRoom.peek();
        const status = globals.onlineStatus.peek();
        let text: string;
        if (status === "error") {
          text = "Connection failed — try again later";
        } else if (!room || status !== "connected") {
          text = "Connecting...";
        } else if (globals.onlinePeer.peek()) {
          text = `Room ${room} — friend connected!`;
        } else {
          text = `Room ${room} — tap here to copy invite link`;
        }
        onlineInfo.setProperties({ display: "flex", text });
      };

      this.cleanupFuncs.push(
        globals.gamePhase.subscribe(updateStatus),
        globals.lastWinner.subscribe(updateStatus),
        globals.turnSymbol.subscribe(updateStatus),
        globals.gameMode.subscribe(() => {
          updateModeUI(globals.gameMode.peek());
          updateOnlineInfo();
          updateStatus();
        }),
        globals.onlineRoom.subscribe(updateOnlineInfo),
        globals.onlineStatus.subscribe(updateOnlineInfo),
        globals.onlinePeer.subscribe(() => {
          updateOnlineInfo();
          updateStatus();
        }),
        globals.currentStreak.subscribe(updateScore),
        globals.highScore.subscribe(updateScore),
        globals.leaderboard.subscribe(updateLeaderboard),
        globals.playerSymbol.subscribe(updateSymbolButtons),
        globals.difficulty.subscribe(updateDifficultyButtons),
      );

      const setMode = (mode: GameMode) => {
        if (globals.gameMode.peek() === mode) {
          return;
        }
        globals.gameMode.value = mode;
        // Restart cleanly under the new rules if a board is already placed.
        if (globals.boardRoot.peek()) {
          this.world.getSystem(GameLogicSystem)?.resetGame();
        }
      };

      modeButtons.ai.addEventListener("click", () => setMode("ai"));
      modeButtons.local.addEventListener("click", () => setMode("local"));
      modeButtons.online.addEventListener("click", () => setMode("online"));

      onlineInfo.addEventListener("click", () => {
        const room = globals.onlineRoom.peek();
        if (!room) {
          return;
        }
        const link = `${location.origin}${location.pathname}?room=${room}`;
        navigator.clipboard
          ?.writeText(link)
          .then(() => flashStatus("Invite link copied!"))
          .catch(() => flashStatus(`Invite link: ${link}`));
      });

      symbolButtons.X.addEventListener("click", () => {
        globals.playerSymbol.value = "X";
      });
      symbolButtons.O.addEventListener("click", () => {
        globals.playerSymbol.value = "O";
      });

      difficultyButtons.easy.addEventListener("click", () => {
        globals.difficulty.value = "easy";
      });
      difficultyButtons.medium.addEventListener("click", () => {
        globals.difficulty.value = "medium";
      });
      difficultyButtons.hard.addEventListener("click", () => {
        globals.difficulty.value = "hard";
      });

      playAgainButton.addEventListener("click", () => {
        console.log("[panel] play-again clicked");
        if (!globals.boardRoot.peek()) {
          flashStatus(
            this.world.visibilityState.value === VisibilityState.NonImmersive
              ? "Enter XR first — the board is placed in AR"
              : "No board yet — aim at a surface to place it",
          );
          return;
        }
        this.world.getSystem(GameLogicSystem)?.requestRestart();
        flashStatus("New round!");
      });

      replaceBoardButton.addEventListener("click", () => {
        console.log("[panel] replace-board clicked");
        if (this.world.visibilityState.value === VisibilityState.NonImmersive) {
          flashStatus("Enter XR first — the board is placed in AR");
          return;
        }
        const hadBoard = !!globals.boardRoot.peek();
        this.world.getSystem(PlacementSystem)?.requestPlacement();
        if (hadBoard) {
          flashStatus("Pick a new spot for the board");
        }
      });

      xrButton.addEventListener("click", () => {
        console.log("[panel] xr-button clicked");
        if (this.world.visibilityState.value !== VisibilityState.NonImmersive) {
          this.world.exitXR();
          return;
        }
        if (arSupported === false) {
          flashStatus(
            "No AR in this browser — use Android Chrome, Quest, or the iOS App Clip link",
          );
          return;
        }
        flashStatus("Starting AR...");
        if (isIOS()) {
          // Inside the Variant Launch viewer the session must be requested
          // with its documented feature set, or hit-test never activates.
          launchVariantAR(this.world).then((started) => {
            if (!started) {
              this.world.launchXR();
            }
          });
        } else {
          this.world.launchXR();
        }
      });
      this.world.visibilityState.subscribe((visibilityState) => {
        if (visibilityState === VisibilityState.NonImmersive) {
          xrButton.setProperties({
            text: arSupported === false ? "AR Not Available Here" : "Enter XR",
          });
        } else {
          xrButton.setProperties({ text: "Exit to Browser" });
        }
      });
    });
  }
}
