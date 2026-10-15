// The command panel's left-hand menu, grouped by area. AdminPanel builds the
// list (each item can carry a loader and a badge); this only draws it.
export interface AdminSection {
  id: string;
  label: string;
  badge?: number;
  load?: () => unknown;
}

export interface AdminSectionGroup {
  label: string;
  items: AdminSection[];
}

const AdminSidebar = ({
  groups,
  active,
  onSelect,
}: {
  groups: AdminSectionGroup[];
  active: string;
  onSelect: (section: AdminSection) => void;
}) => (
  <nav
    className="w-48 shrink-0 border-r border-[var(--t-line)] bg-[var(--t-panel)] overflow-y-auto py-2"
    aria-label="Admin sections"
  >
    {groups.map((g) => (
      <div key={g.label} className="mb-3">
        <div className="t-mono text-[10px] uppercase tracking-[0.18em] text-[var(--t-dim)] px-4 py-1">{g.label}</div>
        {g.items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            className={`w-full flex items-center justify-between px-4 py-1.5 text-sm border-l-2 ${
              active === item.id
                ? 'border-[var(--t-green)] bg-[var(--t-raise)] text-[var(--t-green)]'
                : 'border-transparent text-[var(--t-text)] hover:bg-[var(--t-panel2)]'
            }`}
          >
            <span>{item.label}</span>
            {(item.badge ?? 0) > 0 && (
              <span className="t-mono text-[10px] px-1.5 bg-[var(--t-amber)] text-black font-bold">{item.badge}</span>
            )}
          </button>
        ))}
      </div>
    ))}
  </nav>
);

export default AdminSidebar;
