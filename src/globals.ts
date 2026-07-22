import { Entity, World } from "@iwsdk/core";
import { Signal } from "@preact/signals-core";

import type { Difficulty } from "./ai.js";

export type GamePhase = "placement" | "player-turn" | "ai-thinking" | "game-over";
export type Winner = "player" | "ai" | "draw" | null;
export type Symbol = "X" | "O";
export type Starter = "player" | "ai";
/** vs AI, local pass-and-play, or online room-code match. */
export type GameMode = "ai" | "local" | "online";
export type OnlineRole = "host" | "guest";
export type OnlineStatus = "idle" | "connecting" | "connected" | "error";

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
  gameMode: Signal<GameMode>;
  /** Whose symbol moves next (drives turn flow in local/online modes). */
  turnSymbol: Signal<Symbol>;
  onlineRoom: Signal<string | null>;
  onlineRole: Signal<OnlineRole | null>;
  onlinePeer: Signal<boolean>;
  onlineStatus: Signal<OnlineStatus>;
}

/** Typed accessor for the shared cross-system state stored on `world.globals`. */
export function getGlobals(world: World): GameGlobals {
  return world.globals as unknown as GameGlobals;
}
