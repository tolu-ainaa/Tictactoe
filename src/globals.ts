import { Entity, World } from "@iwsdk/core";
import { Signal } from "@preact/signals-core";

import type { Difficulty } from "./ai.js";

export type GamePhase = "placement" | "player-turn" | "ai-thinking" | "game-over";
export type Winner = "player" | "ai" | "draw" | null;
export type Symbol = "X" | "O";
export type Starter = "player" | "ai";

export interface LeaderboardEntry {
  streak: number;
  date: string;
}

export interface GameGlobals {
  gamePhase: Signal<GamePhase>;
  lastWinner: Signal<Winner>;
  gameOverSeq: Signal<number>;
  boardRoot: Signal<Entity | null>;
  boardCells: Signal<Entity[]>;
  currentStreak: Signal<number>;
  highScore: Signal<number>;
  leaderboard: Signal<LeaderboardEntry[]>;
  aiLookTarget: Signal<Entity | null>;
  difficulty: Signal<Difficulty>;
  playerSymbol: Signal<Symbol>;
  activePlayerSymbol: Signal<Symbol>;
  nextStarter: Signal<Starter>;
}

/** Typed accessor for the shared cross-system state stored on `world.globals`. */
export function getGlobals(world: World): GameGlobals {
  return world.globals as unknown as GameGlobals;
}
