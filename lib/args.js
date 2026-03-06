/**
 * Minimal CLI arg parser.
 * Converts: --foo bar --baz => { foo: 'bar', baz: true }
 */
export const parseArgs = (argv) => {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
};
