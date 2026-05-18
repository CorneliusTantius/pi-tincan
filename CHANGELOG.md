# Changelog

## v1.2.2

- show installed pi version in footer session panel

## v1.2.1

- show static COMM footer status as normal green text instead of badge

## v1.2.0

- cache footer stats and remove external RTK/process work from render path
- refresh footer on events plus 30s RTK interval
- keep context usage near realtime without session scan during render
- shorten and strengthen pi-tincan persona
- remove redundant `tincan_squad` prompt injection
- remove RTK global stats from footer

## v1.1.0

- remove custom pretty Markdown renderer from `tincan_squad` results
- keep footer/versioning improvements

## v1.0.4

- vary footer resource label colors with more native theme slots
- make section titles uppercase + bold
- add section symbols for faster footer scanning

## v1.0.3

- dim RTK global segment including counts
- compute RTK global segment directly from fresh `rtk gain` output in footer render
- keep session/global RTK split clearer in footer

## v1.0.2

- render `tincan_squad` results with prettier Markdown view in expanded mode
- add footer version display sourced from `package.json`
- add RTK footer color coding
- flag long sessions with RTK enabled but zero rewrites
- color-code footer resources row
- replace footer dot separators with `|`

## v0.1.0

- initial pi-tincan package
- `ask_user_question` tool
- `tincan_squad` tool
- persona + communication injection
- custom footer with session/activity stats
- RTK rewrite hook support
