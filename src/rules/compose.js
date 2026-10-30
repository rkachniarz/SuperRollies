// @ts-check
// A Spice stack played as one Spice (docs/decisions.md D51). The engine asks
// one Spice for each hook; this makes one out of several, so the engine never
// knows how many there are. A stack of one is that Spice itself, untouched,
// so a match with one Spice plays exactly as it did before stacking.
//
// Each Spice in a stack keeps its own state, under its id in MatchState.spice,
// and each of its hooks is handed a state whose `spice` is that slice alone:
// a Spice never sees another's bookkeeping. Hooks run in the order the stack
// lists them (catalogue order, matchConfig), all drawing from the one rules
// stream, so both clients in a multiplayer match draw the same numbers.
//
// Hooks only one Spice in a stack can have (compare, winCondition, rethrow,
// again) are left to it: the slots and clashes in stacking.js see to that.

/** @typedef {import('./types.js').Spice} Spice */
/** @typedef {import('./types.js').DieValue} DieValue */

// Which Spice says first what a die counts for. A die one has changed is left
// alone by the rest: a die down a hole is 0, cursed or not, and a cursed 6
// counts 0 rather than exploding.
const VALUES_FIRST = ['pothole', 'cursed-number', 'exploding-dice', 'brutal-critical', 'burnout'];

/**
 * The Spice of `spices` that has `hook`, the one a slot leaves it to.
 * @param {Spice[]} spices
 * @param {keyof Spice} hook
 */
const ownerOf = (spices, hook) => spices.find((s) => s[hook] !== undefined);

/**
 * One Spice that plays `spices` together.
 * @param {Spice[]} spices  In catalogue order, none clashing.
 * @returns {Spice}
 */
export function composeSpice(spices) {
  if (spices.length === 1) return spices[0];
  /** Each hook context with `state.spice` narrowed to Spice `s`'s own slice. */
  const own = (/** @type {any} */ ctx, /** @type {Spice} */ s) =>
    ({ ...ctx, state: { ...ctx.state, spice: ctx.state.spice?.[s.id] } });
  const having = (/** @type {keyof Spice} */ hook) => spices.filter((s) => s[hook] !== undefined);

  const compare = ownerOf(spices, 'compare');
  const again = ownerOf(spices, 'again');
  const rethrow = ownerOf(spices, 'rethrow');
  const valuers = having('values').sort((a, b) => VALUES_FIRST.indexOf(a.id) - VALUES_FIRST.indexOf(b.id));
  const redraws = Math.max(0, ...spices.map((s) => s.redraws ?? 0));

  /** @type {Spice} */
  const stack = {
    id: spices.map((s) => s.id).join('+'),
    name: spices.map((s) => s.name).join(' + '),
    icon: spices.map((s) => s.icon).join(''),
    kind: 'rule',
    summary: spices.map((s) => s.summary).join(' '),
    rules: spices.map((s) => `${s.icon} ${s.name}: ${s.rules}`).join('\n\n'),
    eligibility: {},
    winCondition: ownerOf(spices, 'winCondition')?.winCondition,
    setup: (ctx) => Object.fromEntries(spices.map((s) => [s.id, s.setup?.(own(ctx, s))])),
    beforeThrow: (ctx) => {
      const spice = { .../** @type {object} */ (ctx.state.spice) };
      const said = [];
      for (const s of having('beforeThrow')) {
        const value = s.beforeThrow(own(ctx, s));
        if (value && 'spice' in value) spice[s.id] = value.spice;
        if (value?.announce) said.push(value.announce);
      }
      return { spice, announce: said.length ? said.join('\n') : undefined };
    },
    table: (ctx) => Object.assign({}, ...having('table').map((s) => s.table(own(ctx, s)))),
    hand: (side, base, ctx) => having('hand').reduce((hand, s) => s.hand(side, hand, own(ctx, s)), base),
    edge: (ctx) => having('edge').flatMap((s) => [s.edge(own(ctx, s))].flat()).filter(Boolean),
    values: (faces, ctx) => {
      /** @type {DieValue[]} */
      let out = faces.map((face) => ({ value: face }));
      for (const s of valuers) {
        const theirs = s.values(faces, own(ctx, s));
        out = out.map((v, i) => (v.tag !== undefined || v.value !== faces[i] ? v : theirs[i]));
      }
      return out;
    },
    adjust: (round, ctx) => having('adjust').flatMap((s) => s.adjust(round, own(ctx, s))),
    applyDamage: (round, damage, ctx) => having('applyDamage').reduce((d, s) => s.applyDamage(round, d, own(ctx, s)), damage),
    explain: (round, ctx) => {
      const said = having('explain').map((s) => s.explain(round, own(ctx, s))).filter(Boolean);
      return said.length ? said.join(' ') : undefined;
    },
  };
  if (having('afterSettle').length) {
    stack.afterSettle = (ctx) => {
      const spice = { .../** @type {object} */ (ctx.state.spice) };
      const swipes = [];
      for (const s of having('afterSettle')) {
        const value = s.afterSettle(own(ctx, s));
        if (value && 'spice' in value) spice[s.id] = value.spice;
        swipes.push(...(value?.swipes ?? []));
      }
      return { spice, swipes };
    };
  }
  if (compare) stack.compare = (round, ctx) => compare.compare(round, own(ctx, compare));
  if (again) stack.again = (throws, ctx) => again.again(throws, own(ctx, again));
  if (redraws) stack.redraws = redraws;
  if (rethrow) {
    stack.rethrow = {
      can: (side, ctx) => rethrow.rethrow.can(side, own(ctx, rethrow)),
      spend: (side, ctx) => ({ .../** @type {object} */ (ctx.state.spice), [rethrow.id]: rethrow.rethrow.spend(side, own(ctx, rethrow)) }),
    };
  }
  return stack;
}
