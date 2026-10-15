// Who runs the megacorps, and what they say. Kept free of other engine
// imports so every late-game module can use it.
import type { CorpPersona } from './types';

export const CORP_PERSONAS: Record<CorpPersona, { name: string; emoji: string; blurb: string }> = {
  warlord: { name: 'The Warlord', emoji: '⚔️', blurb: 'Sees every market as a battlefield. Declares wars and fights to the end.' },
  schemer: { name: 'The Schemer', emoji: '🕵️', blurb: 'Spies, leaks and poached executives. Never fights fair.' },
  visionary: { name: 'The Visionary', emoji: '🔭', blurb: 'Space, megaprojects and moonshots. Wants to build the future first.' },
  showman: { name: 'The Showman', emoji: '🎤', blurb: 'Lives for the keynote stage. Every announcement is the biggest ever.' },
  diplomat: { name: 'The Diplomat', emoji: '🤝', blurb: 'Builds alliances and brokers peace, then quietly wins.' },
  tycoon: { name: 'The Tycoon', emoji: '💼', blurb: 'Buys studios, cities and platforms. Owns a piece of everything.' },
};

export const CORP_PERSONA_IDS: CorpPersona[] = ['warlord', 'schemer', 'visionary', 'showman', 'diplomat', 'tycoon'];

export type CorpMoment = 'intro' | 'declare' | 'winning' | 'losing' | 'won' | 'lost' | 'peace' | 'keynote' | 'reactGood' | 'reactBad' | 'alliance' | 'betrayed' | 'annexed';

/** {you} = your company, {them} = another company, {sector} = a market. */
export const CORP_LINES: Record<CorpPersona, Record<CorpMoment, string[]>> = {
  warlord: {
    intro: ['{you} is in my way. Not for long.', 'I don’t compete with {you}. I conquer.'],
    declare: ['The {sector} market is mine. {them} can surrender or be crushed.', 'War. Tell {them} to clear their calendar.'],
    winning: ['{them} is bleeding market share. Keep pushing.', 'Victory is close. No mercy.'],
    losing: ['A setback. Nothing more.', 'We regroup, then we return twice as hard.'],
    won: ['The {sector} market bows to us now.', 'Crushed. As promised.'],
    lost: ['This isn’t over. Nothing is ever over.', 'We lost a battle, not the war.'],
    peace: ['A truce. For now.', 'Peace is just the pause between wars.'],
    keynote: ['Our biggest weapons yet. Literally, in the case of the marketing budget.', 'Everything we announce today is aimed at {them}.'],
    reactGood: ['Impressive. We’ll take it apart and do it better.', 'Enjoy it while it lasts, {you}.'],
    reactBad: ['That’s it? We were worried for nothing.', 'A keynote nobody will remember.'],
    alliance: ['Together we march.', 'An alliance of the strong.'],
    betrayed: ['Traitors get no second chance.', 'You will regret this, {them}.'],
    annexed: ['Take my company. You’ll never take my pride.'],
  },
  schemer: {
    intro: ['We know more about {you} than {you} does.', 'Interesting company, {you}. Very… porous.'],
    declare: ['{them} won’t even see it coming. Well, now they will.', 'Let’s see how {them} handles a war on two fronts. One of them invisible.'],
    winning: ['Everything is going according to plan.', '{them} has no idea who’s on their payroll.'],
    losing: ['Patience. Every secret has a price.', 'Interesting. Recalculating.'],
    won: ['Information wins wars. We had more of it.', 'Checkmate.'],
    lost: ['We’ll remember who helped them.', 'A temporary arrangement.'],
    peace: ['Peace. And a few listening devices, just in case.', 'Truce accepted. Trust not included.'],
    keynote: ['We have announcements. Some of them are even ours.', 'Today we reveal the future. We’ve seen everyone else’s.'],
    reactGood: ['We saw that coming months ago.', 'Strong show. Our copy will be stronger.'],
    reactBad: ['Our sources said it would be better. Our sources were being kind.', 'Pity. We had such high hopes for spying on it.'],
    alliance: ['Allies. Of course. For as long as it’s useful.', 'A pact. Let’s keep each other close.'],
    betrayed: ['Did you think we didn’t know?', 'We always know.'],
    annexed: ['Fine. But I kept copies of everything.'],
  },
  visionary: {
    intro: ['{you} builds games. We build the future.', 'There’s room for both of us. In the solar system, at least.'],
    declare: ['The future of {sector} can’t wait for {them} to catch up.', 'We fight for what comes next.'],
    winning: ['The future is arriving ahead of schedule.', 'Progress is unstoppable.'],
    losing: ['Every great idea is fought before it’s accepted.', 'History is patient. So are we.'],
    won: ['The future chose us.', 'A new era for {sector}.'],
    lost: ['Visionaries are often early. Rarely wrong.', 'Back to the drawing board. Bigger this time.'],
    peace: ['Let’s build instead of fight.', 'Peace lets the future happen faster.'],
    keynote: ['Today we show you the next hundred years.', 'One more thing. Actually, several more things.'],
    reactGood: ['Bold. I respect that.', 'Finally, {you} is thinking big.'],
    reactBad: ['{you} is still thinking in quarters. We think in centuries.', 'Small ideas, nicely lit.'],
    alliance: ['Together we reach further.', 'An alliance for the future.'],
    betrayed: ['A short-sighted move, {them}.', 'The future will remember this.'],
    annexed: ['The dream lives on. Under a different logo.'],
  },
  showman: {
    intro: ['The world is our stage. {you} can buy a ticket.', 'Nobody puts on a show like us. Nobody.'],
    declare: ['Ladies and gentlemen: the war for {sector}! Starring us!', 'Tonight’s main event: us versus {them}.'],
    winning: ['The crowd loves us!', 'Encore! Encore!'],
    losing: ['Every great show has a dramatic second act.', 'Plot twist incoming.'],
    won: ['And the winner is… us! Obviously.', 'Standing ovation.'],
    lost: ['Even legends have an off night.', 'We’ll be back for the sequel.'],
    peace: ['A beautiful finale.', 'Curtain call. Peace it is.'],
    keynote: ['The biggest keynote in history. Again.', 'You won’t believe what we have for you tonight.'],
    reactGood: ['Not bad, {you}. Not bad. But have you seen our lighting rig?', 'A solid show. Ours will be better.'],
    reactBad: ['Was that a keynote or a meeting?', 'Someone get {you} a better hype man.'],
    alliance: ['A duet! The crowd will love it.', 'Two stars, one stage.'],
    betrayed: ['Booo!', 'Worst co-star ever.'],
    annexed: ['The show must go on. Apparently without me.'],
  },
  diplomat: {
    intro: ['We’d love to work with {you}. On our terms, ideally.', 'There’s always a deal to be made, {you}.'],
    declare: ['We regret that {them} left us no choice.', 'Diplomacy failed. Regrettably, we didn’t.'],
    winning: ['Our door remains open to {them}.', 'A peace offer is on the table. For now.'],
    losing: ['Perhaps it’s time to talk.', 'Cooler heads must prevail.'],
    won: ['A just outcome.', 'Let’s rebuild together. With us in charge.'],
    lost: ['We accept the result with grace. And a long memory.', 'A lesson in humility.'],
    peace: ['Peace is the best investment.', 'An agreement everyone can live with.'],
    keynote: ['Today we announce partnerships. Lots of partnerships.', 'Building bridges, one product at a time.'],
    reactGood: ['Congratulations to {you}. Sincerely.', 'Impressive work. Let’s talk.'],
    reactBad: ['We wish {you} the best of luck.', 'Every company has difficult days.'],
    alliance: ['Stronger together.', 'A partnership for the ages.'],
    betrayed: ['We are deeply disappointed in {them}.', 'Trust takes years to build and a moment to break.'],
    annexed: ['A merger. Let’s call it a merger.'],
  },
  tycoon: {
    intro: ['Everything has a price, {you}. Including you.', 'We own a piece of everything. Soon, a piece of {you}.'],
    declare: ['Hostile? No, just business. {sector} is a good investment.', '{them} is undervalued. We’ll correct that.'],
    winning: ['The returns are excellent.', '{them} is going cheap.'],
    losing: ['A temporary dip. We buy the dip.', 'Write it off.'],
    won: ['Acquired, in all but name.', 'A fine addition to the portfolio.'],
    lost: ['Bad investment. We’ll make it back.', 'Cut losses. Move on.'],
    peace: ['Peace is cheaper than war. I did the maths.', 'A profitable arrangement.'],
    keynote: ['Today we announce that we bought several things.', 'Our shareholders are going to love this.'],
    reactGood: ['How much do they want for it?', 'Expensive-looking. We could buy it.'],
    reactBad: ['We were thinking of buying them. Not anymore.', 'Sell.'],
    alliance: ['A joint venture. Fifty-fifty, ideally sixty-forty.', 'Partners in profit.'],
    betrayed: ['That will cost you, {them}.', 'You just lost a very valuable friend.'],
    annexed: ['Sold. At least the price was right.'],
  },
};

export const CORP_NAMES = [
  'Helion Dynamics',
  'Omnivex Group',
  'Kurogane Holdings',
  'Aurora Megasystems',
  'Vanta Interactive Group',
  'Sable & Crane',
  'Nexora Conglomerate',
  'Polaris United',
  'Meridian Global',
  'Obsidian Arc',
  'Zenith Consolidated',
  'Hyperion Collective',
  'Crimson Lotus Corporation',
  'Atlas Prime',
  'Quasar Industries',
  'Tessera Worldwide',
  'Monolith Syndicate',
  'Equinox Partners',
];

export const CORP_COLORS = ['#e05d5d', '#4c9be8', '#e0a526', '#22b07d', '#a26ee8', '#e0739f', '#3fb6c6', '#d9822b', '#7d8cf0', '#9fbf3b', '#c75b3a', '#5f9e8f'];

export const ALLIANCE_NAMES = ['The Iron Pact', 'The Northern Accord', 'The Meridian League', 'The Free Market Coalition', 'The Silent Concord', 'The Founders’ Circle', 'The Open Platforms Alliance', 'The Pacific Compact', 'The Vanguard Bloc', 'The Atlas Treaty'];

export function fillLine(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
