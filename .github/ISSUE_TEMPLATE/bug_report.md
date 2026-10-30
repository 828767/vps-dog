---
name: Bug report
about: Something is broken
title: '[bug] '
labels: bug
assignees: ''
---

## What happened

<!-- A clear and concise description of the bug. -->

## What you expected

<!-- What should have happened instead. -->

## Steps to reproduce

1.
2.
3.

## Which component?

- [ ] Worker / API (`worker/`)
- [ ] Dashboard (`web/`)
- [ ] Agent (`agent/`)
- [ ] Deployment / docs

## Environment

| | |
| --- | --- |
| VPS-DOG version / commit | |
| Deployment | `wrangler dev` local / Cloudflare production |
| Browser (if UI) | |
| Agent OS + arch (if agent) | |

## Logs / responses

<details>
<summary>Agent log (<code>journalctl -u vps-dog -n 50</code>)</summary>

```
paste here
```
</details>

<details>
<summary>Worker log (<code>npx wrangler tail</code>)</summary>

```
paste here
```
</details>

<details>
<summary>API response</summary>

```json
paste here
```
</details>

## Anything else

<!-- Screenshots, guesses, related issues. -->
