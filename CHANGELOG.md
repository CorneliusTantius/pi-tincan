# Changelog

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
