# Security

## Reporting a problem

Please **do not open a public issue** for security problems. Use GitHub's private reporting instead: go to the **Security** tab of this repository and choose **Report a vulnerability**. You will get a reply as soon as possible.

## What this project does to keep you safe

**For visitors**

- The site is static. There are no accounts, logins, cookies, analytics, ads or third-party scripts.
- Everything you enter (settings, watchlist, price overrides, saved strategies) stays in your browser's local storage and is never sent anywhere.
- A strict Content Security Policy only allows code from the site itself, and network requests only to the site and to `api.sermeatball.com` (for price history charts).
- All text that comes from external data (item names, categories, …) is inserted as plain text, never as HTML, so it cannot run code.
- Data files are validated before they are published. If upstream data looks broken or malicious, the last good copy stays online.

**For the repository**

- The code contains no secrets. The only secret (an optional Discord webhook for alerts) is stored in GitHub's encrypted Actions secrets and is never printed.
- Secret scanning and push protection are enabled.
- Workflows run with read-only permissions by default; only the deploy step can publish to Pages.
- Every third-party GitHub Action is pinned to an exact commit, and only GitHub-owned actions are used.
- Workflows never run code from pull requests with access to secrets.
- The data pipeline and the web app use no third-party packages.
