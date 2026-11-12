import type { QuestItemReference } from '../questbook/references';

export interface QuestExportReport {
  schemaVersion: number;
  version: string;
  references: { id: string; status: 'resolved' | 'unavailable'; goodsIds: string[]; reason?: string }[];
}
export function validateQuestExport(requests: readonly QuestItemReference[], report: QuestExportReport, version: string): void {
  if (report.schemaVersion !== 1 || report.version !== version || !Array.isArray(report.references)) throw new Error('Invalid quest item export identity');
  const expected = new Set(requests.map(request => request.id));
  if (!expected.size || expected.size !== requests.length) throw new Error('Quest inventory is empty or duplicated');
  const seen = new Set<string>();
  for (const reference of report.references) {
    if (!expected.has(reference.id) || seen.has(reference.id)) throw new Error(`Unexpected or duplicate quest export reference: ${reference.id}`);
    seen.add(reference.id);
    if (!Array.isArray(reference.goodsIds) || reference.goodsIds.some(id => !/^(?:i:|f:|o:)/.test(id))) throw new Error(`Invalid quest goods IDs: ${reference.id}`);
    if (reference.status === 'resolved' ? !reference.goodsIds.length || Boolean(reference.reason)
      : reference.status !== 'unavailable' || reference.goodsIds.length > 0 || !reference.reason) throw new Error(`Invalid quest resolution: ${reference.id}`);
  }
  if (seen.size !== expected.size) throw new Error(`Quest export omitted ${expected.size - seen.size} stack references`);
}

export function validateQuestGoods(report: QuestExportReport, available: ReadonlySet<string>): void {
  for (const reference of report.references) for (const id of reference.goodsIds) {
    if (!available.has(id)) throw new Error(`Quest item was exported but not retained: ${reference.id} → ${id}`);
  }
}
