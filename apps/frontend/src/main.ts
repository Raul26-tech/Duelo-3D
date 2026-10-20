import './styles/main.css';
import { getElements } from './components/elements.ts';
import { createAnimations } from './components/animations.ts';
import { render } from './components/render.ts';
import { bindSimulation } from './events/simulation.ts';
import { createRealtimeClient } from './realtime/client.ts';
import {
    participants,
    sides,
    type AnimationState,
} from './config/participants.ts';

const elements = getElements(document);
const animations = createAnimations(
    elements,
    `${import.meta.env.BASE_URL}videos/`,
);
const indicator = document.createElement('p');
indicator.className = 'note';
indicator.setAttribute('role', 'status');
indicator.setAttribute('aria-live', 'polite');
const label = document.createElement('span');
const authorize = document.createElement('button');
authorize.type = 'button';
authorize.textContent = 'Autorizar simulação';
indicator.append(label, ' ', authorize);
document.querySelector('main')?.append(indicator);
const url = new URL('/realtime', window.location.href);
url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const names = {
    disconnected:
        'Simulação desconectada. Último estado recebido pode estar desatualizado.',
    connecting: 'Conectando à simulação…',
    connected: 'Simulação local conectada — placar autorizado pelo servidor.',
    unauthorized: 'Chave não autorizada. Informe a chave atual do backend.',
};
const client = createRealtimeClient({
    url: url.href,
    onStatus(status) {
        label.textContent = names[status];
        for (const side of sides)
            elements.fighters[side].vote.disabled = status !== 'connected';
        elements.reset.disabled = status !== 'connected';
    },
    onRejected(code) {
        label.textContent = `Simulação: comando rejeitado (${code}).`;
    },
    onState(message) {
        if (
            message.type === 'state.snapshot' ||
            message.effect?.kind === 'reset'
        )
            animations.reset();
        render(
            message.state.scores,
            elements,
            animations,
            message.type === 'state.updated' && message.effect?.kind === 'vote'
                ? message.effect.side
                : undefined,
        );
    },
});
for (const side of sides) elements.fighters[side].vote.disabled = true;
elements.reset.disabled = true;
label.textContent = names.disconnected;
const onAuthorize = () => {
    const token = window.prompt(
        'Cole a chave de simulação mostrada no terminal do backend (ou configurada no .env).',
    );
    if (token !== null && !client.authorize(token.trim()))
        label.textContent = 'Formato de chave inválido.';
};
authorize.addEventListener('click', onAuthorize);
const unbind = bindSimulation(elements, {
    dispatch(event) {
        if (event.type === 'vote') client.vote(event.side);
        else client.reset();
    },
});
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
if (import.meta.hot)
    import.meta.hot.dispose(() => {
        unbind();
        client.close();
        animations.dispose();
        authorize.removeEventListener('click', onAuthorize);
        indicator.remove();
        mediaListeners.forEach((remove) => remove());
    });
