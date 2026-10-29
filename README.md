# BizThai

Thai business directory serving https://bizthai.com/ and https://en.bizthai.com/.

This repository contains the current application source, production theme, supporting Node/Python services, SQL migrations and deployment configuration exported on 2026-10-30. The independent WooCMS Go server binary, database contents, credentials, logs, caches and Git history are excluded. WooCMS core must be supplied separately from its maintained upstream project; this application snapshot does not include the Go core source or an executable.

## Components

- admin/data/themes/starter: production WooCMS theme and browser assets.
- resolver: public server-rendered routes, canonical/hreflang metadata and sitemaps.
- analytics, directors, sanitizer: directory and company-data supporting services.
- ingest, sync, ai, deploy-webhook: supporting source retained for review; inclusion does not enable these services.
- deploy/systemd and deploy/nginx: current production service limits and reverse proxy configuration.
- SOURCE_MANIFEST.json: export scope and exclusions.

## Production configuration

Thai is the default language at bizthai.com. English uses en.bizthai.com. Chinese public routes are retired. Existing stored language data is retained; no bulk translation jobs were enabled.

Runtime environment files are intentionally omitted. Provide credentials through service EnvironmentFile entries at deployment time. Review service paths, database connections, ports, certificate paths and domain records before deploying on another host. Do not commit real environment files or private keys.

Public anonymous HTML uses origin shared-cache TTL 600 seconds and browser TTL 60 seconds. Cloudflare respects origin cache headers. Session-cookie requests and authentication/account/admin/API paths bypass shared caching. The old inherited Nginx page cache is disabled for this vhost.

## Current operational limits

The web, resolver, analytics, directors and sanitizer services run with CPU/memory limits and bounded database concurrency. Bulk ingestion, crawling, translation, AI and ranking snapshot preload remain disabled. Ranking/AI features require further work. Historical server crash causes have not yet been established. Do not enable bulk jobs or run migrations blindly as part of cloning this repository.

No enterprise database dump or full-site backup was created for this export.
