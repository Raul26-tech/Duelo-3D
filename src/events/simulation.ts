import { sides } from '../config/participants.ts';
import type { Store } from '../core/store.ts';
import type { Elements } from '../components/elements.ts';
export function bindSimulation(elements: Elements, store: Store) {
    const cleanup: (() => void)[] = [];
    for (const side of sides) {
        const listener = () => store.dispatch({ type: 'vote', side });
        elements.fighters[side].vote.addEventListener('click', listener);
        cleanup.push(() =>
            elements.fighters[side].vote.removeEventListener('click', listener),
        );
    }
    const reset = () => store.dispatch({ type: 'reset' });
    elements.reset.addEventListener('click', reset);
    return () => {
        cleanup.forEach((fn) => fn());
        elements.reset.removeEventListener('click', reset);
    };
}
