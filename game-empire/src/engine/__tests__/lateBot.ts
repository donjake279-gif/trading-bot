// A scripted late-game player for tests: uses every Dominion system.
import type { World } from '../types';
import { playerCompany } from '../util';
import { featureOpen } from '../dominionCore';
import { EXEC_ROLE_IDS, hireExec, signingBonus } from '../executives';
import { SECURITY_TIERS, launchOp, securityCost, setSecurityLevel } from '../espionage';
import { ECO_PART_IDS, ecoBuildCost, foundEcosystem, partBlocker, upgradePart } from '../ecosystem';
import { KEYNOTE_COOLDOWN, VENUES, planKeynote, revealOptions, venueBlocker, venueCost } from '../keynotes';
import { UNIVERSE_SCALES, createUniverse } from '../universes';
import { SPACE_KINDS, assetCost, buildSpace, spaceBlocker } from '../space';
import { DISTRICT_KINDS, buildDistrict, cityCost, districtCost, foundCity } from '../cities';
import { MEGAPROJECT_IDS, MEGAPROJECTS, megaBlocker, startMegaproject } from '../megaprojects';
import { activeCorps, makePeace, peaceTerms, setWarIntensity, sideOf, tacticCost, useTactic, TACTICS } from '../megacorps';
import type { WarTactic } from '../types';

export function lateBot(w: World): void {
  const p = playerCompany(w);
  const d = w.player.dominion;
  const rich = (x: number) => p.cash > x;
  if (featureOpen(w, 'execs')) {
    for (const role of EXEC_ROLE_IDS) {
      if (d.execs.some((e) => e.role === role)) continue;
      const c = d.execPool.filter((x) => x.role === role).sort((a, b) => b.skill - a.skill)[0];
      if (c && rich(signingBonus(c) * 5)) hireExec(w, c.id);
    }
  }
  if (featureOpen(w, 'espionage')) {
    const want = Math.min(SECURITY_TIERS.length - 1, Math.max(1, w.player.empire.best - 2));
    if (d.spy.level < want && rich(securityCost(w, want) * 30)) setSecurityLevel(w, want);
    const foe = activeCorps(w).sort((a, b) => a.relation - b.relation)[0];
    if (foe && d.spy.ops.length < 2 && w.day % 90 < 30) launchOp(w, (d.spy.intel[foe.id] ?? 0) < 40 ? 'roadmap' : 'sabotage', foe.id);
  }
  if (featureOpen(w, 'ecosystem')) {
    if (!d.ecosystem && rich(ecoBuildCost('os', 1) * 3)) foundEcosystem(w, 'Nexus');
    else if (d.ecosystem && !d.ecosystem.building) {
      const part = ECO_PART_IDS.filter((x) => !partBlocker(w, x)).sort((a, b) => ecoBuildCost(a, d.ecosystem!.levels[a] + 1) - ecoBuildCost(b, d.ecosystem!.levels[b] + 1))[0];
      if (part && rich(ecoBuildCost(part, d.ecosystem.levels[part] + 1) * 3)) upgradePart(w, part);
    }
  }
  if (featureOpen(w, 'keynotes') && !d.keynotes.plan && w.day - d.keynotes.lastDay >= KEYNOTE_COOLDOWN) {
    let venue = 0;
    for (let v = VENUES.length - 1; v >= 0; v--) if (!venueBlocker(w, v) && rich(venueCost(w, v) * 20)) { venue = v; break; }
    const opts = revealOptions(w).sort((a, b) => b.base - a.base).slice(0, 3);
    if (opts.length && rich(venueCost(w, venue) * 5)) planKeynote(w, { title: '', venue, reveals: opts.map((o, i) => ({ kind: o.kind, refId: o.refId, label: o.label, surprise: i === 0 })) });
  }
  if (featureOpen(w, 'universes') && d.universes.filter((u) => u.stage !== 'closed').length < 2) {
    let scale = 1;
    for (let s = UNIVERSE_SCALES.length; s >= 1; s--) if (rich(UNIVERSE_SCALES[s - 1].cost * 4)) { scale = s; break; }
    if (rich(UNIVERSE_SCALES[scale - 1].cost * 4)) createUniverse(w, { name: `World ${d.universes.length + 1}`, theme: 'space', ipId: null, scale });
  }
  if (featureOpen(w, 'space')) {
    for (const k of SPACE_KINDS) {
      if (d.space.assets.some((a) => a.kind === k && a.stage !== 'lost')) continue;
      if (!spaceBlocker(w, k) && rich(assetCost(w, k) * 3)) buildSpace(w, k);
      break;
    }
  }
  if (featureOpen(w, 'cities')) {
    if (!d.cities.length && rich(cityCost(w) * 3)) foundCity(w, 'Empire City', 'na');
    for (const c of d.cities) {
      if (w.day < c.ready || c.districts.length >= c.slots) continue;
      const kind = DISTRICT_KINDS[c.districts.length % 8];
      if (rich(districtCost(w, kind, 1) * 4)) buildDistrict(w, c.id, kind);
    }
  }
  if (featureOpen(w, 'megaprojects') && d.megaprojects.filter((m) => m.stage === 'building').length < 1) {
    const id = MEGAPROJECT_IDS.filter((x) => !megaBlocker(w, x)).sort((a, b) => MEGAPROJECTS[a].budget - MEGAPROJECTS[b].budget)[0];
    if (id && rich(MEGAPROJECTS[id].budget * 0.5)) startMegaproject(w, id);
  }
  for (const war of d.wars) {
    const side = sideOf(war, 'player');
    if (!side) continue;
    setWarIntensity(w, war.id, 2);
    for (const t of Object.keys(TACTICS) as WarTactic[]) if (rich(tacticCost(w, t) * 10)) useTactic(w, war.id, t);
    const mine = side === 'attackers' ? war.score : -war.score;
    if (mine < -60 && peaceTerms(w, war.id).accept) makePeace(w, war.id);
  }
}
