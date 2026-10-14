export interface Order {
  id: string;
  // ISO date, like 2026-10-14.
  date: string;
  amountCents: number;
}
