// The Dominion: the late game's home. An overview of every system, then a
// tab for each one.
import { useState, type ReactNode } from 'react';
import { AlertTriangle, Briefcase, Castle, Construction, Earth, Eye, Layers, LayoutGrid, Lock, Mic, Rocket, Building, Siren, Swords } from 'lucide-react';
import { useWorld } from '../../../store/gameStore';
import { FEATURES, FEATURE_ORDER, SECTORS, SECTOR_IDS, antitrustFactor, dominanceBonus, featureOpen, fmtPeople, sectorLeader, sectorShare, sectorTotal, type DominionFeature } from '../../../engine/dominionCore';
import { EMPIRE_LEVELS, empireLevel } from '../../../engine/empire';
import { activeCorps, corpById, playerScore, sideOf, warsOf } from '../../../engine/megacorps';
import { SECURITY_TIERS } from '../../../engine/espionage';
import { universeSummary } from '../../../engine/universes';
import { spaceSummary } from '../../../engine/space';
import { citySummary } from '../../../engine/cities';
import { megaSummary } from '../../../engine/megaprojects';
import { EMERGENCIES } from '../../../engine/emergencies';
import { playerCompany } from '../../../engine/util';
import type { World } from '../../../engine/types';
import { date, money, pct } from '../../lib/format';
import { Badge, Card, Progress, SectionTitle, Tabs, cx } from '../../components/ui';
import { toneText } from './shared';
import { WarsTab } from './Wars';
import { ExecsTab, SpyTab } from './People';
import { EcoTab, KeynotesTab } from './Platforms';
import { CitiesTab, SpaceTab, UniversesTab } from './Frontier';
import { EmergenciesTab, MegaTab } from './Mega';

type Tab = 'overview' | DominionFeature;

const ICONS: Record<Tab, ReactNode> = {
  overview: <LayoutGrid size={14} />,
  wars: <Swords size={14} />,
  execs: <Briefcase size={14} />,
  espionage: <Eye size={14} />,
  keynotes: <Mic size={14} />,
  ecosystem: <Layers size={14} />,
  universes: <Earth size={14} />,
  space: <Rocket size={14} />,
  cities: <Building size={14} />,
  megaprojects: <Construction size={14} />,
  emergencies: <Siren size={14} />,
};

export function DominionScreen({ tab: initial }: { tab?: string }) {
  const w = useWorld();
  const [tab, setTab] = useState<Tab>((initial && (initial === 'overview' || initial in FEATURES) ? initial : 'overview') as Tab);
  const lvl = empireLevel(w);
  const emergency = w.player.dominion.emergency;
  return (
    <div className="space-y-4">
      <SectionTitle actions={<Badge tone="accent">Level {lvl} · {EMPIRE_LEVELS[lvl].name}</Badge>}>
        <span className="flex items-center gap-2">
          <Castle size={18} className="text-warn" /> Dominion
        </span>
      </SectionTitle>
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="min-w-max">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={(['overview', ...FEATURE_ORDER] as Tab[]).map((id) => ({
              id,
              label: (
                <span className={cx('flex items-center gap-1.5', id === 'emergencies' && emergency && 'text-bad')}>
                  {ICONS[id]} {id === 'overview' ? 'Overview' : FEATURES[id].name}
                  {id !== 'overview' && !featureOpen(w, id) && <Lock size={11} className="text-muted" />}
                  {id === 'wars' && warsOf(w, 'player').length > 0 && <span className="rounded bg-bad-soft px-1 text-[10px] font-semibold text-bad">{warsOf(w, 'player').length}</span>}
                  {id === 'emergencies' && emergency && <span className="h-2 w-2 animate-pulse rounded-full bg-bad" />}
                </span>
              ),
            }))}
          />
        </div>
      </div>
      {tab === 'overview' && <Overview onOpen={setTab} />}
      {tab === 'wars' && <WarsTab />}
      {tab === 'execs' && <ExecsTab />}
      {tab === 'espionage' && <SpyTab />}
      {tab === 'keynotes' && <KeynotesTab />}
      {tab === 'ecosystem' && <EcoTab />}
      {tab === 'universes' && <UniversesTab />}
      {tab === 'space' && <SpaceTab />}
      {tab === 'cities' && <CitiesTab />}
      {tab === 'megaprojects' && <MegaTab />}
      {tab === 'emergencies' && <EmergenciesTab />}
    </div>
  );
}

function summary(w: World, f: DominionFeature): string {
  const d = w.player.dominion;
  switch (f) {
    case 'wars': {
      const mine = warsOf(w, 'player').length;
      return `${activeCorps(w).length} megacorps · ${mine ? `${mine} war${mine === 1 ? '' : 's'} with you` : 'at peace with you'}`;
    }
    case 'execs':
      return `${d.execs.length}/6 seats filled${d.execs.some((e) => e.feudWith) ? ' · a feud' : ''}`;
    case 'espionage':
      return `${SECURITY_TIERS[d.spy.level].name} · ${d.spy.ops.length} operation${d.spy.ops.length === 1 ? '' : 's'} running`;
    case 'keynotes':
      return d.keynotes.plan ? `"${d.keynotes.plan.title}" in ${d.keynotes.plan.day - w.day} days` : d.keynotes.history.length ? `Last show scored ${d.keynotes.history[0].score}/100` : 'Nothing booked';
    case 'ecosystem':
      return d.ecosystem ? `${fmtPeople(d.ecosystem.users)} users · ${money(d.ecosystem.monthRevenue)}/mo` : 'Not founded yet';
    case 'universes':
      return d.universes.length ? universeSummary(w) : 'No worlds yet';
    case 'space':
      return d.space.assets.length ? spaceSummary(w) : 'Still on Earth';
    case 'cities':
      return d.cities.length ? citySummary(w) : 'No cities yet';
    case 'megaprojects':
      return d.megaprojects.length ? megaSummary(w) : 'Nothing underway';
    case 'emergencies':
      return d.emergency ? `ACTIVE: ${d.emergency.title}` : `${d.emergencyHistory.length} handled`;
  }
}

function Overview({ onOpen }: { onOpen: (t: Tab) => void }) {
  const w = useWorld();
  const d = w.player.dominion;
  const p = playerCompany(w);
  const myWars = warsOf(w, 'player');
  const mods = d.mods.filter((m) => m.until > w.day);
  const scars = d.scars.filter((s) => s.until > w.day);
  return (
    <div className="space-y-4">
      {d.emergency && (
        <button onClick={() => onOpen('emergencies')} className="block w-full rounded-xl border border-bad/50 bg-bad-soft/40 p-4 text-left">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-bad">
              <AlertTriangle size={16} /> {EMERGENCIES[d.emergency.kind].emoji} Emergency: {d.emergency.title} · stage {d.emergency.stage} of 3
            </div>
            <span className="text-xs text-bad tabular">Pressure {Math.round(d.emergency.pressure)}/100</span>
          </div>
          <Progress value={d.emergency.pressure} max={100} tone="bad" className="mt-2" />
        </button>
      )}
      {myWars.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {myWars.map((war) => {
            const ps = playerScore(war);
            const foe = corpById(w, sideOf(war, 'player') === 'attackers' ? war.defenders[0] : war.attackers[0]);
            return (
              <button key={war.id} onClick={() => onOpen('wars')} className="rounded-xl border border-line bg-surface p-3 text-left hover:border-sub">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Swords size={14} className="text-bad" /> {SECTORS[war.sector].name} war vs {foe?.name ?? 'a rival'}
                  </span>
                  <span className={cx('text-xs font-semibold tabular', ps >= 0 ? 'text-good' : 'text-bad')}>{ps >= 0 ? `Winning ${Math.round(ps)}` : `Losing ${Math.round(-ps)}`}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {FEATURE_ORDER.map((f) => {
          const open = featureOpen(w, f);
          const lvl = EMPIRE_LEVELS[FEATURES[f].level];
          return (
            <button key={f} onClick={() => onOpen(f)} className={cx('rounded-lg border p-3 text-left transition-colors hover:border-sub', open ? 'border-line bg-surface' : 'border-line-soft bg-surface-2 opacity-70', f === 'emergencies' && d.emergency && 'border-bad/60')}>
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                {ICONS[f]} {FEATURES[f].name}
                {!open && <Lock size={11} className="ml-auto text-muted" />}
              </div>
              <div className={cx('mt-1 text-xs', open ? 'text-sub' : 'text-warn')}>{open ? summary(w, f) : `Unlocks at ${money(lvl.min)}`}</div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] [&>*]:min-w-0">
        <Card
          title="Market dominance"
          subtitle={featureOpen(w, 'wars') ? `Leading a market pays up to +12% of what you earn there. Antitrust heat ×${antitrustFactor(w).toFixed(2)}.` : 'Rival megacorporations appear at the Megacorp level ($100B).'}
        >
          <div className="space-y-2.5">
            {SECTOR_IDS.map((s) => {
              const share = sectorShare(w, s);
              const leader = sectorLeader(w, s);
              const leaderName = leader === 'player' ? 'You' : leader ? corpById(w, leader)?.name ?? '—' : '—';
              const corps = activeCorps(w)
                .map((c) => ({ c, share: sectorShare(w, s, c.id) }))
                .sort((a, b) => b.share - a.share)
                .slice(0, 4);
              return (
                <div key={s}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
                    <span className="font-medium text-ink">
                      {SECTORS[s].emoji} {SECTORS[s].name}
                    </span>
                    <span className="text-muted">
                      You {pct(share)} · leader {leaderName}
                      {dominanceBonus(share) > 0 && <span className="text-good"> · +{pct(dominanceBonus(share), 1)} income</span>}
                    </span>
                  </div>
                  <div className="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-surface-3" title={`Total ${money(sectorTotal(w, s))}/yr`}>
                    <div className="h-full bg-accent" style={{ width: `${share * 100}%` }} />
                    {corps.map(({ c, share: cs }) => (
                      <div key={c.id} className="h-full" style={{ width: `${cs * 100}%`, background: c.color, opacity: 0.8 }} title={`${c.name} ${pct(cs)}`} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Dominion news" subtitle="What the giants are up to.">
          {d.feed.length ? (
            <ul className="max-h-[340px] space-y-1.5 overflow-y-auto pr-1 text-xs">
              {d.feed.slice(0, 30).map((f, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 text-muted tabular">{date(f.day)}</span>
                  <span className={toneText(f.tone)}>{f.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-sub">Quiet for now. Grow, and the world will notice.</p>
          )}
        </Card>
      </div>

      {(mods.length > 0 || scars.length > 0) && (
        <Card title="Lasting effects" subtitle="War spoils, sanctions and the scars of past crises.">
          <div className="grid gap-2 md:grid-cols-2">
            {mods.map((m, i) => (
              <div key={`m${i}`} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs">
                <span className="text-sub">{m.reason}</span>
                <span className={cx('shrink-0 tabular', m.mult >= 1 ? 'text-good' : 'text-bad')}>
                  {m.mult >= 1 ? '+' : ''}
                  {Math.round((m.mult - 1) * 100)}% {m.sector === 'all' ? 'income' : SECTORS[m.sector].name.toLowerCase()} · until {date(m.until)}
                </span>
              </div>
            ))}
            {scars.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs">
                <span className={s.value > 0 && s.key !== 'antitrust' && s.key !== 'hardwareCost' && s.key !== 'spaceRisk' ? 'text-good' : 'text-bad'}>{s.label}</span>
                <span className="shrink-0 text-muted tabular">until {date(s.until)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="text-right text-[11px] text-muted">
        Company value {money(p.valuation)} · Dominion stats: {d.stats.warsWon} wars won, {d.stats.warsLost} lost, {d.stats.annexed} megacorps absorbed, {d.stats.megaprojects} megaprojects, {d.stats.emergencies} emergencies ({d.stats.disasters} disasters)
      </div>
    </div>
  );
}
