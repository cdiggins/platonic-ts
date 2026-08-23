// The flat ESLint config a retrofit installs, as source text rather than a
// value: the target repo needs a file it can read and edit, and a JS config is
// not JSON, so there is nothing to merge key-by-key. `standard` installs type
// safety only; `full` adds the functional subset and the purity bans, with the
// same three zones this repo uses (core / composition roots / tests) but
// generalized to any layout.
import type { StrictnessProfile } from '../index.ts'

const header = `// Installed by \`platonic init\`. Edit freely — it is yours now.
import tseslint from 'typescript-eslint'
`

const functionalImport = `import functional from 'eslint-plugin-functional'
`

const preamble = `
export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**'] },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
`

const standardRules = `    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
)
`

const fullRules = `    plugins: { functional },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'functional/no-classes': 'error',
      'functional/no-throw-statements': 'error',
      'functional/immutable-data': 'error',
      'no-console': 'error',
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Ambient impurity: inject randomness.' },
        { object: 'Date', property: 'now', message: 'Ambient impurity: pass \`now\` as a parameter.' },
        { object: 'process', property: 'env', message: 'Ambient impurity: read env in composition roots.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'IO belongs in composition roots or io modules.' },
      ],
    },
  },
  {
    // Composition roots and IO edges: ambient access allowed, functional rules stay.
    files: ['**/main.ts', '**/server.ts', '**/io.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-globals': 'off',
      'no-console': 'off',
      'functional/immutable-data': 'off',
    },
  },
  {
    // Tests: ambient access and mutation scaffolding allowed; type safety stays.
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-globals': 'off',
      'no-console': 'off',
      'functional/immutable-data': 'off',
      'functional/no-throw-statements': 'off',
    },
  },
)
`

export const eslintConfigContent = (profile: StrictnessProfile): string =>
  profile === 'full'
    ? `${header}${functionalImport}${preamble}${fullRules}`
    : `${header}${preamble}${standardRules}`
