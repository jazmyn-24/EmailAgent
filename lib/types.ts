export interface ScoredEmail {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  priority: 1 | 2 | 3;
  reason: string;
}
