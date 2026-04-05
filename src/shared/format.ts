const formatter = new Intl.NumberFormat('vi-VN');

export function formatCurrency(
  amount: number,
  opts?: { abbreviated?: boolean },
): string {
  if (!amount) return '-';

  if (opts?.abbreviated) {
    if (amount >= 1_000_000_000 && amount % 1_000_000_000 === 0) {
      return `${amount / 1_000_000_000}t`;
    }
    if (amount >= 1_000_000 && amount % 1_000_000 === 0) {
      return `${amount / 1_000_000}tr`;
    }
    if (amount >= 1_000 && amount % 1_000 === 0) {
      return `${amount / 1_000}k`;
    }
  }

  return formatter.format(amount);
}
