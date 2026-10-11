import { useGameStore } from './store/gameStore';
import { Layout } from './ui/components/Layout';
import { DecisionModal, GameOverModal, Toasts } from './ui/components/Overlays';
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
    case 'settings':
      return <Settings />;
  }
}

export default function App() {
  const status = useGameStore((s) => s.status);
  if (status === 'menu') return <StartScreen />;
  if (status === 'generating') return <GeneratingScreen />;
  return (
    <>
      <Layout>
        <Screen />
      </Layout>
      <DecisionModal />
      <GameOverModal />
      <Toasts />
    </>
  );
}
