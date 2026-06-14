# Infiltration — Monetization Spec (web-first)

**Goal:** A handful of paid subscribers cover hosting + a small free tier + Doc's
own play, so Doc plays for free (or near it). Not a business — a self-funding
hobby. Web-first via Stripe; no Play Store, no Google cut, no content review.

**Hard constraint:** there is no acceptable local model. Every action is cloud
inference. There is no free fallback — the budget governor degrades to a cheaper
*cloud* model or pauses the free tier; it never falls back to "free."

---

## 1. The shape

```
Browser (PWA, installable) ──► SvelteKit app on Railway
                                  ├─ Auth (magic-link email)
                                  ├─ Users/Subscriptions/Usage  → SQLite (Railway volume)
                                  ├─ Game state (world.json, as today)
                                  ├─ Entitlement layer  → tier → model + caps
                                  ├─ Director (cloud: Haiku / Sonnet)
                                  └─ Stripe (Checkout + webhooks + portal)
```

Two new backbones the game doesn't have today: **real accounts** and a **real
datastore**. These are the bulk of the work. Tiers, routing, and romance gating
are easy once the backbone exists.

---

## 2. Accounts & auth (prerequisite)

Today: name + `localStorage` playerId, no auth. Billing can't attach to that.

- **Magic-link email login** (passwordless). Lowest friction, no password storage/
  liability, ties cleanly to a Stripe customer by email. Needs a transactional
  email provider (Resend free tier ≈ 3k emails/mo — plenty).
- A `user` owns one or more characters. On first login, **claim** any existing
  `localStorage` characters into the account (migration path for current players).
- Owner (Doc) is just a `role: 'owner'` user — keeps `/admin` separate from billing.

---

## 3. Tiers (numbers are Doc's to set — these are starting proposals)

Per-turn cloud cost with caching ≈ **Haiku 0.6¢ · Sonnet 1.5¢ · Opus 3¢**.
Stripe takes ~2.9% + 30¢. **Iron rule: a tier's cap, fully maxed, must cost less
than its net revenue — so no paid user can ever lose money, whales included.**

**FINAL (numbers provisional, tuned by metering):**

| Tier | Price/mo | Model | Action cap (~/day) | Romance |
|---|---|---|---|---|
| **Free** | $0 | Haiku | ~25 / mo (~1) | ~5 teaser turns, then locked |
| **Adventurer** | $5 | Haiku | ~500 / mo (~17) | full |
| **Hero** | $15 | Sonnet 4.6, medium effort | ~800 / mo (~27) | full |
| **Champion** | $25 | Sonnet 4.6, medium effort | ~1,500 / mo (~50) | full |
| **Legend** | $100 | Opus 4.6, medium effort *(moonshot)* | ~3,500 / mo (fair use) | full |

- **Value ladder = model + volume.** Free/$5 ride Haiku (cheap, high-volume); $15/$25
  step up to Sonnet (smarter Director); $100 is the Opus moonshot — "basically Doc's
  setup minus admin," there as an aspirational trophy, not expected to sell.
- **$5 runs at break-even by design** (Doc's call — "it can net zero, I don't care").
  The subsidy for free-tier bleed + Doc's own play comes from the $15/$25 tiers and
  from $5 users who don't max out. Iron rule still holds for $15/$25/$100: maxed cap
  cost < net revenue, so no paid user can lose money.
- **Medium effort on the Sonnet/Opus tiers** is also a cost lever — cheaper than the
  default `high`, so those caps stretch further.
- Caps reset monthly, aligned to the Stripe billing cycle (free tier resets on the 1st).
- User-facing unit is **"actions"** (simple). Internally we meter **real tokens**
  from each API response for the budget governor (accurate cost).

---

## 4. Romance gating

- **Free:** romance mode (`/start`) allowed for **~5 total teaser turns** (lifetime,
  per account), then `/start` returns a locked message + upgrade CTA. Enough to
  taste, not enough to satisfy.
- **Any paid tier:** unlimited romance.
- Implementation: a `romance_turns_used` counter on the user; the Director's romance
  path checks `tier === 'free' && romance_turns_used >= FREE_ROMANCE_LIMIT` before
  routing to the romance model.
- Web-only means **Play's content policy doesn't apply** — romance stays as-is, no
  stripping required.

---

## 5. Entitlement layer (the core)

Enforced in the action pipeline (`processAction` / the action endpoint):

1. Resolve the user's tier + remaining action budget for the period.
2. **Out of actions?** → return an upgrade prompt instead of calling the Director.
3. **Model routing:** free/$5 → Haiku, $15/$25 → Sonnet 4.6 (medium effort),
   $100 → Opus 4.6 (medium effort). Overridden by the budget governor (§6).
4. Call the Director; read `usage` from the API response; record
   `tokens_in/out` + computed `cost_usd` + increment `actions_used`.
5. Romance counter checked separately on the romance path.

---

## 6. Budget governor (kill-switch)

Monthly cloud budget is an env var (e.g. `CLOUD_BUDGET_USD=30`) — the most Doc is
willing to eat in a month. **Key insight: paid users are self-funding (cap < revenue),
so they're never throttled. The governor only gates the free tier + owner play** —
which doubles as a conversion nudge.

- Track cumulative `cost_usd` for the current month (free-tier + owner spend).
- At **100% of budget:** free tier pauses → "The city sleeps. Upgrade to keep playing."
  Paid users unaffected.
- Hard ceiling (e.g. 150%): pause everything briefly ("Director resting"). Should
  rarely trigger since paid usage is revenue-positive.
- Doc's personal exposure is bounded near `CLOUD_BUDGET_USD` regardless of signups.

---

## 7. Stripe

- **Checkout Session** per tier (one Stripe Price per tier). Subscription mode.
- **Webhooks** (`checkout.session.completed`, `customer.subscription.updated/deleted`,
  `invoice.payment_failed`) → update the user's `tier` + `subscription_status` +
  `current_period_end`.
- **Customer Portal** for self-serve manage/cancel.
- Price-ID → tier mapping in config.

---

## 8. Data model (SQLite)

```
users(id, email, role, stripe_customer_id, tier, subscription_status,
      current_period_end, romance_turns_used, created_at)
usage(user_id, period 'YYYY-MM', actions_used, tokens_in, tokens_out, cost_usd)
characters: linked to users via user_id (game state stays in world.json for now;
            add user_id → playerId mapping, migrate later if needed)
budget(period 'YYYY-MM', cost_usd)   -- governor counter
```

---

## 9. UI

- **Pricing page** (tiers + Stripe Checkout buttons).
- **Account page** (current tier, actions remaining, manage via Stripe portal).
- **"Actions remaining" indicator** in the game HUD.
- **Upgrade prompts** at: out-of-actions, romance lock, free-tier pause.

---

## 10. Build sequence

1. **Backbone** — SQLite + schema, magic-link auth, claim existing local characters.
2. **Entitlement layer** — tier → model routing + per-user action metering, enforced
   in the action pipeline.
3. **Romance gating** — free teaser counter + lock/upsell.
4. **Budget governor** — monthly cost tracking + free-tier/owner kill-switch.
5. **Stripe** — Checkout, webhooks, Customer Portal, price→tier mapping.
6. **UI** — pricing page, account page, actions indicator, upgrade prompts.

Steps 3–6 are largely mechanical (good subagent candidates). Step 1 is the real
architectural lift and the prerequisite for everything else.

---

## Decisions

**Locked:**
- Tier lineup, prices, model routing, romance gating — see §3, §4. ($5 Haiku,
  $15/$25 Sonnet medium effort, $100 Opus moonshot; free romance = 5 teaser turns.)

**Infra defaults (Doc can veto, otherwise these stand):**
- **Auth:** magic-link email (passwordless).
- **Datastore:** SQLite on a Railway volume.
- **`CLOUD_BUDGET_USD`:** $30/month (the most Doc eats before the free tier pauses).

**Tuned later with real metering:** exact action caps (§3 numbers are estimates).
