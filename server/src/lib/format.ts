// hours.toFixed(1) rounds quarter-hour increments oddly (0.25 -> "0.3", 0.75 -> "0.8") since
// they don't divide evenly into tenths. Round to 2 decimals instead, which is exact for the
// 0.25 step used everywhere hours are logged, and drop trailing zeros for clean whole/half values.
export function formatHours(hours: number): string {
  return (Math.round(hours * 100) / 100).toString();
}
