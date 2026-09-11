# F-001 — czas trwania (duration)

## Cel
Użytkownicy wpisują czasy trwania w zwięzłej postaci (`1h30m`, `2.5d`). Biblioteka ma je
zamieniać na sekundy i z powrotem na tekst.

## Zachowanie i kryteria odbioru
- **AC-01** `textkit.duration.parse_duration(text) -> int` zwraca liczbę sekund. Jednostki:
  `s`, `m`, `h`, `d`, `w` (tydzień = 7 dni); wielkość liter nie ma znaczenia.
  `parse_duration("90s") == 90`, `parse_duration("2H") == 7200`, `parse_duration("1w") == 604800`.
- **AC-02** Wiele składników w dowolnej kolejności, spacje między składnikami opcjonalne,
  każda jednostka najwyżej raz: `"1h30m"` → 5400, `"30m 1h"` → 5400, `"1h 30m 15s"` → 5415.
- **AC-03** Ułamki dziesiętne z kropką i co najwyżej dwiema cyframi po niej są dozwolone dla
  `h`, `d` i `w` — wynik jest wtedy zawsze całkowitą liczbą sekund i musi być dokładnie
  równy wartości wejścia: `"1.5h"` → 5400, `"0.25d"` → 21600, `"0.5w"` → 302400.
  Dla `s` i `m` dozwolone są tylko liczby całkowite.
- **AC-04** Błędne wejście zgłasza `ValueError`, którego komunikat zawiera wejście: pusty
  napis, liczba bez jednostki (`"90"`), nieznana jednostka (`"5x"`), powtórzona jednostka
  (`"1h1h"`), wartość ujemna (`"-5m"`), ułamek przy `s`/`m` (`"1.5m"`), więcej niż dwie cyfry
  po kropce (`"1.255h"`).
- **AC-05** `textkit.duration.format_duration(seconds, style="compact") -> str` dla
  `seconds >= 0` (liczba całkowita; ujemna → `ValueError`):
  - `compact`: składniki `d`, `h`, `m`, `s` od największego, bez zerowych, oddzielone spacją;
    `0` → `"0s"`, `5415` → `"1h 30m 15s"`, `90061` → `"1d 1h 1m 1s"` (bez tygodni);
  - `clock`: `HH:MM:SS`, godziny mogą przekraczać 24: `5415` → `"01:30:15"`,
    `90061` → `"25:01:01"`.

## Poza zakresem
CLI, miesiące i lata, strefy czasowe, lokalizacja komunikatów, zmiany API poza `duration`.
