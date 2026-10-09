// Admin-only switch between the board everyone sees and the same board with
// margin debt taken off. Renders nothing for normal players.
//
// The public board ranks on gross value, so a player holding $5M against $2M of
// borrowed money outranks someone who owns $4M outright. This shows who is
// actually ahead.
interface AdminNetToggleProps {
  isAdmin: boolean;
  netMode: boolean;
  setNetMode: (on: boolean) => void;
  loading: boolean;
}

const AdminNetToggle = ({ isAdmin, netMode, setNetMode, loading }: AdminNetToggleProps) => {
  if (!isAdmin) return null;

  return (
    <button
      onClick={() => setNetMode(!netMode)}
      className={`mt-2 w-full py-1.5 text-xs font-semibold rounded-sm transition-colors ${
        netMode
          ? 'bg-red-600 text-white'
          : 'light:bg-slate-200 light:text-zinc-600 light:hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
      }`}
      title="Admin only. Ranks on net worth instead of the public gross figure."
    >
      {loading
        ? 'Loading margin data...'
        : netMode
          ? '👁️ Admin view: margin debt removed'
          : '👁️ Admin view: show without margin'}
    </button>
  );
};

export default AdminNetToggle;
