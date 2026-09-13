import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';

import { ACTION_GROUP_LABELS, type ActionGroup, type DashboardAction } from './actions';
import { CloseButton, useDialog } from './InsightsDialogs';

const GROUP_ORDER: ActionGroup[] = ['view', 'analyze', 'data', 'export', 'history'];

export default function CommandPalette({
  open,
  actions,
  onClose,
}: {
  open: boolean;
  actions: DashboardAction[];
  onClose: () => void;
}) {
  const ref = useDialog(open);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const available = actions.filter(action => action.visible && action.enabled && (
      !needle || action.label.toLowerCase().includes(needle) || (action.hint || '').toLowerCase().includes(needle)
    ));
    return GROUP_ORDER.flatMap(group => available.filter(action => action.group === group));
  }, [actions, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    window.setTimeout(() => document.getElementById('command-input')?.focus(), 0);
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    document.getElementById(`command-${items[selected]?.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [items, selected]);

  const run = (action: DashboardAction) => {
    ref.current?.close();
    action.run();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (items.length) setSelected(current => (current + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length) setSelected(current => (current - 1 + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const action = items[selected];
      if (action) run(action);
    }
  };

  let lastGroup: ActionGroup | null = null;
  return (
    <dialog id="command-palette" className="mise-dialog command-palette" ref={ref} aria-labelledby="command-palette-title" onClose={onClose}>
      <div className="dialog-head">
        <div><div className="eyebrow eyebrow-accent">Command palette</div><h2 id="command-palette-title">What next?</h2></div>
        <CloseButton onClose={() => ref.current?.close()} />
      </div>
      <div className="dialog-body">
        <input
          id="command-input"
          className="command-input"
          type="search"
          role="combobox"
          aria-label="Search actions"
          aria-expanded={items.length > 0}
          aria-controls="command-list"
          aria-activedescendant={items[selected] ? `command-${items[selected].id}` : undefined}
          autoComplete="off"
          placeholder="Type an action… e.g. export, brief, present"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <ul id="command-list" className="command-list" role="listbox" aria-label="Actions">
          {items.map((action, index) => {
            const heading = action.group !== lastGroup ? <li className="command-group" role="presentation" key={`group-${action.group}`}>{ACTION_GROUP_LABELS[action.group]}</li> : null;
            lastGroup = action.group;
            return [
              heading,
              <li
                key={action.id}
                id={`command-${action.id}`}
                className="command-item"
                role="option"
                aria-selected={index === selected}
                onMouseEnter={() => setSelected(index)}
                onClick={() => run(action)}
              >
                <span><strong>{action.label}</strong>{action.hint && <small>{action.hint}</small>}</span>
                {action.shortcut && <kbd>{action.shortcut}</kbd>}
              </li>,
            ];
          })}
          {!items.length && <li className="command-empty" role="presentation">No actions match “{query}”.</li>}
        </ul>
      </div>
    </dialog>
  );
}
