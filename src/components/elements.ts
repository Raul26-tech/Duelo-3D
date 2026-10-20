import { sides, type Side } from '../config/participants.ts';
export function getElements(root: Document) {
  function requireElement<T extends HTMLElement>(id: string): T {
    const element = root.getElementById(id);
    if (!element) throw new Error(`Elemento obrigatório ausente: ${id}`);
    return element as T;
  }
  const fighters = {} as Record<
    Side,
    {
      score: HTMLElement;
      bar: HTMLElement;
      status: HTMLElement;
      fighter: HTMLElement;
      video: HTMLVideoElement;
      vote: HTMLButtonElement;
    }
  >;
  for (const side of sides)
    fighters[side] = {
      score: requireElement(`score-${side}`),
      bar: requireElement(`bar-${side}`),
      status: requireElement(`status-${side}`),
      fighter: requireElement(`fighter-${side}`),
      video: requireElement(`video-${side}`),
      vote: requireElement(`vote-${side}`),
    };
  return { fighters, reset: requireElement<HTMLButtonElement>('reset') };
}
export type Elements = ReturnType<typeof getElements>;
