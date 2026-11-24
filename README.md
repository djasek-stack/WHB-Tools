# The Wise Homebuyer — Free Tools (Render version)

The two free tools from The Wise Homebuyer Academy, packaged so they can live
on Render under your own domain:

- **Hub** (`/`) — a start page linking to both tools.
- **Know Your Numbers** (`/know-your-numbers`) — the home price that fits a
  buyer's life, with the payment broken down, cash to close, and rent vs. own.
- **Deal Analyzer** (`/deal-analyzer`) — a verdict on a specific home, from its
  property record and comparable sales.

Both tools sit behind the same short lead form (first name + email; phone
optional). One form unlocks both tools on that visitor's device. The form
carries the full sharing/consent wording, and the "share my information"
checkbox is optional — only visitors who check it can be shared with partner
lenders and agents.

The server is plain Node.js with **no libraries to install** and no build
step. It runs with `npm start`.

---

## Putting it live on Render (step by step)

You need: this folder in a GitHub repo (or use Render's "Public Git
repository" option), your Render account, and about 10 minutes.

1. **Push these files to GitHub.** Create a new repository and upload
   everything in this folder (including `render.yaml`). Keep the folder
   structure exactly as it is.
2. **In Render, click "New +" → "Blueprint."** Connect the GitHub repo.
   Render reads `render.yaml` and proposes a web service named
   `whb-tools` on the **Starter** plan ($7/month, always on). Click Apply.
3. **Add the environment variables.** Render will prompt for the three
   variables marked `sync: false` (you can also add them later under your
   service → **Environment**):
   - `RENTCAST_API_KEY` — your RentCast API key. This powers the Deal
     Analyzer's live lookups. Without it, the Deal Analyzer shows its
     clearly labeled **sample report** instead of live data.
   - `CC360_WEBHOOK_URL` — the Course Creator 360 inbound webhook URL.
     Michael creates this in a CC360 workflow (trigger: **Inbound
     Webhook**) and sends you the URL. Until it's set, leads are stored
     inside the app only (see "Where the leads go" below).
   - `PRIVACY_POLICY_URL` — the page your Privacy Policy lives on.
     Defaults to `https://thewisehomebuyer.com/privacy-policy`.
4. **Wait for the first deploy** (a couple of minutes). Render gives you a
   URL like `whb-tools.onrender.com`. Open it — you should see the tools
   hub with the Academy logo.
5. **Put it on your domain (optional but recommended).** In Render:
   service → **Settings** → **Custom Domains** → add
   `tools.thewisehomebuyer.com`. Render shows you a DNS record to add at
   your domain registrar (GoDaddy/Cloudflare). Once DNS propagates, the
   tools live at `https://tools.thewisehomebuyer.com`.

## Test it like a visitor

1. Open the hub, click **Deal Analyzer**, then **Get free access**. Fill in
   the form (use your own name/email) and unlock. Search a real address —
   you should get the property snapshot, comparable homes, and the
   traffic-light verdict. Search a made-up address — you should get a
   "couldn't find that home" message, not fake data.
2. Open **Know Your Numbers**. The example numbers already filled in
   ($7,000 pay, $500 debts, $20,000 down, $2,000 rent) should produce a
   comfortable price of about **$257,800** and an all-in payment of about
   **$1,960/month**.
3. The interest rate at the top of Know Your Numbers should show the
   current Freddie Mac weekly average. If it ever can't be reached, the
   page clearly labels the 6.50% example rate instead — that's by design.

## Where the leads go

- Every form submission is stored in the app in `data/leads.json`, with the
  visitor's name, email, phone, whether they checked the share box, which
  tool they came from, the time, and the consent version (`consent_v1`).
- If `CC360_WEBHOOK_URL` is set, the same lead is also sent to Course
  Creator 360 at the moment it's submitted, and its stored record is
  marked `sent_to_cc360` (or `cc360_failed` if the send failed). If the
  webhook isn't set, records are marked `stored_only` — the app never
  pretends a lead was delivered when it wasn't.
- There is **no web page that lists the leads** — that contact information
  is not exposed publicly. Work your leads inside CC360.
- ⚠️ **Important:** Render's disk is temporary. The stored leads file
  resets when the service restarts or redeploys. Treat `data/leads.json`
  as a backup only — the CC360 webhook is the durable home for leads, so
  getting Michael's webhook URL connected is the real fix.

## Good to know

- **RentCast costs:** one fresh address lookup uses 2 RentCast requests
  (property record + value estimate). Repeat lookups of the same address
  are cached for 30 days and cost nothing. Your Foundation plan allows
  1,000 requests/month — roughly 500 fresh lookups.
- **Running cost:** Render Starter $7/month + RentCast Foundation
  $74/month = **$81/month** total.
- **Privacy pages must be live before you collect leads.** The lead form
  links to your Privacy Policy — make sure that page actually exists (the
  main site's footer links were pointing nowhere). Collecting names and
  emails behind a dead privacy link is a compliance problem.
- **The consent wording is a standard template, not legal advice.** Have
  your compliance attorney review the form's sharing/TCPA language before
  the first lead is ever sold or shared for money.

## Running it on your own computer (optional)

```
npm start
```

Then open `http://localhost:3000`. To test live RentCast lookups locally,
set the key first: `RENTCAST_API_KEY=your_key npm start`.
