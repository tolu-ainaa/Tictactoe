import { createSystem } from "@iwsdk/core";

import { getGlobals, LeaderboardEntry } from "./globals.js";

const STORAGE_KEY = "iwsdk-tictactoe-scores";
const MAX_LEADERBOARD_ENTRIES = 5;

interface StoredScores {
  currentStreak: number;
  highScore: number;
  leaderboard: LeaderboardEntry[];
}

function loadScores(): StoredScores {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { currentStreak: 0, highScore: 0, leaderboard: [] };
    }
    const parsed = JSON.parse(raw);
    return {
      currentStreak: typeof parsed.currentStreak === "number" ? parsed.currentStreak : 0,
      highScore: typeof parsed.highScore === "number" ? parsed.highScore : 0,
      leaderboard: Array.isArray(parsed.leaderboard) ? parsed.leaderboard : [],
    };
  } catch {
    return { currentStreak: 0, highScore: 0, leaderboard: [] };
  }
}

/** Loads/persists win-streak high score + leaderboard in localStorage. */
export class ScoreSystem extends createSystem({}) {
  init() {
    const globals = getGlobals(this.world);
    const saved = loadScores();
    globals.currentStreak.value = saved.currentStreak;
    globals.highScore.value = saved.highScore;
    globals.leaderboard.value = saved.leaderboard;

    this.cleanupFuncs.push(globals.gameOverSeq.subscribe(() => this.handleGameOver()));
  }

  private handleGameOver() {
    const globals = getGlobals(this.world);
    // Streaks are a vs-AI concept; PvP rounds don't touch them.
    if (globals.gameMode.peek() !== "ai") {
      return;
    }
    const winner = globals.lastWinner.peek();
    if (winner === null) {
      return;
    }

    if (winner === "player") {
      const streak = globals.currentStreak.peek() + 1;
      globals.currentStreak.value = streak;
      if (streak > globals.highScore.peek()) {
        globals.highScore.value = streak;
      }
    } else if (winner === "ai") {
      const streak = globals.currentStreak.peek();
      if (streak > 0) {
        const entry: LeaderboardEntry = { streak, date: new Date().toLocaleDateString() };
        globals.leaderboard.value = [...globals.leaderboard.peek(), entry]
          .sort((a, b) => b.streak - a.streak)
          .slice(0, MAX_LEADERBOARD_ENTRIES);
      }
      globals.currentStreak.value = 0;
    }
    // draw: streak is preserved, nothing to update

    this.persist();
  }

  private persist() {
    const globals = getGlobals(this.world);
    const data: StoredScores = {
      currentStreak: globals.currentStreak.peek(),
      highScore: globals.highScore.peek(),
      leaderboard: globals.leaderboard.peek(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}
