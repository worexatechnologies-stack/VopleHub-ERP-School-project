
# School ERP & Learning Management System

A React and Django school management application.

## License

Copyright (c) 2026 Worexa Technologies. This software is proprietary; see
[LICENSE](LICENSE) for terms.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env` and set `VITE_API_BASE_URL` if needed.
3. Run the app:
   `npm run dev`

### Docker with local HTTPS

Run `docker compose up --build -d` and open `https://localhost:3443`. The old
`http://localhost:3001` address redirects to HTTPS. Caddy creates a local CA
certificate; browsers may warn until its root certificate is trusted on this
computer. To export it after Caddy starts, run:

`docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-local-root.crt`

Import `caddy-local-root.crt` into the macOS login keychain and trust it for
SSL. This certificate is for local development only.
