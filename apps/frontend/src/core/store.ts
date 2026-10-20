import {
  initialScores,
  updateScores,
  type Scores,
  type VoteEvent,
} from './score.ts';
export function createStore() {
  let scores = initialScores();
  const listeners = new Set<(scores: Scores, event: VoteEvent) => void>();
  return {
    getState: (): Scores => ({ ...scores }),
    dispatch(event: VoteEvent) {
      scores = updateScores(scores, event);
      for (const listener of listeners) listener({ ...scores }, event);
    },
    subscribe(listener: (scores: Scores, event: VoteEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type Store = ReturnType<typeof createStore>;
