import { Building, Check, Coffee, FlaskConical, Lock } from 'lucide-react';
import { useGameStore, useWorld } from '../../store/gameStore';
import { FACILITIES, FACILITY_IDS, OFFICES, RESEARCH, RESEARCH_IDS } from '../../engine/constants';
import { buildFacility, closeFacility, facilityUpkeep, hasFacility } from '../../engine/fun';
import { moveOffice, startResearch } from '../../engine/actions';
import { playerCompany } from '../../engine/util';
import { money } from '../lib/format';
import { Badge, Button, Card, ConfirmButton, Progress, SectionTitle, cx } from '../components/ui';

export function Office() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const c = playerCompany(w);
  const r = w.player.research;
  const level = w.player.officeLevel;

  return (
    <div className="space-y-4">
      <SectionTitle>Office &amp; R&amp;D</SectionTitle>
      <Card title="Office" subtitle="Bigger offices fit more people and boost productivity and morale, but rent adds up.">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {OFFICES.map((o, i) => {
            const current = i === level;
            const tooSmall = w.player.employees.length > o.capacity;
            const cost = i > level ? o.moveCost : Math.round(o.moveCost * 0.25);
            return (
              <div key={o.name} className={cx('rounded-lg border p-3', current ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface-2')}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold">
                    <Building size={15} className="text-accent" />
                    {o.name}
                  </div>
                  {current && <Badge tone="accent">Current</Badge>}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                  <span className="text-muted">Capacity</span>
                  <span className="text-right tabular">{o.capacity.toLocaleString()}</span>
                  <span className="text-muted">Rent</span>
                  <span className="text-right tabular">{money(o.rent)}/mo</span>
                  <span className="text-muted">Productivity</span>
                  <span className="text-right tabular">×{o.productivity.toFixed(2)}</span>
                  <span className="text-muted">Morale</span>
                  <span className="text-right tabular">{o.morale >= 0 ? '+' : ''}{o.morale}</span>
                </div>
                {!current && (
                  <Button size="sm" className="mt-3 w-full" variant={i > level ? 'primary' : 'secondary'} disabled={tooSmall || c.cash < cost} onClick={() => act((world) => moveOffice(world, i), `Moved into ${o.name}`)}>
                    {tooSmall ? 'Too small for your team' : `${i > level ? 'Move up' : 'Downsize'} · ${money(cost)}`}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Facilities />

      <Card title="Research & development" subtitle="One project at a time. Research costs money upfront and takes time.">
        {r.active && (
          <div className="mb-4 rounded-lg border border-accent/40 bg-accent-soft/30 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-semibold">
                <FlaskConical size={15} className="text-accent" />
                Researching {RESEARCH[r.active.id].name}
              </span>
              <span className="tabular text-sub">{r.active.days - r.active.progress} days left</span>
            </div>
            <Progress value={r.active.progress} max={r.active.days} className="mt-2" />
          </div>
        )}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {RESEARCH_IDS.map((id) => {
            const def = RESEARCH[id];
            const done = r.completed.includes(id);
            const missing = def.requires.filter((q) => !r.completed.includes(q));
            const repLocked = c.reputation < def.minRep;
            const active = r.active?.id === id;
            return (
              <div key={id} className={cx('rounded-lg border p-3', done ? 'border-good/30 bg-good-soft/30' : active ? 'border-accent' : 'border-line bg-surface-2')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{def.name}</span>
                  {done ? <Check size={16} className="text-good" /> : missing.length || repLocked ? <Lock size={14} className="text-muted" /> : null}
                </div>
                <p className="mt-1 text-xs text-sub">{def.blurb}</p>
                <div className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-muted">
                  <span>{money(def.cost)}</span>
                  <span>{def.days} days</span>
                  {def.minRep > 0 && <span className={repLocked ? 'text-warn' : ''}>rep {def.minRep}</span>}
                </div>
                {missing.length > 0 && <div className="mt-1 text-[11px] text-warn">Requires {missing.map((q) => RESEARCH[q].name).join(', ')}</div>}
                {!done && !active && (
                  <Button size="sm" className="mt-2 w-full" disabled={!!r.active || missing.length > 0 || repLocked || c.cash < def.cost} onClick={() => act((world) => startResearch(world, id), `Research started: ${def.name}`)}>
                    Research
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Facilities() {
  const w = useWorld();
  const act = useGameStore((s) => s.act);
  const c = playerCompany(w);
  const built = w.player.facilities.length;
  return (
    <Card title="Facilities" subtitle={`Make the office somewhere people want to be. ${built} built · ${money(facilityUpkeep(w))}/mo upkeep. They move with you.`}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {FACILITY_IDS.map((id) => {
          const def = FACILITIES[id];
          const have = hasFacility(w, id);
          const officeLocked = w.player.officeLevel < def.minOffice;
          return (
            <div key={id} className={cx('flex flex-col rounded-lg border p-3', have ? 'border-good/30 bg-good-soft/20' : 'border-line bg-surface-2')}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Coffee size={13} className={have ? 'text-good' : 'text-muted'} />
                  {def.name}
                </span>
                {have ? <Check size={14} className="text-good" /> : officeLocked ? <Lock size={13} className="text-muted" /> : null}
              </div>
              <p className="mt-1 flex-1 text-xs text-sub">{def.blurb}</p>
              <div className="mt-1 text-[11px] text-muted">
                {money(def.cost)} · {money(def.upkeep)}/mo
              </div>
              {have ? (
                <ConfirmButton className="mt-2 w-full" variant="ghost" confirmLabel="Close it? Morale drops" onConfirm={() => act((world) => closeFacility(world, id))}>
                  Close
                </ConfirmButton>
              ) : (
                <Button size="sm" className="mt-2 w-full" variant="primary" disabled={officeLocked || c.cash < def.cost} onClick={() => act((world) => buildFacility(world, id), `${def.name} is open`)}>
                  {officeLocked ? `Needs ${OFFICES[def.minOffice].name}` : 'Build'}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
