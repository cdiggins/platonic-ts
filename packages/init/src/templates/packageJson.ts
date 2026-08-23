// The `package.json` entries a retrofit contributes. `observe` contributes
// nothing runnable: it is a measurement profile, so it must not add a script
// that can fail.
import type { JsonObject, StrictnessProfile } from '../index.ts'

export const platonicScripts = (profile: StrictnessProfile): JsonObject =>
  profile === 'observe'
    ? {}
    : {
        typecheck: 'tsc --noEmit',
        lint: 'eslint .',
        check: 'npm run typecheck && npm run lint',
      }

export const platonicDevDependencies = (profile: StrictnessProfile): JsonObject =>
  profile === 'observe'
    ? {}
    : profile === 'standard'
      ? { eslint: '^10.9.0', typescript: '^5.6.0', 'typescript-eslint': '^8.67.0' }
      : {
          eslint: '^10.9.0',
          'eslint-plugin-functional': '^10.0.0',
          typescript: '^5.6.0',
          'typescript-eslint': '^8.67.0',
        }

export const freshPackageJson = (profile: StrictnessProfile): JsonObject => ({
  name: 'retrofitted-repo',
  private: true,
  type: 'module',
  scripts: platonicScripts(profile),
  devDependencies: platonicDevDependencies(profile),
})
