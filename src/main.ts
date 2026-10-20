import './styles/main.css';
import { createStore } from './core/store.ts';
import { getElements } from './components/elements.ts';
import { createAnimations } from './components/animations.ts';
import { render } from './components/render.ts';
import { bindSimulation } from './events/simulation.ts';
import {
    participants,
    sides,
    type AnimationState,
} from './config/participants.ts';
const elements = getElements(document);
const store = createStore();
const animations = createAnimations(
    elements,
    `${import.meta.env.BASE_URL}videos/`,
);
const unsubscribe = store.subscribe((scores, event) => {
    if (event.type === 'reset') animations.reset();
    render(
        scores,
        elements,
        animations,
        event.type === 'vote' ? event.side : undefined,
    );
});
const unbind = bindSimulation(elements, store);
const mediaListeners = sides.map((side) => {
    const video = elements.fighters[side].video;
    const onError = () =>
        console.warn(
            'Confira o arquivo de vídeo:',
            participants[side].videos[
                (video.dataset.state || 'happy') as AnimationState
            ],
        );
    video.addEventListener('error', onError, true);
    return () => video.removeEventListener('error', onError, true);
});
render(store.getState(), elements, animations);
if (import.meta.hot)
    import.meta.hot.dispose(() => {
        unbind();
        unsubscribe();
        animations.dispose();
        mediaListeners.forEach((remove) => remove());
    });
