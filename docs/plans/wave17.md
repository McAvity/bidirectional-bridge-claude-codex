# Wave17 — feature-workflow jako osobny plugin

Status: EXECUTION AUTHORIZED, 2026-09-22. Plan review PASS; decyzja01 obejmuje W17-01–04.
Feature: F-W17-workflow-plugin. Pierwotna baza: `1d7f93b`; aktualizacja po wave16: `33d6061`.

Osobny plugin workflow dla Codexa i Claude Code, w obecnym repo i marketplace.
Działa samodzielnie; w projekcie bridge korzysta z instrukcji przypiętego runtime.
Źródła są wspólne, a delegowany Claude nie potrzebuje osobistej instalacji pluginu.

## Kanoniczne dokumenty

- [Brief i AC-01…08](../features/F-W17-workflow-plugin/brief.md).
- [Projekt i granice dowodów](../features/F-W17-workflow-plugin/design.md).
- [Indeks featura](../features/F-W17-workflow-plugin/feature.json).
- [Postęp](wave17-progress.md).

## Nawigacja po zadaniach

Statusy i zależności mają jedno źródło w taskach:

- [W17-01](../../work-items/W17-01.md) — kontrakt pakietów, wyboru instrukcji i migracji.
- [W17-02](../../work-items/W17-02.md) — pakiety workflow i wejścia sześciu skilli.
- [W17-03](../../work-items/W17-03.md) — współistnienie z bridge i zachowanie delegacji.
- [W17-04](../../work-items/W17-04.md) — wspólna walidacja, dokumentacja i review.

Wave16 jest już zintegrowany i odebrany; zależność wejściowa W17-02 jest spełniona.
Projekt uwzględnia local-v1, rename-safe kontrole Git, zasoby paczek oraz zgodność
ze starszym pinem 0.3.2. Bridge-upgrade pozostaje częścią bridge’a.
W17-01 jest lokalną bramką techniczną, a nie
obowiązkowym przekazaniem do użytkownika. Po review/decyzji proponowane zlecenie obejmie
cały zakres wraz z integracją na branchu i poprawkami. Publikacja i smoke modeli
pozostają odrębne; plan nie zmienia skilli, pluginów ani runtime.

Następne wywołanie: `$feature-review` w trybie plan dla
`docs/features/F-W17-workflow-plugin/`, następnie `$feature-decide`.
