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
  placement: "Place the board on a surface",
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
        this.world.getSystem(GameLogicSystem)?.resetGame();
      });

      replaceBoardButton.addEventListener("click", () => {
        this.world.getSystem(PlacementSystem)?.requestPlacement();
      });

      xrButton.addEventListener("click", () => {
        if (this.world.visibilityState.value === VisibilityState.NonImmersive) {
          this.world.launchXR();
        } else {
          this.world.exitXR();
        }
      });
      this.world.visibilityState.subscribe((visibilityState) => {
        if (visibilityState === VisibilityState.NonImmersive) {
          xrButton.setProperties({ text: "Enter XR" });
        } else {
          xrButton.setProperties({ text: "Exit to Browser" });
        }
      });
    });
  }
}
