const sharedRules = {
  'constructor-super': 'error',
  'eqeqeq': ['error', 'always'],
  'no-constant-binary-expression': 'error',
  'no-debugger': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-dupe-else-if': 'error',
  'no-dupe-keys': 'error',
  'no-fallthrough': 'error',
  'no-irregular-whitespace': 'error',
  'no-new-native-nonconstructor': 'error',
  'no-obj-calls': 'error',
  'no-promise-executor-return': 'error',
  'no-self-assign': 'error',
  'no-setter-return': 'error',
  'no-sparse-arrays': 'error',
  'no-unexpected-multiline': 'error',
  'no-unreachable': 'error',
  'no-undef': 'error',
  'no-unreachable-loop': 'error',
  'no-unused-labels': 'error',
  'no-unused-private-class-members': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  'no-useless-backreference': 'error',
  'no-useless-catch': 'error',
  'no-useless-escape': 'error',
  'no-with': 'error',
  'require-yield': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
};

const nodeGlobals = {
  console: 'readonly',
  process: 'readonly',
  fetch: 'readonly',
  structuredClone: 'readonly',
  Event: 'readonly',
  EventTarget: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  HTMLElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLCanvasElement: 'readonly',
};

// The core is deterministic: no host APIs, no clock, no randomness. Host globals such as
// window or setTimeout are already undefined here because no globals are declared for it.
const deterministicCoreRules = {
  'no-restricted-globals': [
    'error',
    { name: 'globalThis', message: 'The core must not reach host globals; inject what it needs.' },
    { name: 'Date', message: 'The core must not read the clock; time arrives as deltaSeconds.' },
  ],
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message: 'Keep the simulation deterministic; inject a seeded random source instead.',
    },
  ],
};

export default [
  {
    ignores: ['node_modules/**', 'playwright-report/**', 'test-results/**', 'coverage/**'],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {},
    },
    rules: sharedRules,
  },
  {
    files: ['*.config.js', 'scripts/**', 'tests/**', 'e2e/**'],
    languageOptions: { globals: nodeGlobals },
  },
  {
    // Callbacks passed to page.evaluate() run in the browser.
    files: ['e2e/**'],
    languageOptions: { globals: { ...browserGlobals, MutationObserver: 'readonly', setTimeout: 'readonly' } },
  },
  {
    // Only the composition root touches browser globals; adapters receive them injected.
    files: ['script.js'],
    languageOptions: { globals: browserGlobals },
  },
  {
    files: ['src/domain/**/*.js'],
    rules: {
      ...deterministicCoreRules,
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '(^|/)(application|adapters)/',
          message: 'The domain must not depend on the application layer or on adapters.',
        }],
      }],
    },
  },
  {
    files: ['src/application/**/*.js'],
    rules: {
      ...deterministicCoreRules,
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '(^|/)adapters/',
          message: 'The application core must not depend on adapters.',
        }],
      }],
    },
  },
];
