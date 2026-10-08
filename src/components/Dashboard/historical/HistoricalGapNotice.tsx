import { historyGapMessage, type ComparisonMode } from '../../../lib/snapshotPeriods'
import type { SnapshotComparisonCoverage } from '../../../types/dashboard'

interface Props {
  mode: ComparisonMode
  timeZone: string
  coverage: SnapshotComparisonCoverage | null
}

export function HistoricalGapNotice({ mode, timeZone, coverage }: Props) {
  const message = historyGapMessage(
    mode,
    timeZone,
    new Date(),
    coverage
      ? {
          current: {
            from: coverage.current_from,
            to: coverage.current_to,
            requiredDays: coverage.required_days,
            presentDays: coverage.present_days,
            missingDates: [],
            complete: coverage.complete,
          },
          previous: {
            from: coverage.previous_from,
            to: coverage.previous_to,
            requiredDays: 0,
            presentDays: 0,
            missingDates: [],
            complete: coverage.complete,
          },
        }
      : null,
  )

  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      {message}
    </p>
  )
}
