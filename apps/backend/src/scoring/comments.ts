import {
    CURRENT_RULES_VERSION,
    type Candidate,
    type RulesVersion,
} from './contracts.ts';

/** Full Unicode words: neither 'flaviolandia' nor 'lula123' is a vote. */
export function interpretComment(
    text: string,
    rulesVersion: RulesVersion = CURRENT_RULES_VERSION,
): Candidate | null {
    const words = new Set(
        text
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .toLowerCase()
            .match(/[\p{L}\p{N}_]+/gu) ?? [],
    );
    const lula =
        words.has('lula') || (rulesVersion === 'scoring-v2' && words.has('13'));
    const flavio =
        words.has('flavio') ||
        (rulesVersion === 'scoring-v2' && words.has('22'));
    return lula === flavio ? null : lula ? 'lula' : 'flavio';
}
