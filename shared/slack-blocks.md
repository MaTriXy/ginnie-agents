# Slack Block Kit Reference for Agents

Use these patterns for interactive messages. When a user clicks a button or selects an option, you'll receive their choice as a follow-up message.

## Approval Request (Buttons)
```json
{
  "channel": "CHANNEL_ID",
  "text": "Approval needed: <summary>",
  "blocks": [
    {
      "type": "section",
      "text": {"type": "mrkdwn", "text": "<detailed description>"}
    },
    {
      "type": "actions",
      "elements": [
        {"type": "button", "text": {"type": "plain_text", "text": "✅ Approve"}, "style": "primary", "action_id": "approve", "value": "approved"},
        {"type": "button", "text": {"type": "plain_text", "text": "❌ Decline"}, "style": "danger", "action_id": "decline", "value": "declined"},
        {"type": "button", "text": {"type": "plain_text", "text": "💬 Discuss"}, "action_id": "discuss", "value": "discuss"}
      ]
    }
  ]
}
```

## Radio Buttons (2-5 options with descriptions)
```json
{
  "type": "section",
  "text": {"type": "mrkdwn", "text": "Pick one:"},
  "accessory": {
    "type": "radio_buttons",
    "action_id": "choice",
    "options": [
      {"text": {"type": "plain_text", "text": "Option A"}, "value": "option_a", "description": {"type": "plain_text", "text": "Description"}},
      {"text": {"type": "plain_text", "text": "Option B"}, "value": "option_b", "description": {"type": "plain_text", "text": "Description"}}
    ]
  }
}
```

## Dropdown Select (5+ options)
```json
{
  "type": "section",
  "text": {"type": "mrkdwn", "text": "Choose:"},
  "accessory": {
    "type": "static_select",
    "action_id": "select_choice",
    "placeholder": {"type": "plain_text", "text": "Choose..."},
    "options": [
      {"text": {"type": "plain_text", "text": "Item 1"}, "value": "item_1"},
      {"text": {"type": "plain_text", "text": "Item 2"}, "value": "item_2"}
    ]
  }
}
```

## Rules
- Use `action_id` with semantic names — you receive this back when user interacts
- Always include `text` as fallback
- `style: "primary"` = green, `style: "danger"` = red
- Buttons for yes/no, radio for mutually exclusive options, dropdown for long lists

## One decision per message (hard rule, all agents)
- A Slack message with buttons must contain exactly **one** actionable decision. Never stack `Item A: [Approve] [Decline]   Item B: [Approve] [Decline]   Item C: [Approve] [Decline]` in a single message. When the user clicks any button, your follow-up `chat.update` (or implicit message replacement via `response_url`) collapses the buttons across the *whole* message — and the user loses the ability to act on the other items.
- For digests with N actionable items: post one short header message (no buttons) summarizing counts, then one follow-up `chat.postMessage` per item, each with its own buttons. Each follow-up becomes its own thread, so per-item discussion (e.g. "Edit & send" → editing in thread) doesn't pollute other items.
- "Show before you ask" — if a button approves an outbound message (reply, email, calendar invite, anything sent on the user's behalf), the **exact text being sent** must appear in the message section above the buttons. The button click is the send-approval on the shown text. No "what would you like me to say?" without showing a draft first.
