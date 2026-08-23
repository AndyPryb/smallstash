/**
 * Client-side password generator - open question #6 in
 * docs/open-questions.md ("include in v1 - client-side-only, low effort,
 * users expect it from a password manager"). Pure and dependency-free like
 * the rest of lib/, uses crypto.getRandomValues() directly rather than
 * Math.random() - a password generator that isn't cryptographically random
 * defeats its own purpose.
 */

const CHARSETS = {
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}:;,.<>?/~',
};

/** Characters that are easy to mis-transcribe by hand or misread on screen. */
const AMBIGUOUS_PATTERN = /[Il1O0]/g;

/**
 * @typedef {object} PasswordOptions
 * @property {number} [length]
 * @property {boolean} [lowercase]
 * @property {boolean} [uppercase]
 * @property {boolean} [digits]
 * @property {boolean} [symbols]
 * @property {boolean} [excludeAmbiguous] strip I/l/1/O/0 from every selected set
 */

/**
 * @param {PasswordOptions} [options]
 * @returns {string}
 */
export function generatePassword({
  length = 20,
  lowercase = true,
  uppercase = true,
  digits = true,
  symbols = true,
  excludeAmbiguous = false,
} = {}) {
  const selectedCharsets = [
    lowercase && CHARSETS.lowercase,
    uppercase && CHARSETS.uppercase,
    digits && CHARSETS.digits,
    symbols && CHARSETS.symbols,
  ].filter(Boolean);

  if (selectedCharsets.length === 0) {
    throw new Error('At least one character type must be enabled');
  }

  const pools = excludeAmbiguous
    ? selectedCharsets.map((set) => set.replace(AMBIGUOUS_PATTERN, ''))
    : selectedCharsets;

  if (pools.some((pool) => pool.length === 0)) {
    throw new Error('No characters left in a selected set after excluding ambiguous characters');
  }

  if (length < pools.length) {
    throw new Error(
      `Password length must be at least ${pools.length} to include one character from each selected type`,
    );
  }

  const alphabet = pools.join('');

  // Guarantee at least one character from each selected pool (so "must
  // contain a symbol"-style site policies are satisfied), fill the rest from
  // the combined alphabet, then shuffle - otherwise the guaranteed
  // characters would always land in the first few positions, which is
  // structure an attacker doesn't need to guess.
  const chars = pools.map((pool) => pool[randomIndex(pool.length)]);
  while (chars.length < length) {
    chars.push(alphabet[randomIndex(alphabet.length)]);
  }
  shuffle(chars);

  return chars.join('');
}

/**
 * Uniform random integer in [0, max) via rejection sampling.
 * `crypto.getRandomValues()` bytes are uniform over [0, 256), but
 * `byte % max` is NOT uniform unless max divides 256 evenly - e.g. for
 * max=26 (the lowercase alphabet), bytes 0-3 (values 0-3 after %26) would
 * otherwise occur more often than bytes 4-25's residues. Rejecting draws
 * that fall in the leftover, not-evenly-divisible tail keeps every output
 * value equally likely.
 *
 * @param {number} max in (0, 256]
 */
function randomIndex(max) {
  if (max <= 0 || max > 256) {
    throw new Error(`randomIndex: max must be in (0, 256], got ${max}`);
  }
  const rejectionThreshold = 256 - (256 % max);
  const buf = new Uint8Array(1);
  let value;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= rejectionThreshold);
  return value % max;
}

/** Fisher-Yates shuffle, in place, using the same unbiased randomIndex(). */
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
}
