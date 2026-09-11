import type {
  DashboardRecipe,
  DataAuditEntry,
  DataSource,
  DatasetSnapshot,
  ParseHealth,
  RenderedWidget,
  Row,
  SchemaColumn,
  SchemaOverrides,
} from './domain';
import type { RecentDashboard } from './storage';

export type Stage = 'empty' | 'loading' | 'dash';
export type LoadingStep = 'parse' | 'infer' | 'layout' | 'render';
export type StepStatus = 'pending' | 'active' | 'done';

export interface ChefMessage {
  role: 'user' | 'chef' | 'error';
  content: string;
  changes?: string[];
  previousRecipe?: DashboardRecipe;
  undone?: boolean;
}

export interface InspectorState {
  widget: RenderedWidget;
  rows: Row[];
  selectedValue: unknown | null;
}

export interface AppState {
  stage: Stage;
  rows: Row[];
  schema: SchemaColumn[];
  recipe: DashboardRecipe | null;
  id: string | null;
  title: string;
  dataSource: DataSource | null;
  sourceText: string;
  notes: string;
  parseHealth: ParseHealth | null;
  schemaOverrides: SchemaOverrides;
  dataAudit: DataAuditEntry[];
  previousSnapshot: DatasetSnapshot | null;
  updatedAt: number | null;
  pendingRecipe: DashboardRecipe<unknown> | null;
  excludeOutliers: boolean;
  recents: RecentDashboard[];
  error: string;
  statusMessage: string | null;
  statusError: boolean;
  refreshing: boolean;
  loadingSteps: Record<LoadingStep, StepStatus>;
  loadingLabel: string;
  chefOpen: boolean;
  chefThinking: boolean;
  chefHistory: ChefMessage[];
  changedWidgets: Set<string>;
  assumptionsWidgetIndex: number | null;
  inspector: InspectorState | null;
  healthOpen: boolean;
}

export const initialSteps: Record<LoadingStep, StepStatus> = {
  parse: 'pending',
  infer: 'pending',
  layout: 'pending',
  render: 'pending',
};

export function createInitialState(recents: RecentDashboard[] = []): AppState {
  return {
    stage: 'empty',
    rows: [],
    schema: [],
    recipe: null,
    id: null,
    title: 'Untitled dashboard',
    dataSource: null,
    sourceText: '',
    notes: '',
    parseHealth: null,
    schemaOverrides: {},
    dataAudit: [],
    previousSnapshot: null,
    updatedAt: null,
    pendingRecipe: null,
    excludeOutliers: true,
    recents,
    error: '',
    statusMessage: null,
    statusError: false,
    refreshing: false,
    loadingSteps: { ...initialSteps },
    loadingLabel: 'data · — rows · — cols',
    chefOpen: false,
    chefThinking: false,
    chefHistory: [],
    changedWidgets: new Set(),
    assumptionsWidgetIndex: null,
    inspector: null,
    healthOpen: false,
  };
}

export type AppAction =
  | { type: 'patch'; value: Partial<AppState> }
  | { type: 'reset'; recents: RecentDashboard[] }
  | { type: 'step'; step: LoadingStep; status: StepStatus }
  | { type: 'chef-message'; message: ChefMessage }
  | { type: 'replace-chef-history'; history: ChefMessage[] };

export function appReducer(state: AppState, action: AppAction): AppState {
  if (action.type === 'patch') return { ...state, ...action.value };
  if (action.type === 'reset') return createInitialState(action.recents);
  if (action.type === 'step') {
    return {
      ...state,
      loadingSteps: { ...state.loadingSteps, [action.step]: action.status },
    };
  }
  if (action.type === 'chef-message') {
    return { ...state, chefHistory: [...state.chefHistory, action.message] };
  }
  return { ...state, chefHistory: action.history };
}
