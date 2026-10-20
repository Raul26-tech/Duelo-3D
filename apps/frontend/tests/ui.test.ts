import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createStore } from '../src/core/store.ts';
import { getElements } from '../src/components/elements.ts';
import { createAnimations } from '../src/components/animations.ts';
import { render } from '../src/components/render.ts';
import { bindSimulation } from '../src/events/simulation.ts';
test('botões atualizam placar, barras, liderança, vídeos e reset', () => {
    const dom = new JSDOM(
        readFileSync(new URL('../index.html', import.meta.url), 'utf8'),
        { url: 'http://localhost/' },
    );
    // DOM virtual não decodifica mídia. Reprodução real é uma verificação separada.
    const proto = dom.window.HTMLMediaElement.prototype;
    proto.pause = () => {};
    proto.load = () => {};
    proto.play = () => Promise.resolve();
    const el = getElements(dom.window.document);
    const store = createStore();
    const anim = createAnimations(el, '/videos/');
    const off = store.subscribe((scores, event) => {
        if (event.type === 'reset') anim.reset();
        render(
            scores,
            el,
            anim,
            event.type === 'vote' ? event.side : undefined,
        );
    });
    const unbind = bindSimulation(el, store);
    try {
        render(store.getState(), el, anim);
        assert.equal(el.fighters.a.status.textContent, 'EMPATE');
        el.fighters.a.vote.click();
        assert.equal(el.fighters.a.score.textContent, '1');
        assert.equal(el.fighters.a.bar.style.width, '100%');
        assert.equal(el.fighters.a.status.textContent, 'NA LIDERANÇA');
        assert.equal(el.fighters.a.fighter.dataset.standing, 'leader');
        assert.equal(el.fighters.b.fighter.dataset.standing, 'trailing');
        assert.equal(
            el.fighters.a.fighter.querySelector('.status-icon')?.textContent,
            '♛',
        );
        assert.equal(el.fighters.b.status.textContent, 'ATRÁS NO PLACAR');
        assert.equal(
            el.fighters.a.video.querySelector('source')?.getAttribute('src'),
            '/videos/lula-pulando.webm',
        );
        assert.equal(
            el.fighters.b.video.querySelector('source')?.getAttribute('src'),
            '/videos/flavio-triste.webm',
        );
        el.fighters.b.vote.click();
        assert.equal(el.fighters.a.status.textContent, 'EMPATE');
        assert.equal(el.fighters.a.bar.style.width, '50%');
        assert.equal(el.fighters.a.video.dataset.state, 'happy');
        el.reset.click();
        assert.deepEqual(store.getState(), { a: 0, b: 0 });
        for (const side of ['a', 'b'] as const) {
            assert.equal(el.fighters[side].score.textContent, '0');
            assert.equal(el.fighters[side].fighter.dataset.standing, 'tied');
            assert.equal(
                el.fighters[side].fighter.querySelector('.status-icon')
                    ?.textContent,
                '◆',
            );
            assert.equal(el.fighters[side].bar.style.width, '0%');
            assert.equal(el.fighters[side].video.dataset.state, 'happy');
            assert.equal(
                el.fighters[side].fighter.classList.contains('jump'),
                false,
            );
        }
        unbind();
        el.fighters.a.vote.click();
        assert.equal(store.getState().a, 0);
    } finally {
        off();
        unbind();
        anim.dispose();
        dom.window.close();
    }
});
