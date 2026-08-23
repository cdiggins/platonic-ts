// The compiler settings a retrofit installs, split into the flags that are
// merged into an existing tsconfig (strictness only — never module/target, which
// are the target repo's business) and the complete file written when there is
// no tsconfig at all.
import type { JsonObject } from '../index.ts'

export const strictCompilerOptions: JsonObject = {
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
  noImplicitOverride: true,
}

export const freshTsconfig: JsonObject = {
  compilerOptions: {
    ...strictCompilerOptions,
    target: 'ES2022',
    lib: ['ES2022'],
    module: 'ESNext',
    moduleResolution: 'Bundler',
    skipLibCheck: true,
    noEmit: true,
  },
}
