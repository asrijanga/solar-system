import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Proves the lint rule that keeps core/ free of three.js actually fires,
// by linting a deliberately bad file as if it lived in core/.
const eslint = new ESLint();

async function restrictedImportErrors(code: string, filePath: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.filter((m) => m.ruleId === 'no-restricted-imports').length ?? -1;
}

describe('core/ boundary', () => {
  it('rejects importing three from core/', async () => {
    const code = "import { Vector3 } from 'three';\nexport const v = new Vector3();\n";
    expect(await restrictedImportErrors(code, 'src/core/fixture.ts')).toBe(1);
  });

  it('rejects three subpaths such as three/webgpu from core/', async () => {
    const code = "import { Color } from 'three/webgpu';\nexport const c = new Color();\n";
    expect(await restrictedImportErrors(code, 'src/core/fixture.ts')).toBe(1);
  });

  it('allows three outside core/', async () => {
    const code = "import { Vector3 } from 'three';\nexport const v = new Vector3();\n";
    expect(await restrictedImportErrors(code, 'src/gpu/fixture.ts')).toBe(0);
  });
});
