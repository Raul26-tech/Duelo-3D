import {
  participants,
  sides,
  type Side,
  type AnimationState,
} from '../config/participants.ts';
import type { Elements } from './elements.ts';
export function createAnimations(elements: Elements, videoBase: string) {
  const timers: Partial<Record<Side, ReturnType<typeof setTimeout>>> = {};
  function setVideo(side: Side, state: AnimationState) {
    const video = elements.fighters[side].video;
    if (video.dataset.state === state) return;
    video.dataset.state = state;
    video.pause();
    const source = video.ownerDocument.createElement('source');
    source.src = videoBase + participants[side].videos[state];
    source.type = 'video/webm';
    video.replaceChildren(source);
    video.load();
    void video.play()?.catch(() => {
      /* Autoplay pode ser bloqueado pelo navegador. */
    });
  }
  function clearJumps() {
    for (const side of sides) {
      clearTimeout(timers[side]);
      delete timers[side];
      elements.fighters[side].fighter.classList.remove('jump');
    }
  }
  return {
    setVideo,
    jump(side: Side) {
      const fighter = elements.fighters[side].fighter;
      fighter.classList.remove('jump');
      void fighter.offsetWidth;
      fighter.classList.add('jump');
      clearTimeout(timers[side]);
      timers[side] = setTimeout(() => {
        fighter.classList.remove('jump');
        delete timers[side];
      }, 1400);
      setVideo(side, 'jump');
    },
    reset() {
      clearJumps();
      for (const side of sides)
        elements.fighters[side].video.dataset.state = '';
    },
    dispose: clearJumps,
  };
}
export type Animations = ReturnType<typeof createAnimations>;
