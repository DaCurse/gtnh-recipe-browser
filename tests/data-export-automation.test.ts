import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('unattended NESQL export overlay', () => {
  it('is opt-in and drives a disposable integrated client without UI automation', async () => {
    const source = await readFile(
      'tools/data-export/overlay/ExportAutomationController.java',
      'utf8'
    );

    expect(source).toContain('nesql.automation.enabled');
    expect(source).toContain('nesql.automation.seed');
    expect(source).toContain('8675309');
    expect(source).toContain('if (!Boolean.parseBoolean');
    expect(source).toContain('minecraft.launchIntegratedServer');
    expect(source).toContain('WorldSettings.GameType.CREATIVE');
    expect(source).toContain('WorldType.FLAT');
    expect(source).toContain('ItemList.loadItems()');
    expect(source).toContain('ItemList.loadFinished');
    expect(source).not.toContain('java.awt.Robot');
  });

  it('normalizes static player state and emits a durable terminal status', async () => {
    const source = await readFile(
      'tools/data-export/overlay/ExportAutomationController.java',
      'utf8'
    );

    expect(source).toContain('/tc research ');
    expect(source).toContain('/tc aspect ');
    expect(source).toContain('/tc warp ');
    expect(source).toContain('new Exporter(true, repositoryName).exportReportException()');
    expect(source).toContain('browser-nei-special.json');
    expect(source).toContain('StandardCopyOption.ATOMIC_MOVE');
    expect(source).toContain('writeStatus(Phase.COMPLETE');
    expect(source).toContain('writeStatus(Phase.FAILED');
    expect(source).toContain('minecraft.shutdown()');
  });

  it('keeps the upstream exporter immutable through a disposable patch', async () => {
    const patch = await readFile(
      'tools/data-export/patches/export-automation.patch',
      'utf8'
    );

    expect(patch).toContain('ExportAutomationController.install()');
    expect(patch).not.toContain('nesql-exporter@ShadowTheAge/');
  });
});
