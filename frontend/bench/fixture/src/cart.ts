export interface Line {
  sku: string;
  priceCents: number;
  quantity: number;
}

export function total(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + line.priceCents, 0);
}
