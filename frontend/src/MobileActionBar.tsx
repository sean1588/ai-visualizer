import { useEffect, useState } from 'react';

import type { DashboardAction } from './actions';
import Menu from './Menu';

export const COMPACT_MQ = '(max-width: 720px)';

export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_MQ).matches);
  useEffect(() => {
    const media = window.matchMedia(COMPACT_MQ);
    const sync = () => setCompact(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return compact;
}

export default function MobileActionBar({ actions }: { actions: DashboardAction[] }) {
  const analyze = actions.find(action => action.id === 'analyze');
  const chef = actions.find(action => action.id === 'chef');
  const exportActions = actions.filter(action => action.group === 'export');
  const moreActions = [
    ...actions.filter(action => action.group === 'data'),
    ...actions.filter(action => action.id === 'present'),
    ...actions.filter(action => action.group === 'history'),
    ...actions.filter(action => action.group === 'analyze'),
  ];

  return (
    <nav id="mobile-action-bar" className="mobile-action-bar" aria-label="Dashboard actions">
      {analyze?.visible && (
        <button id="mobile-analyze" className="btn btn-ghost" type="button" title={analyze.hint} onClick={analyze.run}>Analyze</button>
      )}
      {chef?.visible && (
        <button id="mobile-chef" className="btn btn-ghost" type="button" title={chef.hint} aria-label={chef.label} onClick={chef.run}>Chef</button>
      )}
      <Menu id="mobile-export" label="Export" actions={exportActions} sheet />
      <Menu id="mobile-more" label="More" actions={moreActions} sheet />
    </nav>
  );
}
