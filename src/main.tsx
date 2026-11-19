import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import './styles.css';
import { useRoute } from './router.ts';
import { useSettings } from './settings.ts';
import { isActive, useTasks } from './tasks.ts';
import * as I from './components/icons.tsx';
import { Logo, Spinner, Toasts } from './components/ui.tsx';
import { Prompts } from './pages/Prompts.tsx';
import { Settings } from './pages/Settings.tsx';
import { StockDetail } from './pages/StockDetail.tsx';
import { StockList } from './pages/StockList.tsx';

function TaskIndicator() {
  const tasks = useTasks();
  const all = [...tasks.values()];
  const running = all.filter((t) => t.state === 'running').length;
  const queued = all.filter((t) => t.state === 'queued').length;
  if (!running && !queued) return null;
  return (
    <span class="task-ind" title={all.filter(isActive).map((t) => `${t.symbol}: ${t.state}`).join('\n')}>
      <Spinner size={12} />
      <span>
        {running} analysing{queued ? ` · ${queued} queued` : ''}
      </span>
    </span>
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
  let section: 'market' | 'prompts' | 'settings' = 'market';
  if (stockMatch) page = <StockDetail key={stockMatch[1]} symbol={decodeURIComponent(stockMatch[1]!)} />;
  else if (route.path === '/prompts') {
    page = <Prompts />;
    section = 'prompts';
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
          <a href="#/settings" class={section === 'settings' ? 'is-active' : ''}>
            <I.Settings size={15} /> <span>Settings</span>
            {missingKeys && <span class="nav__dot" title="API keys missing" />}
          </a>
        </nav>
        <div class="topbar__right">
          <TaskIndicator />
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

render(<App />, document.getElementById('app')!);
