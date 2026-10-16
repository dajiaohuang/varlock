import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { mockWatchFile } = vi.hoisted(() => ({ mockWatchFile: vi.fn() }));
vi.mock('fs', async () => ({
  ...await vi.importActual<typeof import('fs')>('fs'),
  watchFile: mockWatchFile,
}));
vi.mock('varlock/exec-sync-varlock', () => ({
  execSyncVarlock: vi.fn(),
  VarlockExecError: class VarlockExecError extends Error {},
}));
vi.mock('varlock/env', () => ({
  initVarlockEnv: vi.fn(),
  resetRedactionMap: vi.fn(),
}));
vi.mock('varlock/patch-console', () => ({
  patchGlobalConsole: vi.fn(),
  patchProcessStreams: vi.fn(),
}));

describe('extra env file watchers', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'varlock-next-watch-'));
    fs.writeFileSync(path.join(tmpDir, '.env.schema'), '# ---\nPORT=4321\n');
    fs.writeFileSync(path.join(tmpDir, '.env'), 'PORT=4321\n');
    vi.stubEnv('__VARLOCK_NEXT_ENV_WATCHER_PID', '');
    vi.stubEnv('__VARLOCK_ENV', JSON.stringify({
      basePath: tmpDir,
      sources: [],
      settings: {},
      config: {},
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not keep the process alive, but still triggers reloads on content changes', async () => {
    const { loadEnvConfig } = await import('../src/next-env-compat');
    loadEnvConfig(tmpDir, true);

    expect(mockWatchFile).toHaveBeenCalledExactlyOnceWith(
      path.join(tmpDir, '.env.schema'),
      { interval: 500, persistent: false },
      expect.any(Function),
    );

    const triggerPath = path.join(tmpDir, '.env');
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    try {
      fs.writeFileSync(path.join(tmpDir, '.env.schema'), '# ---\nPORT=5432\n');
      mockWatchFile.mock.calls[0][2]();
      vi.advanceTimersByTime(300);
      expect(writeSpy).toHaveBeenCalledWith(triggerPath, 'PORT=4321\n', 'utf-8');
      loadEnvConfig(tmpDir, true);
      expect(mockWatchFile).toHaveBeenCalledTimes(1);
    } finally {
      writeSpy.mockRestore();
    }
  });
});
