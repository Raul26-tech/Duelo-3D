export const sides = ['a', 'b'] as const;
export type Side = (typeof sides)[number];
export type AnimationState = 'happy' | 'sad' | 'jump';
export const participants = {
    a: {
        name: 'Lula',
        videos: {
            happy: 'lula-feliz.webm',
            sad: 'lula-triste.webm',
            jump: 'lula-pulando.webm',
        },
    },
    b: {
        name: 'Flávio Bolsonaro',
        videos: {
            happy: 'flavio-feliz.webm',
            sad: 'flavio-triste.webm',
            jump: 'flavio-pulando.webm',
        },
    },
} as const;
