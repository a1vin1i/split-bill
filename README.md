# Split Bill 🧾

A tiny mobile-first web app for splitting group expenses — restaurant bills, group purchases, trips.

## How it works

1. **Add people** from your saved pool (multi-select), or create new ones — with an optional headcount (e.g. 2 for a couple, 0.5 for a child) and PayMe PayLink (pasteable straight from the PayMe app's share message). People are saved once on your device and reusable on every bill via the 👥 manager.
2. **Add items** — what it was, how much, who paid, and who shares it. Different items can be paid by different people and split between different subsets.
3. **Summary** shows what everyone paid vs. their share, and the minimal set of **"who pays whom"** transfers to settle up.
4. **Request** sends a payment request message (with the payee's PayMe link) via the share sheet / WhatsApp.
5. **Share bill** encodes the entire bill into a link. Send it to a friend — they open it, add what *they* paid, and share an updated link back. No accounts, no server.

## Tech

- Plain HTML/CSS/JS, no build step, no dependencies.
- All money handled in integer cents; leftover cents on uneven splits are distributed so every item reconciles exactly.
- Bill state lives in the URL hash (deflate-compressed, base64url) for sharing and in `localStorage` for persistence.
- Note: PayMe personal PayLinks cannot pre-fill an amount (that requires the PayMe Business API), so the request message includes the amount as text.

## Development

Serve the folder with any static server, e.g. `python -m http.server`, and open `http://localhost:8000`.

Run tests: `node --test tests/settle.test.js`
