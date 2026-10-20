import type { Candidate } from './contracts.ts';

/** Full Unicode words: neither 'flaviolandia' nor 'lula123' is a vote. */
export function interpretComment(text: string): Candidate | null {
    const words = new Set(
        text
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .toLowerCase()
            .match(/[\p{L}\p{N}_]+/gu) ?? [],
    );
    const lula = words.has('lula');
    const flavio = words.has('flavio');
    return lula === flavio ? null : lula ? 'lula' : 'flavio';
}
