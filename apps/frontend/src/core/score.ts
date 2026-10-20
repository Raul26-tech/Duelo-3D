import { sides, type Side } from '../config/participants.ts';
export type Scores = Readonly<Record<Side, number>>;
export type VoteEvent =
  { type: 'vote'; side: Side; amount?: number } | { type: 'reset' };
export function initialScores(): Scores {
  return { a: 0, b: 0 };
}
export function updateScores(scores: Scores, event: VoteEvent): Scores {
  if (event.type === 'reset') return initialScores();
  const amount = event.amount ?? 1;
  if (
    !sides.includes(event.side) ||
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    !Number.isSafeInteger(scores.a + scores.b + amount)
  ) {
    throw new RangeError(
      'Voto inválido ou limite seguro de pontuação excedido.',
    );
  }
  return { ...scores, [event.side]: scores[event.side] + amount };
}
export function getLeader(scores: Scores): Side | null {
  return scores.a === scores.b ? null : scores.a > scores.b ? 'a' : 'b';
}
export function getPercentages(scores: Scores): Record<Side, number> {
  const total = scores.a + scores.b;
  return total === 0
    ? { a: 0, b: 0 }
    : { a: (scores.a / total) * 100, b: (scores.b / total) * 100 };
}
