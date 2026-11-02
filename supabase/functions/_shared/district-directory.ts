export const DISTRICT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1BaB7mUx71IrIMWo_MCEcPa2qncPRAxpd0xRsEociUGA/export?format=csv&gid=1636773863';
export interface DirectoryDistrict { id: string; coordinatorName: string | null; conflict: boolean }
export interface DistrictDirectory { districts: DirectoryDistrict[]; updated: string; sourceStatus: 'ok' | 'stale' }


export function isDistrictDirectory(value: unknown): value is DistrictDirectory {
  if (!value || typeof value !== 'object') return false;
  const data = value as DistrictDirectory;
  return ['ok', 'stale'].includes(data.sourceStatus) && typeof data.updated === 'string' && Number.isFinite(Date.parse(data.updated)) && Array.isArray(data.districts) && data.districts.length > 0 && data.districts.every(d => /^(11[89]|12[0-9])$/.test(d.id) && (d.coordinatorName === null || typeof d.coordinatorName === 'string') && typeof d.conflict === 'boolean');
}

// Spreadsheet display names never grant or reassign an account's coordinator role.
export function resolveCoordinator(savedName: string | null | undefined, registeredName: string | undefined, entry?: DirectoryDistrict) {
  if (registeredName) return { name: registeredName, source: 'profile' as const };
  if (entry) return { name: entry.coordinatorName, source: entry.conflict ? 'conflict' as const : 'sheet' as const };
  return { name: savedName ?? null, source: 'saved' as const };
}
