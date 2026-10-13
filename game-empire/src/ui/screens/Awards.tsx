import { useEffect, useMemo, useState } from 'react';
import { Award, Clapperboard, Crown, Mic, Play, SkipForward, Sparkles, Star, Trophy } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import {
  AWARD_CATEGORIES,
  AWARD_ORDER,
  CAMPAIGN_TIERS,
  MAX_CAMPAIGN,
  NOMINATIONS_DATE,
  PREMIERE_COST,
  bookPremiere,
  campaignBlocker,
  eligibilityStart,
  markCeremonyWatched,
  playerNominations,
  playerTrophies,
  predictGoty,
  premiereCandidates,
  runAwardCampaign,
  scoreCategories,
  seasonOpen,
} from '../../engine/awards';
import type { AwardCategory, AwardSeason } from '../../engine/types';
import { dayToDate, playerCompany } from '../../engine/util';
import { date, money } from '../lib/format';
import { Badge, Button, Card, Empty, Progress, SectionTitle, Td, Th, cx } from '../components/ui';

function nextNominations(day: number): number {
  for (let d = day; d < day + 370; d++) {
    const x = dayToDate(d);
    if (x.getUTCMonth() === NOMINATIONS_DATE[0] && x.getUTCDate() === NOMINATIONS_DATE[1]) return d;
  }
  return day + 365;
}

function celebrateUi(title: string, big = false) {
  useGameStore.setState((s) => ({ celebrations: [...s.celebrations, { id: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title, big }].slice(-2) }));
}

export function Awards() {
  const w = useWorld();
  const s = w.awardSeason;
  const [watching, setWatching] = useState(false);
  const open = seasonOpen(w);
  const showCeremony = s && s.done && (watching || !s.watched);
  return (
    <div className="space-y-4">
      <SectionTitle>The Game Awards</SectionTitle>
      <Banner />
      {showCeremony && s ? (
        <Ceremony season={s} onDone={() => setWatching(false)} />
      ) : open && s ? (
        <NominationsView season={s} />
      ) : (
        <>
          {s?.done && <Results season={s} onReplay={() => setWatching(true)} />}
          <PreSeason />
        </>
      )}
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <TrophyCabinet />
        <Archive />
      </div>
    </div>
  );
}

function Banner() {
  const w = useWorld();
  const s = w.awardSeason;
  const open = seasonOpen(w);
  const mine = playerNominations(w);
  const nextNoms = nextNominations(w.day);
  let line: string;
  if (open && s) line = `Ceremony in ${s.ceremonyDay - w.day} days · ${date(s.ceremonyDay)}`;
  else line = `Nominations in ${nextNoms - w.day} days · ${date(nextNoms)}`;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-warn/30 bg-[radial-gradient(ellipse_at_top_left,_rgba(224,165,38,0.28)_0%,_rgba(19,26,36,1)_60%)] p-6">
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warn/15 text-warn">
          <Trophy size={34} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.25em] text-warn/80">The biggest night in games</div>
          <div className="gold-text text-3xl font-black tracking-tight">The {s && open ? s.year : dayToDate(nextNoms).getUTCFullYear()} Game Awards</div>
          <div className="mt-1 text-sm text-sub">{line}</div>
        </div>
        {open && (
          <div className="text-right">
            <div className="text-3xl font-bold tabular text-warn">{mine.filter((m) => m.category !== 'glitch').length}</div>
            <div className="text-xs text-muted">your nominations</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ before nominations

function PreSeason() {
  const w = useWorld();
  const navigate = useGameStore((s) => s.navigate);
  const start = eligibilityStart(w);
  const contenders = useMemo(() => scoreCategories(w, start, w.day).goty.slice(0, 6), [w, start, w.day]);
  const pid = w.player.companyId;
  return (
    <Card title="Early buzz" subtitle={`Games released since ${date(start)} are eligible. Here's who critics are talking about for Game of the Year.`}>
      {contenders.length === 0 ? (
        <Empty icon={<Sparkles size={22} />} title="No contenders yet this season" />
      ) : (
        <ol className="space-y-1.5">
          {contenders.map((n, i) => {
            const mine = n.companyId === pid;
            return (
              <li key={n.id}>
                <button
                  onClick={() => navigate(mine ? { name: 'game', id: n.id } : { name: 'company', id: n.companyId })}
                  className={cx('flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm', mine ? 'border-warn/50 bg-warn-soft/30' : 'border-line bg-surface-2 hover:border-sub')}
                >
                  <span className="w-5 text-xs text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{n.title}</span>
                  <span className="truncate text-xs text-muted">{w.companies[n.companyId]?.name}</span>
                  {mine && <Badge tone="warn">Yours</Badge>}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-3 text-xs text-muted">Great reviews, a big audience and ambitious scope win Game of the Year. Narrative, art, audio, multiplayer, mobile, family, indie, debut and innovation all have their own awards.</div>
    </Card>
  );
}

// ------------------------------------------------------------ nominations

function NominationsView({ season }: { season: AwardSeason }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const pid = w.player.companyId;
  const goty = season.categories.find((c) => c.id === 'goty');
  const mineIds = [...new Set(playerNominations(w, season).filter((n) => n.category !== 'glitch' && n.category !== 'studio').map((n) => n.id))];
  const devs = premiereCandidates(w);
  const [premiere, setPremiere] = useState(devs[0]?.id ?? '');
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title={
            <span className="flex items-center gap-1.5">
              <Star size={14} className="text-warn" /> Campaign for votes
            </span>
          }
          subtitle="'For Your Consideration' campaigns sway the voters. Each nominated game can reach full strength once."
        >
          {mineIds.length === 0 ? (
            <div className="text-sm text-muted">None of your games were nominated this year. Pick your Game of the Year below, and maybe book a world premiere.</div>
          ) : (
            <div className="space-y-3">
              {mineIds.map((id) => {
                const g = w.games[id];
                const strength = season.campaigns[id] ?? 0;
                const cats = season.categories.filter((c) => c.nominees.some((n) => n.id === id)).map((c) => AWARD_CATEGORIES[c.id].name);
                return (
                  <div key={id} className="rounded-lg border border-warn/30 bg-warn-soft/10 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold">{g?.title}</div>
                        <div className="text-xs text-muted">{cats.join(' · ')}</div>
                      </div>
                      <div className="w-40">
                        <div className="mb-1 flex justify-between text-[11px] text-muted">
                          <span>Campaign</span>
                          <span className="tabular">
                            {strength}/{MAX_CAMPAIGN}
                          </span>
                        </div>
                        <Progress value={strength} max={MAX_CAMPAIGN} tone="warn" />
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {CAMPAIGN_TIERS.map((t, i) => {
                        const block = campaignBlocker(w, id, i);
                        return (
                          <Button key={t.name} size="sm" disabled={!!block} title={block ?? `+${t.points} votes`} onClick={() => act((world) => runAwardCampaign(world, id, i), `${t.name} for ${g?.title}`)}>
                            {t.name} · {money(t.cost)}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card
            title={
              <span className="flex items-center gap-1.5">
                <Clapperboard size={14} className="text-accent" /> World premiere
              </span>
            }
            subtitle="Reveal an upcoming game on stage in front of millions."
          >
            {season.premiere ? (
              <div className="text-sm">
                Booked: <span className="font-semibold">{w.games[season.premiere]?.title}</span>
              </div>
            ) : devs.length === 0 ? (
              <div className="text-sm text-muted">Start a new game to have something to reveal.</div>
            ) : (
              <div className="flex gap-2">
                <select className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2 text-sm" value={premiere} onChange={(e) => setPremiere(e.target.value)}>
                  {devs.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="primary" disabled={!premiere || playerCompany(w).cash < PREMIERE_COST} onClick={() => act((world) => bookPremiere(world, premiere), 'World premiere booked')}>
                  Book · {money(PREMIERE_COST)}
                </Button>
              </div>
            )}
          </Card>
          {season.presenter && (
            <div className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft/30 p-3 text-sm">
              <Mic size={18} className="text-accent" />
              You're presenting an award on stage. Reputation +2 on the night.
            </div>
          )}
        </div>
      </div>

      {goty && (
        <Card
          title={
            <span className="flex items-center gap-1.5">
              <Crown size={14} className="text-warn" /> Predict Game of the Year
            </span>
          }
          subtitle="Call it right and earn 120 XP."
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {goty.nominees.map((n) => {
              const picked = season.prediction === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => act((world) => predictGoty(world, n.id))}
                  className={cx('rounded-lg border p-3 text-left transition-colors', picked ? 'border-warn bg-warn-soft/40' : 'border-line bg-surface-2 hover:border-sub')}
                >
                  <div className="truncate text-sm font-semibold">{n.title}</div>
                  <div className="truncate text-xs text-muted">{w.companies[n.companyId]?.name}</div>
                  {n.companyId === pid && <Badge tone="warn" className="mt-1">Yours</Badge>}
                  {picked && <div className="mt-1 text-[11px] font-semibold text-warn">Your pick</div>}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {season.categories.map((c) => (
          <CategoryCard key={c.id} cat={c} />
        ))}
      </div>
    </div>
  );
}

function CategoryCard({ cat, reveal }: { cat: AwardCategory; reveal?: boolean }) {
  const w = useWorld();
  const pid = w.player.companyId;
  const def = AWARD_CATEGORIES[cat.id];
  return (
    <div className={cx('rounded-xl border bg-surface p-3', cat.id === 'goty' ? 'border-warn/50' : 'border-line')}>
      <div className="flex items-center gap-2">
        <span className="text-lg" aria-hidden>
          {def.emoji}
        </span>
        <div className="min-w-0">
          <div className={cx('text-sm font-semibold', cat.id === 'goty' && 'gold-text')}>{def.name}</div>
          <div className="truncate text-[11px] text-muted">{def.blurb}</div>
        </div>
      </div>
      <ul className="mt-2 space-y-1">
        {cat.nominees.map((n) => {
          const mine = n.companyId === pid;
          const won = reveal && cat.winnerId === n.id;
          return (
            <li key={n.id} className={cx('flex items-center gap-2 rounded-md px-2 py-1 text-xs', won ? 'bg-warn-soft/50 font-semibold text-warn' : mine ? 'bg-accent-soft/30' : '')}>
              {won ? <Trophy size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-line" />}
              <span className="min-w-0 flex-1 truncate">{n.title}</span>
              {cat.id !== 'studio' && <span className="truncate text-muted">{w.companies[n.companyId]?.name}</span>}
              {mine && !won && <Badge tone="accent">You</Badge>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------ the ceremony

type Phase = 'nominees' | 'envelope' | 'winner';

function Ceremony({ season, onDone }: { season: AwardSeason; onDone: () => void }) {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const order = AWARD_ORDER.filter((id) => season.categories.some((c) => c.id === id));
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('nominees');
  const cat = season.categories.find((c) => c.id === order[idx]);
  const finished = idx >= order.length;
  const pid = w.player.companyId;

  useEffect(() => {
    if (finished || !cat) return;
    if (phase === 'nominees') {
      const t = setTimeout(() => setPhase('envelope'), 1800);
      return () => clearTimeout(t);
    }
    if (phase === 'envelope') {
      const t = setTimeout(() => {
        setPhase('winner');
        const winner = cat.nominees.find((n) => n.id === cat.winnerId);
        if (winner?.companyId === pid && cat.id !== 'glitch') celebrateUi(`${AWARD_CATEGORIES[cat.id].emoji} ${AWARD_CATEGORIES[cat.id].name}`, cat.id === 'goty' || cat.id === 'studio');
      }, 1600);
      return () => clearTimeout(t);
    }
  }, [phase, idx, finished, cat, pid]);

  const next = () => {
    setIdx((i) => i + 1);
    setPhase('nominees');
  };
  const finish = () => {
    act((world) => markCeremonyWatched(world));
    onDone();
  };

  if (finished || !cat) {
    const wins = season.categories.filter((c) => c.nominees.find((n) => n.id === c.winnerId)?.companyId === pid && c.id !== 'glitch');
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Trophy size={40} className="text-warn" />
          <div className="gold-text text-2xl font-black">That's a wrap!</div>
          <div className="text-sm text-sub">{wins.length ? `Your studio took home ${wins.length} award${wins.length > 1 ? 's' : ''}: ${wins.map((c) => AWARD_CATEGORIES[c.id].name).join(', ')}.` : 'No trophies for your studio this year. There is always next year.'}</div>
          {season.highlights.length > 0 && (
            <ul className="mt-2 max-w-xl space-y-1 text-xs text-muted">
              {season.highlights.map((h) => (
                <li key={h}>★ {h}</li>
              ))}
            </ul>
          )}
          <Button variant="primary" className="mt-3" onClick={finish}>
            See all the winners
          </Button>
        </div>
      </Card>
    );
  }

  const def = AWARD_CATEGORIES[cat.id];
  const winner = cat.nominees.find((n) => n.id === cat.winnerId);
  return (
    <div className="overflow-hidden rounded-2xl border border-warn/30 bg-[radial-gradient(ellipse_at_top,_rgba(224,165,38,0.18)_0%,_rgba(11,16,23,1)_70%)]">
      <div className="flex items-center justify-between border-b border-warn/20 px-5 py-3 text-xs text-sub">
        <span className="flex items-center gap-1.5">
          <span className="live-dot" style={{ width: 6, height: 6, background: 'var(--color-bad)' }} /> LIVE · The {season.year} Game Awards
        </span>
        <span className="tabular">
          Award {idx + 1} of {order.length}
        </span>
      </div>
      <div className="flex flex-col items-center px-5 py-8 text-center">
        <div className="text-4xl" aria-hidden>
          {def.emoji}
        </div>
        <div className={cx('mt-2 text-2xl font-black tracking-tight', cat.id === 'goty' ? 'gold-text text-4xl' : 'text-ink')}>{def.name}</div>
        <div className="mt-1 text-sm text-muted">{def.blurb}</div>
        <div className="mt-6 grid w-full max-w-3xl gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {cat.nominees.map((n) => {
            const isWinner = phase === 'winner' && n.id === cat.winnerId;
            const lost = phase === 'winner' && n.id !== cat.winnerId;
            const mine = n.companyId === pid;
            return (
              <div
                key={n.id}
                className={cx(
                  'rounded-xl border p-3 transition-all duration-500',
                  isWinner ? 'winner-glow scale-105 border-warn bg-warn-soft/50' : lost ? 'border-line bg-surface/60 opacity-40' : mine ? 'border-accent/50 bg-accent-soft/20' : 'border-line bg-surface',
                )}
              >
                <div className="truncate text-sm font-semibold">{n.title}</div>
                {cat.id !== 'studio' && <div className="truncate text-[11px] text-muted">{w.companies[n.companyId]?.name}</div>}
                {mine && <Badge tone="accent" className="mt-1">You</Badge>}
                {isWinner && (
                  <div className="mt-1 flex items-center justify-center gap-1 text-xs font-bold text-warn">
                    <Trophy size={12} /> Winner
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-6 h-16">
          {phase === 'nominees' && <div className="text-sm text-sub">And the nominees are…</div>}
          {phase === 'envelope' && (
            <div className="flex flex-col items-center gap-2">
              <div className="envelope-shake rounded-md border border-warn/60 bg-warn/20 px-6 py-2 text-xs font-semibold uppercase tracking-widest text-warn">✉ Opening the envelope</div>
              <div className="text-sm text-sub">And the award goes to…</div>
            </div>
          )}
          {phase === 'winner' && winner && (
            <div className="page-in">
              <div className="gold-text text-2xl font-black">{winner.title}</div>
              <div className="text-xs text-muted">{cat.id === 'studio' ? 'Studio of the Year' : w.companies[winner.companyId]?.name}</div>
            </div>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setIdx(order.length)}>
            <SkipForward size={13} /> Skip to the end
          </Button>
          <Button size="sm" variant="primary" disabled={phase !== 'winner'} onClick={next}>
            <Play size={13} /> {idx + 1 < order.length ? 'Next award' : 'Finish'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Results({ season, onReplay }: { season: AwardSeason; onReplay: () => void }) {
  return (
    <Card
      title={`The ${season.year} winners`}
      subtitle={season.highlights[0] ? `Best moment: ${season.highlights[0]}` : undefined}
      actions={
        <Button size="sm" onClick={onReplay}>
          <Play size={13} /> Replay ceremony
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {AWARD_ORDER.slice()
          .reverse()
          .map((id) => season.categories.find((c) => c.id === id))
          .filter((c): c is AwardCategory => !!c)
          .map((c) => (
            <CategoryCard key={c.id} cat={c} reveal />
          ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ cabinet & archive

function TrophyCabinet() {
  const w = useWorld();
  const navigate = useGameStore((s) => s.navigate);
  const trophies = playerTrophies(w);
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Award size={15} className="text-warn" /> Your trophy cabinet
        </span>
      }
      subtitle={`${trophies.length} statuette${trophies.length === 1 ? '' : 's'}`}
    >
      {trophies.length === 0 ? (
        <Empty icon={<Trophy size={24} />} title="Empty shelves, for now">
          Release great games and they'll be nominated in November.
        </Empty>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {trophies.map((t, i) => (
            <button key={`${t.year}-${t.category}-${i}`} onClick={() => t.gameId && navigate({ name: 'game', id: t.gameId })} className="card-hover flex flex-col items-center rounded-xl border border-warn/30 bg-gradient-to-b from-warn-soft/30 to-surface p-3 text-center">
              <Trophy size={28} className={t.category === 'Game of the Year' ? 'text-warn' : 'text-[#c9a95a]'} />
              <div className="mt-1 text-[11px] font-semibold text-warn">{t.year}</div>
              <div className="text-xs font-medium">{t.category}</div>
              <div className="w-full truncate text-[11px] text-muted">{t.title}</div>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function Archive() {
  const w = useWorld();
  const pid = w.player.companyId;
  const seasons = [...w.awardArchive].reverse();
  return (
    <Card title="Past ceremonies" pad={false}>
      {seasons.length === 0 ? (
        <div className="p-4 text-sm text-muted">The first ceremony of your career is coming up in December.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line-soft">
              <tr>
                <Th>Year</Th>
                <Th>Game of the Year</Th>
                <Th>Studio of the Year</Th>
                <Th className="text-right">Your wins</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {seasons.map((s) => {
                const goty = s.categories.find((c) => c.id === 'goty');
                const gw = goty?.nominees.find((n) => n.id === goty.winnerId);
                const st = s.categories.find((c) => c.id === 'studio');
                const sw = st?.nominees.find((n) => n.id === st.winnerId);
                const wins = s.categories.filter((c) => c.id !== 'glitch' && c.nominees.find((n) => n.id === c.winnerId)?.companyId === pid).length;
                return (
                  <tr key={s.year}>
                    <Td className="text-sub">{s.year}</Td>
                    <Td className={cx('font-medium', gw?.companyId === pid && 'text-warn')}>{gw?.title ?? '—'}</Td>
                    <Td className={cx(sw?.companyId === pid && 'text-warn')}>{sw?.title ?? '—'}</Td>
                    <Td className="text-right tabular">{wins || '—'}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
