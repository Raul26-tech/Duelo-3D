import { sides, type Side } from '../config/participants.ts';
import { getLeader, getPercentages, type Scores } from '../core/score.ts';
import type { Elements } from './elements.ts';
import type { Animations } from './animations.ts';
export function render(
  scores: Scores,
  elements: Elements,
  animations: Animations,
  jumped?: Side,
) {
  const leader = getLeader(scores);
  const percentages = getPercentages(scores);
  for (const side of sides) {
    const el = elements.fighters[side];
    el.score.textContent = String(scores[side]);
    el.bar.style.width = `${percentages[side]}%`;
    el.status.textContent =
      leader === null
        ? 'EMPATE'
        : leader === side
          ? 'NA LIDERANÇA'
          : 'ATRÁS NO PLACAR';
    animations.setVideo(
      side,
      leader === null || leader === side ? 'happy' : 'sad',
    );
  }
  // Preserva a prioridade e o loop do salto do protótipo até o próximo evento.
  if (jumped) animations.jump(jumped);
}
