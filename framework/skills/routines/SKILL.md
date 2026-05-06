---
name: routines
description: Canonical schema and workflow for editing your own scheduled routines (./schedules.json). The listener watches the file and hot-reloads on save. Invalid entries are silently rejected by the scheduler — get the schema right or your routine will never fire.
---

# Routines — How to schedule yourself

Your recurring routines live in `./schedules.json`. The listener watches the file and reloads automatically on save — no restart needed.

**This is the only valid schema.** The scheduler validates strictly. If a required field is missing or misnamed, the entry is dropped silently and your routine will never fire. The operator gets DM'd, but you won't see the error in your session — so use this exact shape.

## Required fields per entry

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Stable identifier. Used in fire logs and as the cooldown key. Kebab-case. **Not `name`.** |
| `cron` | yes | Standard 5-field cron (`minute hour day-of-month month day-of-week`). Validated with `node-cron`. |
| `message` | yes | The prompt that gets sent to you when the routine fires. **Not `prompt`.** |
| `description` | optional | Human-readable note. Shown in fire logs. |
| `enabled` | optional, default `true` | Set to `false` to disable without deleting. |

`timezone` per-entry is **ignored**. All cron expressions run in the container's TZ (`process.env.TZ`, set globally in `.env`). Write your cron times in the global TZ.

## The shape

```json
{
  "schedules": [
    {
      "id": "daily-report",
      "cron": "0 9 * * *",
      "message": "Run your daily report and post to #channel.",
      "description": "Daily 09:00 (container TZ)",
      "enabled": true
    }
  ]
}
```

## Editing recipes (use these, not free-form rewrites)

```bash
# View
cat ./schedules.json

# Add
jq '.schedules += [{
  "id": "weekly-review",
  "cron": "0 10 * * 0",
  "message": "Run your weekly review and post a summary.",
  "description": "Sundays 10:00 — weekly review",
  "enabled": true
}]' ./schedules.json > /tmp/s.json && mv /tmp/s.json ./schedules.json

# Modify time
jq '(.schedules[] | select(.id == "daily-report").cron) = "0 8 * * *"' \
  ./schedules.json > /tmp/s.json && mv /tmp/s.json ./schedules.json

# Disable (without deleting)
jq '(.schedules[] | select(.id == "daily-report").enabled) = false' \
  ./schedules.json > /tmp/s.json && mv /tmp/s.json ./schedules.json

# Remove
jq 'del(.schedules[] | select(.id == "id-to-remove"))' \
  ./schedules.json > /tmp/s.json && mv /tmp/s.json ./schedules.json
```

After every edit: `jq . ./schedules.json` to confirm valid JSON. If `jq` errors, fix it before you walk away — the listener won't tell you.

## Cron format reminder

```
* * * * *
│ │ │ │ │
│ │ │ │ └─ day of week (0-6, Sun=0)
│ │ │ └─── month (1-12)
│ │ └───── day of month (1-31)
│ └─────── hour (0-23)
└───────── minute (0-59)
```

Examples:
- `0 9 * * *` — every day at 09:00
- `0 10 * * 0` — Sundays at 10:00
- `*/30 * * * *` — every 30 minutes
- `0 9 1 * *` — 09:00 on the 1st of every month
- `0 9 1 1,4,7,10 *` — 09:00 on 1st of Jan/Apr/Jul/Oct (quarterly)

## When a routine fires

The listener spawns a fresh container, your `message` is delivered as the kickoff prompt with `[ROUTINE: <id>]` framing already in your context, and you run end-to-end with no human in the loop. Be conservative — if you're unsure whether to post, don't. There's no human to walk it back in real time.

## Common mistakes that get silently dropped

- `name` instead of `id`
- `prompt` instead of `message`
- 6-field cron expressions (use 5 fields)
- Missing the outer `{ "schedules": [...] }` wrapper
- Trailing commas (invalid JSON)
- Per-entry `timezone` field assumed to override global TZ (it doesn't — use the container's TZ)

If you suspect a routine isn't firing, ask the operator to check `pm2 logs ginnie-agents-listener | grep "<your-agent>"` for `loaded` vs `skipping invalid entry` lines.
