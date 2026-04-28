# Cozyla-adb-devices

## Release delivery to Feishu

The `Build packages` GitHub Actions workflow can send release `.dmg` and `.exe`
installers to a Feishu chat or user after both macOS and Windows builds finish.
The delivery job runs for `workflow_dispatch` builds, `v*` tag pushes, and
published GitHub releases.

Configure these repository secrets:

- `LARK_APP_ID`: Feishu custom app ID.
- `LARK_APP_SECRET`: Feishu custom app secret.
- `LARK_RECEIVE_ID`: target chat or user ID.
- `LARK_RECEIVE_ID_TYPE`: `chat_id` for a group, or `open_id`/`user_id`/`email`
  for a person.

The Feishu app needs IM message and file upload permissions, and the bot must be
able to send messages to the target chat or user.
