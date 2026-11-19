import { render } from 'preact';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import flagFont from 'country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2';
import { useEffect } from 'preact/hooks';
import './styles.css';
import { useRoute } from './router.ts';
import { useSettings } from './settings.ts';
import { isActive, useTasks } from './tasks.ts';
import { setTheme, useTheme, type Theme } from './theme.ts';
import * as I from './components/icons.tsx';
import { Logo, Spinner, Toasts } from './components/ui.tsx';
import { Prompts } from './pages/Prompts.tsx';
import { Settings } from './pages/Settings.tsx';
import { Tags } from './pages/Tags.tsx';
import { StockDetail } from './pages/StockDetail.tsx';
import { StockList } from './pages/StockList.tsx';

function TaskIndicator() {
  const tasks = useTasks();
  const all = [...tasks.values()];
  const running = all.filter((t) => t.state === 'running').length;
  const queued = all.filter((t) => t.state === 'queued').length;
  if (!running && !queued) return null;
  return (
    <span class="task-ind" title={all.filter(isActive).map((t) => `${t.symbol} ${t.kind}: ${t.state}`).join('\n')}>
      <Spinner size={12} />
      <span>
        {running} running{queued ? ` · ${queued} queued` : ''}
      </span>
    </span>
  );
}

function ThemeSwitch() {
  const theme = useTheme();
  const pick = (t: Theme) => (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTheme(t, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };
  return (
    <div class="theme-switch" role="group" aria-label="Theme">
      <button type="button" aria-pressed={theme === 'dark'} title="Dark theme" onClick={pick('dark')}>
        <I.Moon size={15} />
        <span class="sr-only">Dark</span>
      </button>
      <button type="button" aria-pressed={theme === 'light'} title="Solarized Light theme" onClick={pick('light')}>
        <I.Sun size={15} />
        <span class="sr-only">Light</span>
      </button>
    </div>
  );
}

function App() {
  const route = useRoute();
  const settings = useSettings();
  const missingKeys = !settings.fmpKey || !settings.geminiKey;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      const el = document.activeElement;
      if (el && /^(input|textarea|select)$/i.test(el.tagName)) return;
      const search = document.querySelector<HTMLInputElement>('.search input');
      if (search) {
        e.preventDefault();
        search.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const stockMatch = /^\/stock\/(.+)$/.exec(route.path);
  let page;
  let section: 'market' | 'prompts' | 'tags' | 'settings' = 'market';
  if (stockMatch) page = <StockDetail key={stockMatch[1]} symbol={decodeURIComponent(stockMatch[1]!)} />;
  else if (route.path === '/prompts') {
    page = <Prompts />;
    section = 'prompts';
  } else if (route.path === '/tags') {
    page = <Tags />;
    section = 'tags';
  } else if (route.path === '/settings') {
    page = <Settings />;
    section = 'settings';
  } else page = <StockList params={route.params} />;

  return (
    <>
      <div class="backdrop" aria-hidden="true" />
      <header class="topbar">
        <a class="brand" href="#/">
          <Logo />
          <span class="brand__name">Meridian</span>
        </a>
        <nav class="nav">
          <a href="#/" class={section === 'market' ? 'is-active' : ''}>
            <I.Rows size={15} /> <span>Market</span>
          </a>
          <a href="#/prompts" class={section === 'prompts' ? 'is-active' : ''}>
            <I.Quill size={15} /> <span>Prompts</span>
          </a>
          <a href="#/tags" class={section === 'tags' ? 'is-active' : ''}>
            <I.Tag size={15} /> <span>Tags</span>
          </a>
          <a href="#/settings" class={section === 'settings' ? 'is-active' : ''}>
            <I.Settings size={15} /> <span>Settings</span>
            {missingKeys && <span class="nav__dot" title="API keys missing" />}
          </a>
        </nav>
        <div class="topbar__right">
          <TaskIndicator />
          <ThemeSwitch />
        </div>
      </header>
      <main>{page}</main>
      <footer class="footer">
        <span>Data · Financial Modeling Prep</span>
        <span>Analysis · Google Gemini ({settings.geminiModel})</span>
        <span>Not investment advice.</span>
      </footer>
      <Toasts />
    </>
  );
}

// Windows ships no flag emoji; this loads a flags-only font there and is a no-op elsewhere.
polyfillCountryFlagEmojis('Twemoji Country Flags', flagFont);

render(<App />, document.getElementById('app')!);
