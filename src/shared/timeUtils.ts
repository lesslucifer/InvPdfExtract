import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

export function formatTime(isoUtc: string): string {
  const d = dayjs.utc(isoUtc).local();
  return d.isValid() ? d.format('HH:mm') : isoUtc;
}

export function formatDuration(startUtcIso: string): string {
  const start = dayjs.utc(startUtcIso);
  if (!start.isValid()) return '--:--';
  const diffSec = Math.max(0, dayjs().diff(start, 'second'));
  const m = Math.floor(diffSec / 60);
  const s = diffSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatStaticDuration(startUtcIso: string, endUtcIso: string): string {
  const start = dayjs.utc(startUtcIso);
  const end = dayjs.utc(endUtcIso);
  if (!start.isValid() || !end.isValid()) return '--:--';
  const diffSec = Math.max(0, end.diff(start, 'second'));
  const m = Math.floor(diffSec / 60);
  const s = diffSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
