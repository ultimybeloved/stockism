// The admin panel's tab pills. Split out of AdminPanel.tsx, which was past the
// 400-line component limit. AdminPanel builds the list (each tab can carry a
// loader and a badge count); this only draws it.
export interface AdminTab {
  id: string;
  icon: string;
  label: string;
  badge?: number;
  load?: () => unknown;
}

interface AdminTabBarProps {
  tabs: AdminTab[];
  activeTab: string;
  setActiveTab: (id: string) => void;
  mutedClass: string;
}

const AdminTabBar = ({ tabs, activeTab, setActiveTab, mutedClass }: AdminTabBarProps) => (
  <div className="px-3 py-2.5 border-b light:border-slate-200 dark:border-slate-700">
    <div className="flex flex-wrap gap-1.5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => {
            setActiveTab(tab.id);
            if (tab.load) tab.load();
          }}
          className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
            activeTab === tab.id
              ? 'bg-teal-600 text-white'
              : `${mutedClass} light:bg-slate-100 light:hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700`
          }`}
        >
          {tab.icon} {tab.label}
          {(tab.badge ?? 0) > 0 ? ` (${tab.badge})` : ''}
        </button>
      ))}
    </div>
  </div>
);

export default AdminTabBar;
