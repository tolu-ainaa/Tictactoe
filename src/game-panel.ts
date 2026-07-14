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
import type { GamePhase, LeaderboardEntry, Symbol, Winner } from "./globals.js";
import { PlacementSystem } from "./placement.js";

const STATUS_TEXT: Record<GamePhase, string> = {
  placement: "Look at a surface, pinch to place the board",
  "player-turn": "Your turn",
  "ai-thinking": "AI is thinking...",
  "game-over": "",
};

function resultText(winner: Winner): string {
  if (winner === "player") return "You win!";
  if (winner === "ai") return "AI wins";
  if (winner === "draw") return "Draw";
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
        const phase = globals.gamePhase.peek();
        const text =
          phase === "game-over" ? resultText(globals.lastWinner.peek()) : STATUS_TEXT[phase];
        statusText.setProperties({ text });
      };

      // Show a transient message in the status line, then restore the
      // phase-driven text. Gives every button press visible feedback so
      // no-op states don't read as broken buttons.
      let flashTimer: ReturnType<typeof setTimeout> | undefined;
      const flashStatus = (text: string) => {
        statusText.setProperties({ text });
        clearTimeout(flashTimer);
        flashTimer = setTimeout(updateStatus, 2500);
      };

      // Detect AR support up front so the XR button can say so instead of
      // silently failing (e.g. desktop browsers, iOS Safari outside the
      // Launch viewer).
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

      this.cleanupFuncs.push(
        globals.gamePhase.subscribe(updateStatus),
        globals.lastWinner.subscribe(updateStatus),
        globals.currentStreak.subscribe(updateScore),
        globals.highScore.subscribe(updateScore),
        globals.leaderboard.subscribe(updateLeaderboard),
        globals.playerSymbol.subscribe(updateSymbolButtons),
        globals.difficulty.subscribe(updateDifficultyButtons),
      );

      symbolButtons.X.addEventListener("click", () => {
        console.log("[panel] X clicked");
        globals.playerSymbol.value = "X";
      });
      symbolButtons.O.addEventListener("click", () => {
        console.log("[panel] O clicked");
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
        this.world.getSystem(GameLogicSystem)?.resetGame();
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
        this.world.launchXR();
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
