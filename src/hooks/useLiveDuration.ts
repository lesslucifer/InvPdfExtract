import { useState, useEffect } from 'react';
import { formatDuration } from '../shared/timeUtils';

export function useLiveDuration(hasActiveItems: boolean): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!hasActiveItems) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasActiveItems]);

  return tick;
}

export { formatDuration };
