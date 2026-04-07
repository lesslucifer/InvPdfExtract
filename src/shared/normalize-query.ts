export function normalizeQuery(s: string): string {
  return s
    .replace(/[đĐ]/g, m => (m === 'đ' ? 'd' : 'D'))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
