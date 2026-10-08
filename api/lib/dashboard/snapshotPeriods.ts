// Espelho do frontend. A implementação fica em src/lib/snapshotPeriods.ts.
export {
  UTC_SNAPSHOT_BASIS,
  SnapshotCalendarGap,
  addCivilDays,
  civilDaysInclusive,
  companyCivilDate,
  comparisonCoverage,
  compatibleSnapshotWindow,
  coverageOfDates,
  flowOnGeneratedDay,
  getComparisonPeriods,
  getComparisonLabel,
  getLastNDays,
  normalizeSnapshotTimeZone,
  requireCompatibleSnapshot,
  snapshotKeysCollide,
} from '../../../src/lib/snapshotPeriods.js'

export { getComparisonPeriods as resolveComparisonPeriods } from '../../../src/lib/snapshotPeriods.js'

export type {
  ComparisonCoverage,
  ComparisonMode,
  ComparisonPeriods,
  DateCoverage,
  DatedSnapshot,
  SnapshotKey,
} from '../../../src/lib/snapshotPeriods.js'
