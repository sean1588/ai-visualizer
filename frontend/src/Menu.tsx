import { useEffect, useRef, type KeyboardEvent, type SyntheticEvent } from 'react';

import { actionElementId, type DashboardAction } from './actions';

export default function Menu({ id, label, actions }: { id: string; label: string; actions: DashboardAction[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const items = actions.filter(action => action.visible);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const details = ref.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.removeAttribute('open');
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  if (!items.length) return null;

  const close = () => {
    const details = ref.current;
    if (!details) return;
    details.removeAttribute('open');
    details.querySelector<HTMLElement>('summary')?.focus();
  };
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open) return;
    document.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach(other => {
      if (other !== event.currentTarget) other.removeAttribute('open');
    });
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
    const details = ref.current;
    if (!details?.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const buttons = Array.from(details.querySelectorAll<HTMLButtonElement>('.menu-list button:not(:disabled)'));
      if (!buttons.length) return;
      const index = buttons.findIndex(button => button === document.activeElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length].focus();
    }
  };

  return (
    <details className="menu" ref={ref} onToggle={handleToggle} onKeyDown={handleKeyDown}>
      <summary id={id} className="btn btn-ghost" aria-haspopup="menu">{label}<span className="menu-caret" aria-hidden="true">▾</span></summary>
      <div className="menu-list" role="menu" aria-labelledby={id}>
        {items.map(action => (
          <button
            key={action.id}
            id={actionElementId(action)}
            type="button"
            role="menuitem"
            className={action.attention ? 'has-alert' : undefined}
            disabled={!action.enabled}
            title={action.hint}
            onClick={() => { close(); action.run(); }}
          >
            <span>{action.label}</span>
            {action.shortcut && <kbd>{action.shortcut}</kbd>}
          </button>
        ))}
      </div>
    </details>
  );
}
