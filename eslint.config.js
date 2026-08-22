// Functional-subset lint configuration. Supervisor-owned (protected file).
import tseslint from 'typescript-eslint'
import functional from 'eslint-plugin-functional'

const purityBans = {
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'Ambient impurity: inject randomness.' },
    { object: 'Date', property: 'now', message: 'Ambient impurity: pass `now` as a parameter.' },
    { object: 'process', property: 'env', message: 'Ambient impurity: read env only in composition roots.' },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'fetch', message: 'IO belongs in composition roots or io modules.' },
  ],
  'no-console': 'error',
}

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'docs/**'] },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts'],
  })),
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { functional },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'functional/no-classes': 'error',
      'functional/no-throw-statements': 'error',
      'functional/immutable-data': 'error',
      ...purityBans,
    },
  },
  {
    // Composition roots and IO edges: ambient access allowed, functional rules stay.
    files: ['packages/*/src/main.ts', 'packages/*/src/server.ts', 'packages/*/src/io.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-globals': 'off',
      'no-console': 'off',
      'functional/immutable-data': 'off',
    },
  },
  {
    // Tests: allow ambient access and mutation scaffolding; keep type safety.
    files: ['packages/*/test/**/*.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-globals': 'off',
      'no-console': 'off',
      'functional/immutable-data': 'off',
      'functional/no-throw-statements': 'off',
    },
  },
)
