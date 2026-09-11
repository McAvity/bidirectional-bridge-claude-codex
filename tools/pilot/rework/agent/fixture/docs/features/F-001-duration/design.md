# F-001 — projekt techniczny

Wejście: `brief.md` (wersję identyfikuje SHA-256 w manifestach paczek). Punkt startowy kodu:
commit początkowy repozytorium.

- Nowy moduł `src/textkit/duration.py` z `parse_duration` i `format_duration`.
- Konwersję wartości na sekundy realizuje istniejące `textkit.units.to_seconds`
  (współdzielone z `rates.py`); nie duplikuj tabeli jednostek. Zmiany w `units.py` są
  dozwolone, jeśli wymagają ich kryteria odbioru, z zachowaniem zachowania `rates.py`.
- Testy: `tests/test_duration.py`.

Jedyny task: F-001-T01 (biblioteka, AC-01..AC-05).
Własność: kod i testy — wykonawca rund; indeks, statusy tasków, review i decyzje — koordynator.
Stan planu: zaakceptowany do wykonania.
