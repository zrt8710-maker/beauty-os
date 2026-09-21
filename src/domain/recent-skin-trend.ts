/**
 * Display-safe output from the deterministic recent-trend query.
 * It intentionally contains no evidence mechanics or Profile mutation data.
 */
export type RecentSkinTrend = {
  title: string;
  supporting_line: string;
  detail?: string;
};
