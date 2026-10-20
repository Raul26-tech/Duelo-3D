import { sides } from '../config/participants.ts';
type Target = { dispatch(event: { type: 'vote'; side: 'a' | 'b' } | { type: 'reset' }): void };
import type { Elements } from '../components/elements.ts';
export function bindSimulation(elements: Elements, store: Target) {
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
