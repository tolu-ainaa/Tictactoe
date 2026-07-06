export type Owner = "none" | "player" | "ai";

export const WIN_LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export type GameResult = "player" | "ai" | "draw" | null;

export function checkResult(board: readonly Owner[]): GameResult {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] !== "none" && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as "player" | "ai";
    }
  }
  return board.every((cell) => cell !== "none") ? "draw" : null;
}

export type Difficulty = "easy" | "medium" | "hard";

function emptyIndices(board: readonly Owner[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] === "none") indices.push(i);
  }
  return indices;
}

/** Picks any empty cell at random. */
export function getRandomMove(board: readonly Owner[]): number {
  const empties = emptyIndices(board);
  return empties[Math.floor(Math.random() * empties.length)];
}

/** Takes an immediate win if available, else blocks the player's immediate win, else random. */
export function getHeuristicMove(board: readonly Owner[]): number {
  const empties = emptyIndices(board);

  for (const i of empties) {
    const next = board.slice();
    next[i] = "ai";
    if (checkResult(next) === "ai") return i;
  }

  for (const i of empties) {
    const next = board.slice();
    next[i] = "player";
    if (checkResult(next) === "player") return i;
  }

  return getRandomMove(board);
}

/** Dispatches to the move generator matching the requested difficulty. */
export function getMove(board: readonly Owner[], difficulty: Difficulty): number {
  switch (difficulty) {
    case "easy":
      return getRandomMove(board);
    case "medium":
      return getHeuristicMove(board);
    case "hard":
      return getBestMove(board);
  }
}

/** Minimax search over the (max 9-cell) board. AI is the maximizing player. */
export function getBestMove(board: readonly Owner[]): number {
  let bestScore = -Infinity;
  let bestIndex = -1;

  for (let i = 0; i < board.length; i++) {
    if (board[i] !== "none") continue;
    const next = board.slice();
    next[i] = "ai";
    const score = minimax(next, false);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function minimax(board: Owner[], aiTurn: boolean, depth = 0): number {
  const result = checkResult(board);
  if (result === "ai") return 10 - depth;
  if (result === "player") return depth - 10;
  if (result === "draw") return 0;

  let best = aiTurn ? -Infinity : Infinity;
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== "none") continue;
    board[i] = aiTurn ? "ai" : "player";
    const score = minimax(board, !aiTurn, depth + 1);
    board[i] = "none";
    best = aiTurn ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}
