# Interface languages

Maestro's desktop interface supports English and Simplified Chinese. Select **Settings > General > Language** to follow the system language or choose a language explicitly. The preference is saved as `uiLanguage` (`system`, `en`, or `zh-CN`) and can also be read and changed with the CLI settings commands.

Changing the language updates the rendered interface and native application menus without restarting or remounting the application. Unsupported system languages fall back to English. Chinese system locales currently resolve to Simplified Chinese. Missing Chinese messages fall back to their English catalog entries.

## Current coverage

This first pass covers the daily desktop workflow: onboarding choices, sidebar and agent menus, chat and expanded prompt composers, tabs, daily file-browser/preview controls, group chats, agent creation and configuration, native session browsing/resume controls, permissions, history controls, and confirmation dialogs. It also covers the application-owned controls and descriptions in every Settings tab, including the shared font, theme, environment, SSH, extension and prompt editors.

Advanced feature panels and long help documents are outside this first pass. The phone/web-specific interface has not received a complete translation pass. Provider-generated errors and output, third-party plugin panels and command descriptions, guides, and model-generated text can remain in their original language.

The interface language does not change model output, conversation text, user labels, project paths, model/provider identifiers, CLI flags, saved option values, permissions, or prompt bodies sent to a native harness. Existing native login and subscription behavior is unchanged.

## Adding or updating messages

- Add matching semantic keys to `src/renderer/i18n/locales/en` and `src/renderer/i18n/locales/zh-CN`. Keep both catalogs aligned, including placeholder names.
- In React, call `useT()` or `useI18n()` and render translated text with that function. Include the translator in memo/callback dependencies whenever translated text is calculated there.
- Outside React, call `getT()` when producing the text. Do not translate module-level constants at import time, because those strings would not respond to language changes.
- Keep sentences together. Use `{name}` placeholders for values. Avoid concatenating English plural suffixes onto translated text.
- Use `tRich()` for messages containing React nodes, such as links or keyboard hints. Do not render translation strings as HTML.
- Keep React keys, settings keys, command IDs, provider options and protocol payloads language-independent. Only their display labels should be translated.
- Shared settings/provider metadata remains authoritative in English; the explicit renderer label maps translate known application-owned descriptions and preserve unknown extension text.
- Extend bilingual settings-search labels while retaining English keywords so both languages continue to find a setting.

Native application menu translations are in `src/main/app-menu-translations.ts`; locale validation and resolution are shared in `src/shared/i18n.ts`.

## Validation

Language tests under `src/__tests__/renderer/i18n` cover catalog parity, fallback/interpolation, reactive switching, preservation of draft input and native question answers, settings hydration/persistence, system-language updates, and bilingual settings search. Main-process and CLI tests cover setting validation, native menu changes, persistence, and web settings snapshots. Existing component regression suites cover the edited workflows.

For manual acceptance, build and run a separate local test app or isolated demo profile. Check all Settings tabs in Chinese, switch to English and back with an unsent draft, search settings in both languages, create an agent without sending a message, browse existing native sessions, and restart to verify the saved language. Keep the installed production profile intact during testing. For a separately named local preview package, omit URL protocols from its packaging config and set `MAESTRO_SKIP_PROTOCOL_REGISTRATION=1` before loading the main process. This opt-out prevents that preview from replacing the installed app as the default `maestro://` handler; normal builds retain their existing protocol registration behavior.
