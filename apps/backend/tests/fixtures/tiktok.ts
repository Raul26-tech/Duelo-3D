// Synthetic payloads shaped from tiktok-live-connector 2.5.0 / tiktok-live-proto v3.
// No capture from an actual LIVE, user or gift catalog.
export const ROOM = '7312345678901234567';
export const USER = '7212345678901234567';
export const chat = (msgId = '7412345678901234567') => ({
    common: { roomId: ROOM, msgId },
    user: { id: USER },
    content: 'Lula e Flávio — texto integral',
});
export const gift = (count = 1, final = 0, msgId = '7512345678901234567') => ({
    common: { roomId: ROOM, msgId },
    user: { id: USER },
    giftId: '501',
    gift: { id: '501', name: 'Synthetic gift', type: 1, combo: true },
    groupId: '7612345678901234567',
    repeatCount: count,
    repeatEnd: final,
});
