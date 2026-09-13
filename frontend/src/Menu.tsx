import { useEffect, useRef, type KeyboardEvent, type RefObject, type SyntheticEvent } from 'react';

import { actionElementId, type DashboardAction } from './actions';

export function closeOpenMenus(except?: HTMLElement | null) {
  document.querySelectorAll<HTMLDetailsElement>('details.menu[open], details.recipe-history[open]').forEach(other => {
    if (other !== except) other.removeAttribute('open');
  });
}

export function useMenu(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const details = ref.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.removeAttribute('open');
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [ref]);

  const close = () => {
    const details = ref.current;
    if (!details) return;
    details.removeAttribute('open');
    details.querySelector<HTMLElement>('summary')?.focus();
  };
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open) return;
    closeOpenMenus(event.currentTarget);
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
  return { close, handleToggle, handleKeyDown };
}

export default function Menu({ id, label, actions, sheet = false }: { id: string; label: string; actions: DashboardAction[]; sheet?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const { close, handleToggle, handleKeyDown } = useMenu(ref);
  const items = actions.filter(action => action.visible);

  if (!items.length) return null;

  return (
    <details className={sheet ? 'menu menu-sheet' : 'menu'} ref={ref} onToggle={handleToggle} onKeyDown={handleKeyDown}>
      <summary id={id} className="btn btn-ghost" aria-haspopup="menu">{label}{!sheet && <span className="menu-caret" aria-hidden="true">▾</span>}</summary>
      {sheet && <button type="button" className="menu-backdrop" aria-label="Close menu" tabIndex={-1} onClick={close} />}
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
