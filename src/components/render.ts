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
        const standing =
            leader === null ? 'tied' : leader === side ? 'leader' : 'trailing';
        el.fighter.dataset.standing = standing;
        const icon = el.fighter.querySelector('.status-icon');
        if (icon)
            icon.textContent =
                standing === 'leader'
                    ? '♛'
                    : standing === 'trailing'
                      ? '↓'
                      : '◆';
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
