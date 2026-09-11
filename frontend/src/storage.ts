import type {
  DashboardRecipe,
  DataSource,
  DatasetSnapshot,
  ParseHealth,
  Row,
  SchemaColumn,
} from './domain';

const STORAGE_KEY = 'mise.recents.v1';
const LEGACY_STORAGE_KEY = 'visualizer.recents.v1';
const RECENT_LIMIT = 12;

export interface RecentDashboard {
  id: string;
  title: string;
  rows: Row[];
  schema: SchemaColumn[];
  recipe: DashboardRecipe;
  dataSource: DataSource | null;
  parseHealth: ParseHealth | null;
  previousSnapshot?: DatasetSnapshot | null;
  updatedAt?: number;
  savedAt: number;
  cols: number;
}

export function migrateLegacyStorage(): void {
  try {
    if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem(LEGACY_STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, localStorage.getItem(LEGACY_STORAGE_KEY) || '[]');
    }
  } catch {
    return;
  }
}

export function loadRecents(): RecentDashboard[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as unknown;
    return Array.isArray(value) ? value as RecentDashboard[] : [];
  } catch {
    return [];
  }
}

export function saveRecent(entry: RecentDashboard): RecentDashboard[] {
  const entries = loadRecents().filter(candidate => candidate.id !== entry.id);
  entries.unshift(entry);
  const limited = entries.slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(limited));
  } catch {
    return entries;
  }
  return limited;
}

export function clearRecents(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}

export function relativeTime(timestamp: number): string {
  const difference = (Date.now() - timestamp) / 1000;
  if (difference < 60) return 'just now';
  if (difference < 3600) return `${Math.floor(difference / 60)}m ago`;
  if (difference < 86400) return `${Math.floor(difference / 3600)}h ago`;
  if (difference < 604800) return `${Math.floor(difference / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
