import { useGameStore } from './store/gameStore';
import { Layout } from './ui/components/Layout';
import { GameOverModal, NotificationDrawer, Toasts } from './ui/components/Overlays';
import { StartScreen, GeneratingScreen } from './ui/screens/StartScreen';
import { Dashboard } from './ui/screens/Dashboard';
import { Projects } from './ui/screens/Projects';
import { CreateGame } from './ui/screens/CreateGame';
import { GameDetail } from './ui/screens/GameDetail';
import { Team } from './ui/screens/Team';
import { Office } from './ui/screens/Office';
import { Industry } from './ui/screens/Industry';
import { CompanyDetail, Competitors } from './ui/screens/Competitors';
import { Stocks } from './ui/screens/Stocks';
import { Finance } from './ui/screens/Finance';
import { News } from './ui/screens/News';
import { Achievements } from './ui/screens/Achievements';
import { Settings } from './ui/screens/Settings';
import { Servers } from './ui/screens/Servers';
import { Goals } from './ui/screens/Goals';
import { EngineScreen } from './ui/screens/Engine';

function Screen() {
  const route = useGameStore((s) => s.route);
  switch (route.name) {
    case 'dashboard':
      return <Dashboard />;
    case 'projects':
      return <Projects />;
    case 'create':
      return <CreateGame key={route.ipId ?? 'new'} ipId={route.ipId} />;
    case 'game':
      return <GameDetail key={route.id} id={route.id} />;
    case 'team':
      return <Team />;
    case 'office':
      return <Office />;
    case 'industry':
      return <Industry />;
    case 'competitors':
      return <Competitors />;
    case 'company':
      return <CompanyDetail key={route.id} id={route.id} />;
    case 'stocks':
      return <Stocks />;
    case 'finance':
      return <Finance />;
    case 'news':
      return <News />;
    case 'achievements':
      return <Achievements />;
    case 'servers':
      return <Servers />;
    case 'goals':
      return <Goals />;
    case 'engine':
      return <EngineScreen />;
    case 'settings':
      return <Settings />;
  }
}

function routeKey(r: ReturnType<typeof useGameStore.getState>['route']): string {
  return 'id' in r && r.id ? `${r.name}:${r.id}` : r.name;
}

export default function App() {
  const status = useGameStore((s) => s.status);
  const route = useGameStore((s) => s.route);
  if (status === 'menu') return <StartScreen />;
  if (status === 'generating') return <GeneratingScreen />;
  return (
    <>
      <Layout>
        <div key={routeKey(route)} className="page-in">
          <Screen />
        </div>
      </Layout>
      <NotificationDrawer />
      <GameOverModal />
      <Toasts />
    </>
  );
}
