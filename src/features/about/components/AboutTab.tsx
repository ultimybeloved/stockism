import { getThemeClasses } from '../../../utils/theme';
import { useTheme, useSession } from '../../../context/AppContext';

// The About tab: what the game is, who made it, and where the community is.
const AboutTab = () => {
  const { darkMode } = useTheme();
  const { userData } = useSession();
  const { textClass, mutedClass } = getThemeClasses(darkMode);

  return (
    <div className={`space-y-4 ${textClass}`}>
      <div>
        <h3 className="font-semibold text-orange-500 mb-2">What is Stockism?</h3>
        <p className={mutedClass}>
          Stockism is a free fan-made stock market simulation game based on the Lookism webtoon universe. Trade
          fictional characters like stocks, predict story outcomes, and compete on the leaderboard!
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-2">How does it work?</h3>
        <p className={mutedClass}>
          Each character has a stock price that changes based on player trading activity. Buy low, sell high, and use
          your knowledge of the webtoon to make smart investments. You can also bet on weekly predictions about upcoming
          chapters.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-2">Is real money involved?</h3>
        <p className={mutedClass}>
          <span className={`font-semibold ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>
            Absolutely not.
          </span>{' '}
          Stockism uses entirely fictional currency. You start with $1,000 of fake money, raised to $3,000 when you link
          Discord, and can earn more through daily check-ins. There is no way to deposit, withdraw, or exchange real
          money. This is purely for fun!
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-2">Who made this?</h3>
        <p className={mutedClass}>
          Stockism was created by{' '}
          <a
            href="https://github.com/UltiMyBeloved"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-500 hover:text-orange-400 underline"
          >
            Darth YG
          </a>{' '}
          for the Lookism community. It's a free, open-source project with no ads or monetization.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-2">Join the Community</h3>
        <div className="flex gap-3">
          <a
            href="https://discord.gg/hpVm8nQMvY"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2 px-3 py-2 rounded ${darkMode ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-indigo-500 hover:bg-indigo-600'} text-white text-sm font-medium`}
          >
            Discord
          </a>
          <a
            href="https://reddit.com/r/stockismapp"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2 px-3 py-2 rounded ${darkMode ? 'bg-orange-600 hover:bg-orange-500' : 'bg-orange-500 hover:bg-orange-600'} text-white text-sm font-medium`}
          >
            Reddit
          </a>
        </div>

        {/* Live Discord widget. Loads from discord.com only when this tab is open. */}
        <div className="mt-3 w-full max-w-[350px]">
          <iframe
            src="https://discord.com/widget?id=1466532292242702452&theme=dark"
            title="Stockism Discord"
            width="350"
            height="500"
            frameBorder="0"
            sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
            className="w-full rounded"
          />
          <p className={`text-xs ${mutedClass} mt-1`}>
            This widget loads live from Discord, so opening it lets Discord set its own cookies.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AboutTab;
