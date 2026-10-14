import { memoryRepo, resetDb } from './memory';
import { sessionFor } from '../session';
import { memoryBoardPage } from './board';
import { runBoardContract } from './contract-board';

// Shared behaviour, also run against Postgres + RLS in board-postgres.test.ts.
runBoardContract('memory', () => ({ repo: memoryRepo, board: memoryBoardPage }), sessionFor, resetDb);
