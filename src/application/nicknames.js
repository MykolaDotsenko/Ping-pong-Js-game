/**
 * The computer's arcade-club nicknames, in the style of a 90s LAN party sign-in sheet. One is
 * picked per match from the match seed, so a replay meets the same rival. They are at most
 * nine characters, so they fit the scoreboard of a 360px phone, and made up, so they name nobody.
 *
 * @type {readonly string[]}
 */
export const NICKNAMES = Object.freeze([
  'xXx_Pong',
  'Vitalik95',
  'CS_Slayer',
  'NoScope',
  'LagKing',
  'DendyBoss',
  'L33T_Vova',
  'Sn1per_UA',
  'Zheka_PRO',
  'ICQ_Kid',
  'Pashka_2k',
  'HeadSh0t',
  'BOT_Sasha',
  'DialUp56k',
  'DJ_Pixel',
  'Kolyan_HZ',
]);

/**
 * @param {number} seed the match seed
 * @returns {string}
 */
export function nicknameFor(seed) {
  // The seed is any integer; a mix of its bits spreads neighbouring seeds over the list.
  const mixed = Math.imul(Math.trunc(seed) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return NICKNAMES[mixed % NICKNAMES.length];
}
